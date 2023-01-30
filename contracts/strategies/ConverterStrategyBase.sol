// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2.sol";
import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/ITetuConverterCallback.sol";
import "../interfaces/converter/IPriceOracle.sol";
import "../interfaces/converter/IConverterController.sol";
import "../tools/TokenAmountsLib.sol";
import "../tools/AppLib.sol";
import "./ConverterStrategyBaseLib.sol";
import "./DepositorBase.sol";

//!! import "hardhat/console.sol";

/// @title Abstract contract for base Converter strategy functionality
/// @notice All depositor assets must be correlated (ie USDC/USDT/DAI)
/// @author bogdoslav
abstract contract ConverterStrategyBase is ITetuConverterCallback, DepositorBase, StrategyBaseV2 {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.0.0";

  uint private constant _REWARD_LIQUIDATION_SLIPPAGE = 5_000; // 5%
  uint private constant _ASSET_LIQUIDATION_SLIPPAGE = 500; // 0.5%

  uint private constant REINVEST_THRESHOLD_PERCENT_DENOMINATOR = 100_000;
  /////////////////////////////////////////////////////////////////////
  //                        VARIABLES
  //                Keep names and ordering!
  //                 Add only in the bottom.
  /////////////////////////////////////////////////////////////////////

  /// @dev Amount of underlying assets invested to the pool.
  uint private _investedAssets;

  /// @notice Amount of asset passed to _depositToPool that wasn't invested but was kept on the balance for a next round
  uint private _unspentAsset;

  /// @dev Linked Tetu Converter
  ITetuConverter public tetuConverter;

  /// @notice Minimum token amounts that can be liquidated
  mapping(address => uint) public liquidationThresholds;

  /// @notice Percent of asset amount that can be not invested, it's allowed to just keep it on balance
  ///         decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  /// @dev We need this threshold to avoid numerous conversions of small amounts
  uint public reinvestThresholdPercent;

  event LiquidationThresholdChanged(address token, uint amount);
  event ReinvestThresholdPercentChanged(uint amount);

  /////////////////////////////////////////////////////////////////////
  //                Initialization and configuration
  /////////////////////////////////////////////////////////////////////

  /// @notice Initialize contract after setup it as proxy implementation
  function __ConverterStrategyBase_init(
    address controller_,
    address splitter_,
    address converter_
  ) internal onlyInitializing {
    __StrategyBase_init(controller_, splitter_);
    tetuConverter = ITetuConverter(converter_);
    //!! console.log("__ConverterStrategyBase_init, totalSupply", _depositorTotalSupply());
  }

  function setLiquidationThreshold(address token, uint amount) external {
    _onlyOperators();
    liquidationThresholds[token] = amount;
    emit LiquidationThresholdChanged(token, amount);
  }

  /// @param percent_ New value of the percent, decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  function setReinvestThresholdPercent(uint percent_) external {
    //!! console.log("setReinvestThresholdPercent", percent_, REINVEST_THRESHOLD_PERCENT_DENOMINATOR);
    _onlyOperators();
    require(percent_ <= REINVEST_THRESHOLD_PERCENT_DENOMINATOR, AppErrors.WRONG_VALUE);

    reinvestThresholdPercent = percent_;
    emit ReinvestThresholdPercentChanged(percent_);
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Deposit to the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Amount of underlying assets converted to pool assets and invested to the pool.
  function investedAssets() override public view virtual returns (uint) {
    return _investedAssets;
  }

  /// @notice Deposit given amount to the pool.
  function _depositToPool(uint amount_) override internal virtual {
    //!! console.log('_depositToPool amount', amount_);

    address _asset = asset; // gas saving
    ITetuConverter _tetuConverter = tetuConverter;

    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_PERCENT_DENOMINATOR) {
      address[] memory tokens = _depositorPoolAssets();
      uint len = tokens.length;

      //!! TokenAmountsLib.printBalances('Balance before:', tokens, address(this));

      uint indexAsset;
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        if (tokens[i] == _asset) {
          indexAsset = i;
        }
      }

      // calculate required collaterals for each token and temporary save them to tokenAmounts ...
      (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
      uint[] memory tokenAmounts = ConverterStrategyBaseLib.getCollaterals(
        amount_,
        tokens,
        weights,
        totalWeight,
        indexAsset,
        IPriceOracle(IConverterController(_tetuConverter.controller()).priceOracle())
      );
      // ... make borrow and save amounts of tokens available for deposit to tokenAmounts
      // tokenAmounts[indexAsset] is already correct
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        if (i != indexAsset) {
          if (tokenAmounts[i] > 0) {
            ConverterStrategyBaseLib.borrowPosition(_tetuConverter, _asset, tokenAmounts[i], tokens[i]);
          }
          tokenAmounts[i] = IERC20(tokens[i]).balanceOf(address(this));
        }
      }

      // make deposit
      (uint[] memory amountsConsumed,) = _depositorEnter(tokenAmounts);

      // consumed asset amount can be different from desired amounts
      // we should the difference in _unspentAsset
      if (amount_ > amountsConsumed[indexAsset]) {
        _unspentAsset += amount_ - amountsConsumed[indexAsset];
      }
      _updateInvestedAssets();

      //!! TokenAmountsLib.print('Amounts for enter:', tokens, tokenAmounts);

      //!! TokenAmountsLib.printBalances('Balance after:', tokens, address(this));

      //!! console.log(">>> Asset balance after _depositToPool", _balance(asset));
      //!! console.log(">>> _unspentAsset", _unspentAsset);
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return investedAssetsUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  function _withdrawFromPool(uint amount) override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    //!! console.log("_withdrawFromPool.1 amount", amount);

    require(_investedAssets != 0, "CSB: no investments");
    if (amount != 0 && _investedAssets != 0) {
      uint liquidityAmount = _depositorLiquidity()  // total amount of LP tokens owned by the strategy
        * 101 // add 1% on top...
        * amount / _investedAssets // a part of amount that we are going to withdraw
        / 100; // .. add 1% on top
      (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
      _withdrawFromPoolUniversal(liquidityAmount, false);
      //!! console.log("_withdrawFromPool.2 liquidityAmount", liquidityAmount);
    }

    //!! console.log("_withdrawFromPool.3 investedAssetsUSD, assetPrice", investedAssetsUSD, assetPrice);
    //!! console.log(">>> Asset balance after _withdrawFromPool", _balance(asset));
    return (investedAssetsUSD, assetPrice);
  }

  /// @notice Withdraw all from the pool.
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  function _withdrawAllFromPool() override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    //!! console.log("_withdrawAllFromPool.start");
    // total amount of LP-tokens deposited by the strategy
    uint liquidityAmount = _depositorLiquidity();

    // predict expected amount to be withdrawn (in USD)
    (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
    _withdrawFromPoolUniversal(liquidityAmount, false);
    //!! console.log("_withdrawAllFromPool.finish");
    //!! console.log(">>> Asset balance after _withdrawAllFromPool", _balance(asset));
  }

  /// @notice If pool support emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    _withdrawFromPoolUniversal(0, true);
    //!! console.log(">>> Asset balance after _emergencyExitFromPool", _balance(asset));
  }

  function _getExpectedWithdrawnAmountUSD(uint liquidityAmount) internal view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    // predict expected amount to be withdrawn (in USD)
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmountUSD(
      _depositorPoolAssets(),
      _depositorPoolReserves(),
      asset,
      liquidityAmount,
      _depositorTotalSupply(),
      IPriceOracle(IConverterController(tetuConverter.controller()).priceOracle())
    );
  }

  function _withdrawFromPoolUniversal(uint liquidityAmount_, bool emergency_) internal {
    //!! console.log("_withdrawFromPoolUniversal");

    // withdraw the amount from the depositor to balance of the strategy
    if (emergency_) {
      _depositorEmergencyExit();
    } else {
      //!! console.log("_withdrawFromPoolUniversal liquidityAmount", liquidityAmount_);
      _depositorExit(liquidityAmount_);
    }

    //!! TokenAmountsLib.printBalances('/// Balance after withdraw:', _depositorPoolAssets(), address(this));

    // convert all received amounts to the asset
    _convertDepositorPoolAssets();
    _updateInvestedAssets();

    //!! TokenAmountsLib.printBalances("_withdrawFromPoolUniversal.finish with balances:", _depositorPoolAssets(), address(this));
  }

  /// @notice Convert all amounts withdrawn from the depositor to {asset}
  function _convertDepositorPoolAssets() internal {
    //!! console.log("_convertDepositorPoolAssets");
    address _asset = asset;
    //!! console.log('_convertDepositorPoolAssets balance before', _balance(_asset));

    address[] memory tokens = _depositorPoolAssets();
    uint len = tokens.length;

    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      address borrowedToken = tokens[i];
      if (_asset != borrowedToken) {
        (, uint leftover) = ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          _asset,
          borrowedToken,
          _balance(borrowedToken)
        );

        // Manually swap remain leftover
        if (leftover != 0) {
          ITetuLiquidator tetuLiquidator = ITetuLiquidator(IController(controller()).liquidator());
          ConverterStrategyBaseLib.liquidate(
            tetuLiquidator,
            borrowedToken,
            _asset,
            leftover,
            _ASSET_LIQUIDATION_SLIPPAGE,
            liquidationThresholds[_asset]
          );
          //!! console.log('SWAP LEFTOVER returned asset', balanceAfter - balanceBefore);
        }
      }
    }

    //!! console.log('_convertDepositorPoolAssets balance after', _balance(_asset));
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual {
    //!! console.log("_claim.start");
    // Rewards from the Depositor
    address[] memory tokens1;
    uint[] memory amounts1;
    (tokens1, amounts1) = _depositorClaimRewards();

    // Rewards from TetuConverter
    address[] memory tokens2;
    uint[] memory amounts2;
    (tokens2, amounts2) = tetuConverter.claimRewards(address(this));

    address[] memory tokens;
    uint[] memory amounts;

    // Join arrays and recycle tokens
    (tokens, amounts) = TokenAmountsLib.unite(tokens1, amounts1, tokens2, amounts2);
    //!! TokenAmountsLib.print("claim", tokens, amounts); // TODO remove

    // {amounts} contain just received tokens, but probably we already had some tokens on balance
    uint len = tokens.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      amounts[i] = IERC20(tokens[i]).balanceOf(address(this));
    }

    if (len > 0) {
      _recycle(tokens, amounts);
    }

    //!! console.log("_claim.end");
  }

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  function _recycle(address[] memory tokens, uint[] memory amounts) internal {
    //!! console.log("_recycle.start");
    require(tokens.length == amounts.length, "SB: Arrays mismatch");

    IForwarder _forwarder = IForwarder(IController(controller()).forwarder());

    address _asset = asset;
    uint _compoundRatio = compoundRatio;
    //!! console.log('_recycle._compoundRatio', _compoundRatio);

    uint len = tokens.length;
    uint[] memory amountsToForward = new uint[](len);

    // split each amount on two parts: a part-to-compound and a part-to-transfer-to-the-forwarder
    // the part-to-compound is converted to the main asset and kept on the balance up to the next investing
    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      address token = tokens[i];
      uint amount = amounts[i];

      //!! console.log('_recycle.token, amount', token, amount);
      uint tokenThreshold = liquidationThresholds[token];
      if (amount > tokenThreshold) {
        uint amountToCompound = amount * _compoundRatio / COMPOUND_DENOMINATOR;
        if (amountToCompound > 0) {
          ConverterStrategyBaseLib.liquidate(
            ITetuLiquidator(IController(controller()).liquidator()),
            token,
            _asset,
            amountToCompound,
            _REWARD_LIQUIDATION_SLIPPAGE,
            tokenThreshold
          );
        }

        uint amountToForward = amount - amountToCompound;
        //!! console.log('amountToCompound', amountToCompound);
        amountsToForward[i] = amountToForward;
        //!! console.log('amountToForward ', amountToForward);

        AppLib.approveIfNeeded(token, amountToForward, address(_forwarder));
      }
    }

    _forwarder.registerIncome(tokens, amountsToForward, ISplitter(splitter).vault(), true);
    //!! console.log("_recycle.end");
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Hardwork
  /////////////////////////////////////////////////////////////////////

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external pure returns (bool) {
    // check claimable amounts and compare with thresholds
    return true;
  }

  /// @notice Do hard work
  function doHardWork() override public returns (uint, uint) {
    return _doHardWork(true);
  }

  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function _doHardWork(bool reInvest) internal returns (uint earned, uint lost) {
    //!! console.log('doHardWork.1');
    uint assetBalanceBefore = _balance(asset);
    //!! console.log('doHardWork.2 assetBalanceBefore', assetBalanceBefore);
    _claim();
    uint assetBalanceAfterClaim = _balance(asset);
    //!! console.log('doHardWork.2 assetBalanceAfter', assetBalanceAfterClaim);

    earned = assetBalanceAfterClaim - assetBalanceBefore;
    lost = 0;
    //!! console.log('doHardWork.3 earned', earned);

    if (reInvest
      && assetBalanceAfterClaim > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_PERCENT_DENOMINATOR
    ) {// re-invest income
      uint investedBefore = _investedAssets;
      _depositToPool(assetBalanceAfterClaim);
      uint investedAfter = _investedAssets;

      //!! console.log('doHardWork.4 investedAfter, investedBefore, _unspentAsset', investedAfter, investedBefore, _unspentAsset);
      if (investedAfter > investedBefore) {
        // some amount can be not invested during _depositToPool
        // we shouldn't consider this amount as "earned"
        uint delta = investedAfter - investedBefore;
        if (_unspentAsset > delta) {
          _unspentAsset -= delta;
        } else {
          _unspentAsset = 0;
          earned += delta - _unspentAsset;
        }
        //!! console.log("doHardWork.5 earned, delta, _unspentAsset", earned, delta, _unspentAsset);
      } else {
        lost = investedBefore - investedAfter;
        //!! console.log("doHardWork.6 lost", lost);
      }
    } else {
      //!! console.log("doHardWork.7 reInvest skipped");
    }

    //!! console.log(">>> Asset balance after _doHardWork", _balance(asset));
  }


  /////////////////////////////////////////////////////////////////////
  ///               InvestedAssets Calculations
  /////////////////////////////////////////////////////////////////////

  /// @notice Updates cached _investedAssets to actual value
  /// @dev Should be called after deposit / withdraw / claim
  function _updateInvestedAssets() internal {
    //!! console.log('_updateInvestedAssets _investedAssets BEFORE', _investedAssets);
    _investedAssets = calcInvestedAssets();
    //!! console.log('_updateInvestedAssets _investedAssets AFTER', _investedAssets);
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because quoteRepay is writable (it updates current balances in the internal pools)
  /// @return estimatedAssets Invested asset amount under control (in terms of {asset})
  function calcInvestedAssets() public returns (uint estimatedAssets) {
    //!! console.log("calcInvestedAssets.start");
    uint liquidity = _depositorLiquidity();
    if (liquidity == 0) {
      estimatedAssets = 0;
    } else {
      uint[] memory amountsOut = _depositorQuoteExit(liquidity);
      address[] memory tokens = _depositorPoolAssets();

      address _asset = asset;
      estimatedAssets = 0;
      //!! console.log("calcInvestedAssets._asset", _asset);

      uint len = tokens.length;
      for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
        address borrowedToken = tokens[i];
        estimatedAssets += _asset == borrowedToken
          ? amountsOut[i]
          : tetuConverter.quoteRepay(address(this), _asset, borrowedToken, _balance(borrowedToken) + amountsOut[i]);
        //!! console.log("_balance(borrowedToken)", _balance(borrowedToken));
        //!! console.log("amountsOut[i]", amountsOut[i]);
        //!! console.log("estimatedAssets", estimatedAssets);
      }
    }
    //!! console.log("calcInvestedAssets.estimatedAssets", estimatedAssets);
  }

  /////////////////////////////////////////////////////////////////////
  ///               ITetuConverterCallback
  /////////////////////////////////////////////////////////////////////

  function requireAmountBack(
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address /*borrowAsset_*/,
    uint /*requiredAmountBorrowAsset_*/
  ) external override returns (
    uint amountOut,
    bool isCollateral
  ) {
    //!! console.log("requireAmountBack");
    address _tetuConverter = address(tetuConverter);
    require(msg.sender == _tetuConverter, "CSB: Only TetuConverter");
    require(collateralAsset_ == asset, 'CSB: Wrong asset');

    amountOut = 0;
    uint assetBalance = _balance(collateralAsset_);

    if (assetBalance >= requiredAmountCollateralAsset_) {
      amountOut = requiredAmountCollateralAsset_;

    } else {
      // we assume if withdraw less amount then requiredAmountCollateralAsset_
      // it will be rebalanced in the next call
      _withdrawFromPool(requiredAmountCollateralAsset_ - assetBalance);
      amountOut = _balance(collateralAsset_);
    }

    IERC20(collateralAsset_).safeTransfer(_tetuConverter, amountOut);
    isCollateral = true;

    //!! console.log(">>> Asset balance after requireAmountBack", _balance(asset));
  }

  function onTransferBorrowedAmount(
    address /*collateralAsset_*/,
    address /*borrowAsset_*/,
    uint /*amountBorrowAssetSentToBorrower_*/
  ) override pure external {
    // noop; will deposit amount received at the next hardwork
  }



  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[16] private __gap; // TODO 16???

}
