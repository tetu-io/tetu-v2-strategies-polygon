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

  /// @notice Amount of asset passed to _depositToPool that wasn't invested but was kept on the balance for a next round todo deprecated, use baseAmounts
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
    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_PERCENT_DENOMINATOR) {
      address[] memory tokens = _depositorPoolAssets();
      uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset);

      // prepare array of amounts ready to deposit, borrow missed amounts
      (uint[] memory amounts, uint[] memory borrowedAmounts, uint collateral) = _beforeDeposit(
        tetuConverter,
        amount_,
        tokens,
        indexAsset
      );

      // make deposit, actually consumed amounts can be different from the desired amounts
      (uint[] memory consumedAmounts,) = _depositorEnter(amounts);

      // adjust base-amounts
      _afterDeposit(tokens, indexAsset, consumedAmounts, borrowedAmounts, collateral);

      // adjust _investedAssets
      _updateInvestedAssets();
    }
  }

  /// @notice Prepare {tokenAmounts} to be passed to depositorEnter
  /// @param amount_ The amount of main asset that should be invested
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return tokenAmounts Amounts of depositor's assets ready to invest (this array can be passed to depositorEnter)
  /// @return borrowedAmounts Amounts that were borrowed to prepare {tokenAmounts}
  /// @return spentCollateral Total collateral spent to get {borrowedAmounts}
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) internal returns (
    uint[] memory tokenAmounts,
    uint[] memory borrowedAmounts,
    uint spentCollateral
  ) {
    // calculate required collaterals for each token and temporary save them to tokenAmounts
    // save to tokenAmounts[indexAsset_] already correct value
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
    tokenAmounts = ConverterStrategyBaseLib.getCollaterals(
      amount_,
      tokens_,
      weights,
      totalWeight,
      indexAsset_,
      IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle())
    );

    // make borrow and save amounts of tokens available for deposit to tokenAmounts
    // total collateral amount spent for borrowing
    uint len = tokens_.length;
    borrowedAmounts = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset_) continue;

      if (tokenAmounts[i] > 0) {
        borrowedAmounts[i] = ConverterStrategyBaseLib.borrowPosition(
          tetuConverter_,
          tokens_[indexAsset_],
          tokenAmounts[i],
          tokens_[i]
        );
        spentCollateral += tokenAmounts[i];
      }
      tokenAmounts[i] = IERC20(tokens_[i]).balanceOf(address(this));
    }

    //!! TokenAmountsLib.printBalances('Balance before:', tokens, address(this));

    return (tokenAmounts, borrowedAmounts, spentCollateral);
  }

  /// @notice Update base amounts and invested assets after deposit
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @param amountsConsumed_ Amounts deposited to the internal pool
  /// @param borrowed_ Amounts borrowed before the deposit
  /// @param collateral_ Amount of main {asset} spent to get {borrowed} amounts
  function _afterDeposit(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsConsumed_,
    uint[] memory borrowed_,
    uint collateral_
  ) internal {
    // update base-amounts
    uint len = tokens_.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset_) {
        _decreaseBaseAmount(tokens_[i], collateral_);
      } else {
        if (borrowed_[i] >= amountsConsumed_[i]) {
          _increaseBaseAmount(tokens_[i], borrowed_[i] - amountsConsumed_[i], 0);
        } else {
          _decreaseBaseAmount(tokens_[i], amountsConsumed_[i] - borrowed_[i]);
        }
      }
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

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

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return investedAssetsUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  function _withdrawFromPool(uint amount) override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    require(_investedAssets != 0, "CSB: no investments");
    if (amount != 0 && _investedAssets != 0) {
      uint liquidityAmount = _depositorLiquidity()  // total amount of LP tokens owned by the strategy
        * 101 // add 1% on top...
        * amount / _investedAssets // a part of amount that we are going to withdraw
        / 100; // .. add 1% on top

      (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);

      _withdrawFromPoolUniversal(liquidityAmount, false, false);
    }

    return (investedAssetsUSD, assetPrice);
  }

  /// @notice Withdraw all from the pool.
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  function _withdrawAllFromPool() override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    // total amount of LP-tokens deposited by the strategy
    uint liquidityAmount = _depositorLiquidity();

    // predict expected amount to be withdrawn (in USD)
    (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
    _withdrawFromPoolUniversal(liquidityAmount, false, true);
  }

  /// @notice If pool support emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    _withdrawFromPoolUniversal(0, true, true);
  }

  /// @param repayAll_ After withdraw convert (all available on balance OR withdrawn only) amounts to the main asset
  function _withdrawFromPoolUniversal(uint liquidityAmount_, bool emergency_, bool repayAll_) internal {
    // withdraw the amount from the depositor to balance of the strategy
    uint[] memory amountsOut = emergency_
      ? _depositorEmergencyExit()
      : _depositorExit(liquidityAmount_);

    // convert amounts to the main asset
    _convertDepositorPoolAssets();
    _updateInvestedAssets();
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
  ///                 Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual {
    //!! console.log("_claim.start");
    // Rewards from the Depositor
    (address[] memory tokens, uint[] memory amounts) = _depositorClaimRewards();

    ConverterStrategyBaseLib.processClaims(
      tetuConverter,
      tokens,
      amounts,
      _recycle
    );
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

  /// @notice A virtual handler to make any action before hardwork
  function _preHardWork(bool reInvest) internal virtual {}

  /// @notice A virtual handler to make any action after hardwork
  function _postHardWork() internal virtual {}

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual pure returns (bool) {
    // check claimable amounts and compare with thresholds
    return true;
  }

  /// @notice Do hard work
  function doHardWork() override public returns (uint, uint) {
    return _doHardWork(true);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() internal virtual returns (uint earned, uint lost) {
    uint assetBalanceBefore = _balance(asset);
    _claim();
    uint assetBalanceAfterClaim = _balance(asset);

    if (assetBalanceAfterClaim > assetBalanceBefore) {
      earned = assetBalanceAfterClaim - assetBalanceBefore;
    } else {
      lost = assetBalanceBefore - assetBalanceAfterClaim;
    }

    return (earned, lost);
  }

  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function _doHardWork(bool reInvest) internal returns (uint earned, uint lost) {
    _preHardWork(reInvest);
    (earned, lost) = _handleRewards();
    uint assetBalance = _balance(asset);

    // re-invest income
    if (reInvest
      && assetBalance > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_PERCENT_DENOMINATOR
    ) {
      uint investedBefore = _investedAssets;
      _depositToPool(assetBalance);
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
    }

    //!! console.log(">>> Asset balance after _doHardWork", _balance(asset));
    _postHardWork();
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
  uint[50] private __gap;

}
