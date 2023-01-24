// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
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

import "hardhat/console.sol";

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

  // approx one month for average block time 2 sec
  uint private constant _LOAN_PERIOD_IN_BLOCKS = 30 days / 2;

  uint private constant _REWARD_LIQUIDATION_SLIPPAGE = 5_000; // 5%
  uint private constant _ASSET_LIQUIDATION_SLIPPAGE = 500; // 0.5%

  /////////////////////////////////////////////////////////////////////
  //                        VARIABLES
  //                Keep names and ordering!
  //                 Add only in the bottom.
  /////////////////////////////////////////////////////////////////////

  /// @dev Amount of underlying assets invested to the pool.
  uint private _investedAssets;

  /// @dev Linked Tetu Converter
  ITetuConverter public tetuConverter;

  /// @dev Minimum token amounts to liquidate etc.
  mapping(address => uint) public thresholds;

  event ThresholdChanged(address token, uint amount);


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
    console.log("__ConverterStrategyBase_init, totalSupply", _depositorTotalSupply());
  }

  function setThreshold(address token, uint amount) public {
    console.log("ConverterStrategyBase.setThreshold", token, amount);
    _onlyOperators();
    thresholds[token] = amount;
    emit ThresholdChanged(token, amount);
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Deposit to the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Amount of underlying assets converted to pool assets and invested to the pool.
  function investedAssets() override public view virtual returns (uint) {
    return _investedAssets;
  }

  /// @notice Deposit given amount to the pool.
  function _depositToPool(uint amount) override internal virtual {
    console.log('_depositToPool amount', amount);

    address _asset = asset;
    // skip deposit for small amounts
    if (amount < thresholds[_asset]) {
      console.log('_depositToPool thresholds', thresholds[_asset]);
      return;
    }

    address[] memory tokens = _depositorPoolAssets();
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();

    uint len = tokens.length;
    uint[] memory tokenAmounts = new uint[](len);

    console.log('Balance before:');
    TokenAmountsLib.printBalances(tokens, address(this));

    // split the amount on tokens proportionally to the weights
    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      uint assetAmountForToken = amount * weights[i] / totalWeight;
      address token = tokens[i];

      if (token == _asset) {
        tokenAmounts[i] = assetAmountForToken;
      } else {
        uint tokenBalance = _balance(token);
        if (tokenBalance >= assetAmountForToken) {
          // we already have enough tokens
           tokenAmounts[i] = tokenBalance;
        } else {
          // we do not have enough tokens - borrow
          uint collateral = assetAmountForToken - tokenBalance;
          _borrowPosition(_asset, collateral, token);
          tokenAmounts[i] = _balance(token);
        }
      }
    }

    _depositorEnter(tokenAmounts);
    _updateInvestedAssets();

    console.log('Amounts for enter:');
    TokenAmountsLib.print(tokens, tokenAmounts);

    console.log('Balance after:');
    TokenAmountsLib.printBalances(tokens, address(this));

    console.log(">>> Asset balance after _depositToPool", _balance(asset));
  }


  /////////////////////////////////////////////////////////////////////
  ///                     Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return investedAssetsUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  function _withdrawFromPool(uint amount) override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    console.log("_withdrawFromPool.1 amount", amount);

    require(_investedAssets != 0, "CSB: no investments");
    if (amount != 0 && _investedAssets != 0) {
      uint liquidityAmount = _depositorLiquidity()  // total amount of LP tokens owned by the strategy
        * 101 // add 1% on top...
        * amount / _investedAssets // a part of amount that we are going to withdraw
        / 100; // .. add 1% on top
      (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
      _withdrawFromPoolUniversal(liquidityAmount, false);
      console.log("_withdrawFromPool.2 liquidityAmount", liquidityAmount);
    }

    console.log("_withdrawFromPool.3 investedAssetsUSD, assetPrice", investedAssetsUSD, assetPrice);
    console.log(">>> Asset balance after _withdrawFromPool", _balance(asset));
    return (investedAssetsUSD, assetPrice);
  }

  /// @notice Withdraw all from the pool.
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  function _withdrawAllFromPool() override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    console.log("_withdrawAllFromPool.start");
    // total amount of LP-tokens deposited by the strategy
    uint liquidityAmount = _depositorLiquidity();

    // predict expected amount to be withdrawn (in USD)
    (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
    _withdrawFromPoolUniversal(liquidityAmount, false);
    console.log("_withdrawAllFromPool.finish");
    console.log(">>> Asset balance after _withdrawAllFromPool", _balance(asset));
  }

  /// @notice If pool support emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    _withdrawFromPoolUniversal(0, true);
    console.log(">>> Asset balance after _emergencyExitFromPool", _balance(asset));
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
    console.log("_withdrawFromPoolUniversal");

    // withdraw the amount from the depositor to balance of the strategy
    if (emergency_) {
      _depositorEmergencyExit();
    } else {
      console.log("_withdrawFromPoolUniversal liquidityAmount", liquidityAmount_);
      _depositorExit(liquidityAmount_);
    }

    console.log('/// Balance after withdraw:');
    TokenAmountsLib.printBalances(_depositorPoolAssets(), address(this));

    // convert all received amounts to the asset
    _convertDepositorPoolAssets();
    _updateInvestedAssets();

    console.log("_withdrawFromPoolUniversal.finish with balances:");
    TokenAmountsLib.printBalances(_depositorPoolAssets(), address(this));
  }

  /// @notice Convert all amounts withdrawn from the depositor to {asset}
  function _convertDepositorPoolAssets() internal {
    console.log("_convertDepositorPoolAssets");
    address _asset = asset;
    console.log('_convertDepositorPoolAssets balance before', _balance(_asset));

    address[] memory tokens = _depositorPoolAssets();
    uint len = tokens.length;

    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      address borrowedToken = tokens[i];
      if (_asset != borrowedToken) {
        _closePosition(_asset, borrowedToken, _balance(borrowedToken));
      }
    }

    console.log('_convertDepositorPoolAssets balance after', _balance(_asset));
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual {
    console.log("_claim.start");
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

    TokenAmountsLib.print(tokens, amounts); // TODO remove

    if (tokens.length > 0) {
      _recycle(tokens, amounts);
    }

    console.log("_claim.end");
  }

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  function _recycle(address[] memory tokens, uint[] memory amounts) internal {
    console.log("_recycle.start");
    require(tokens.length == amounts.length, "SB: Arrays mismatch");

    ITetuLiquidator _tetuLiquidator = ITetuLiquidator(IController(controller()).liquidator());
    IForwarder _forwarder = IForwarder(IController(controller()).forwarder());

    address _asset = asset;
    uint _compoundRatio = compoundRatio;
    console.log('_recycle._compoundRatio', _compoundRatio);

    uint len = tokens.length;
    uint[] memory amountsToForward = new uint[](len);

    // split each amount on two parts: a part-to-compound and a part-to-transfer-to-the-forwarder
    // the part-to-compound is converted to the main asset and kept on the balance up to the next investing
    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      address token = tokens[i];
      uint amount = amounts[i];

      console.log('_recycle.token, amount', token, amount);
      if (amount != 0 && amount > thresholds[token]) {
        uint amountToCompound = amount * _compoundRatio / COMPOUND_DENOMINATOR;
        if (amountToCompound > 0) {
          _liquidate(_tetuLiquidator, token, _asset, amountToCompound, _REWARD_LIQUIDATION_SLIPPAGE);
        }

        uint amountToForward = amount - amountToCompound;
        console.log('amountToCompound', amountToCompound);
        amountsToForward[i] = amountToForward;
        console.log('amountToForward ', amountToForward);

        AppLib.approveIfNeeded(token, amountToForward, address(_forwarder));
      }
    }

    _forwarder.registerIncome(tokens, amountsToForward, ISplitter(splitter).vault(), true);
    console.log("_recycle.end");
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
    console.log('doHardWork.1');
    uint assetBalanceBefore = _balance(asset);
    console.log('doHardWork.2 assetBalanceBefore', assetBalanceBefore);
    _claim();
    uint assetBalanceAfter = _balance(asset);
    console.log('doHardWork.2 assetBalanceAfter', assetBalanceAfter);

    earned = assetBalanceAfter - assetBalanceBefore;
    lost = 0;
    console.log('doHardWork.3 earned', earned);

    if (reInvest && assetBalanceAfter > 0) {// re-invest income
      uint investedBefore = _investedAssets;
      _depositToPool(assetBalanceAfter);
      uint investedAfter = _investedAssets;

      if (investedAfter > investedBefore) {
        earned += investedAfter - investedBefore;
        console.log("doHardWork.4 earned", earned);
      } else {
        lost = investedBefore - investedAfter;
        console.log("doHardWork.5 lost", lost);
      }
    }

    console.log(">>> Asset balance after _doHardWork", _balance(asset));
  }


  /////////////////////////////////////////////////////////////////////
  ///               InvestedAssets Calculations
  /////////////////////////////////////////////////////////////////////

  /// @notice Updates cached _investedAssets to actual value
  /// @dev Should be called after deposit / withdraw / claim
  function _updateInvestedAssets() internal {
    console.log('_updateInvestedAssets _investedAssets BEFORE', _investedAssets);
    _investedAssets = calcInvestedAssets();
    console.log('_updateInvestedAssets _investedAssets AFTER', _investedAssets);
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because quoteRepay is writable (it updates current balances in the internal pools)
  /// @return estimatedAssets Invested asset amount under control (in terms of {asset})
  function calcInvestedAssets() public returns (uint estimatedAssets) {
    console.log("calcInvestedAssets.start");
    uint liquidity = _depositorLiquidity();
    if (liquidity == 0) {
      estimatedAssets = 0;
    } else {
      uint[] memory amountsOut = _depositorQuoteExit(liquidity);
      address[] memory tokens = _depositorPoolAssets();

      address _asset = asset;
      estimatedAssets = 0;
      console.log("calcInvestedAssets._asset", _asset);

      uint len = tokens.length;
      for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
        address borrowedToken = tokens[i];
        estimatedAssets += _asset == borrowedToken
          ? amountsOut[i]
          : tetuConverter.quoteRepay(address(this), _asset, borrowedToken, _balance(borrowedToken) + amountsOut[i]);
        console.log("_balance(borrowedToken)", _balance(borrowedToken));
        console.log("amountsOut[i]", amountsOut[i]);
        console.log("estimatedAssets", estimatedAssets);
      }
    }
    console.log("calcInvestedAssets.estimatedAssets", estimatedAssets);
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
    console.log("requireAmountBack");
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

    console.log(">>> Asset balance after requireAmountBack", _balance(asset));
  }

  function onTransferBorrowedAmount(
    address /*collateralAsset_*/,
    address /*borrowAsset_*/,
    uint /*amountBorrowAssetSentToBorrower_*/
  ) override pure external {
    // noop; will deposit amount received at the next hardwork
  }


  /////////////////////////////////////////////////////////////////////
  ///                        HELPERS
  /////////////////////////////////////////////////////////////////////

  function _borrowPosition(
    address collateralAsset,
    uint collateralAmount,
    address borrowAsset
  ) internal returns (uint borrowedAmountOut) {
    console.log('_borrowPosition col, amt, bor', collateralAsset, collateralAmount, borrowAsset);
    ITetuConverter _tetuConverter = tetuConverter;

    AppLib.approveIfNeeded(collateralAsset, collateralAmount, address(_tetuConverter));
    (address converter, uint maxTargetAmount, /*int apr18*/) = _tetuConverter.findBorrowStrategy(
      collateralAsset,
      collateralAmount,
      borrowAsset,
      _LOAN_PERIOD_IN_BLOCKS
    );
    console.log('converter, maxTargetAmount', converter, maxTargetAmount);

    if (converter == address(0) || maxTargetAmount == 0) {
      borrowedAmountOut = 0;
    } else {
      // we need to approve collateralAmount before the borrow-call but we already made the approval above
      borrowedAmountOut = _tetuConverter.borrow(
        converter,
        collateralAsset,
        collateralAmount,
        borrowAsset,
        maxTargetAmount,
        address(this)
      );
    }

    console.log('>>> BORROW collateralAmount collateralAsset', collateralAmount, collateralAsset);
    console.log('>>> BORROW borrowedAmount borrowAsset', borrowedAmountOut, borrowAsset);
  }

  /// @notice Close the given position, pay {amountToRepay}, return collateral amount in result
  /// @dev If amount-to-repay is bigger then actual amount of debt, manually convert leftover to collateral amount
  /// @param amountToRepay Amount to repay in terms of {borrowAsset}
  function _closePosition(address collateralAsset, address borrowAsset, uint amountToRepay) internal returns (
    uint returnedAssetAmount
  ) {
    console.log("_closePosition");
    ITetuConverter _tetuConverter = tetuConverter;

    // We shouldn't try to pay more than we actually need to repay
    // The leftover will be swapped inside TetuConverter, it's inefficient.
    // Let's limit amountToRepay by needToRepay-amount
    (uint needToRepay,) = _tetuConverter.getDebtAmountCurrent(address(this), collateralAsset, borrowAsset);
    uint leftover = amountToRepay > needToRepay
      ? amountToRepay - needToRepay
      : 0;

    console.log('>>> CLOSE POSITION initial amountToRepay borrowAsset', amountToRepay, borrowAsset);
    console.log('>>> CLOSE POSITION needToRepay', needToRepay);
    console.log('>>> CLOSE POSITION leftover', leftover);

    amountToRepay = amountToRepay < needToRepay
      ? amountToRepay
      : needToRepay;

    // Make full/partial repayment
    IERC20(borrowAsset).safeTransfer(address(_tetuConverter), amountToRepay);
    uint returnedBorrowAmountOut;
    (returnedAssetAmount,
      returnedBorrowAmountOut,
      /*uint swappedLeftoverCollateralOut*/,
      /*uint swappedLeftoverBorrowOut*/
    ) = _tetuConverter.repay(collateralAsset, borrowAsset, amountToRepay, address(this));

    console.log('>>> position closed: returnedAssetAmount:', returnedAssetAmount, collateralAsset);
    console.log('position closed: returnedBorrowAmountOut:', returnedBorrowAmountOut);
    console.log('>>> REPAY amountToRepay, borrowAsset', amountToRepay, borrowAsset);
    require(returnedBorrowAmountOut == 0, 'CSB: Can not convert back');

    // Manually swap remain leftover
    if (leftover != 0) {
      uint balanceBefore = _balance(collateralAsset);
      ITetuLiquidator _tetuLiquidator = ITetuLiquidator(IController(controller()).liquidator());
      _liquidate(_tetuLiquidator, borrowAsset, collateralAsset, leftover, _ASSET_LIQUIDATION_SLIPPAGE);
      uint balanceAfter = _balance(collateralAsset);

      console.log('SWAP LEFTOVER returned asset', balanceAfter - balanceBefore);
      returnedAssetAmount += balanceAfter - balanceBefore;
    }
  }

  function _liquidate(
    ITetuLiquidator _liquidator,
    address tokenIn,
    address tokenOut,
    uint amountIn,
    uint slippage
  ) internal {
    console.log("_liquidate", amountIn);
    (ITetuLiquidator.PoolData[] memory route, /* string memory error*/) = _liquidator.buildRoute(tokenIn, tokenOut);

    if (route.length == 0) {
      revert('CSB: No liquidation route');
    }

    // calculate balance in out value for check threshold
    uint amountOut = _liquidator.getPriceForRoute(route, amountIn);

    // if the value higher than threshold distribute to destinations
    if (amountOut > thresholds[tokenOut]) {
      // we need to approve each time, liquidator address can be changed in controller
      AppLib.approveIfNeeded(tokenIn, amountIn, address(_liquidator));
      _liquidator.liquidateWithRoute(route, amountIn, slippage);
    }
  }



  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[16] private __gap; // TODO 16???

}
