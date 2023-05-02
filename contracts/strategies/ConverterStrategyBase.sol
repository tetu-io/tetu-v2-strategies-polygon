// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverterCallback.sol";
import "./ConverterStrategyBaseLib.sol";
import "./ConverterStrategyBaseLib2.sol";
import "./DepositorBase.sol";

/////////////////////////////////////////////////////////////////////
///                        TERMS
///  Main asset == underlying: the asset deposited to the vault by users
///  Secondary assets: all assets deposited to the internal pool except the main asset
/////////////////////////////////////////////////////////////////////

/// @title Abstract contract for base Converter strategy functionality
/// @notice All depositor assets must be correlated (ie USDC/USDT/DAI)
/// @author bogdoslav, dvpublic
abstract contract ConverterStrategyBase is ITetuConverterCallback, DepositorBase, StrategyBaseV2 {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  //region DATA TYPES
  /////////////////////////////////////////////////////////////////////

  struct WithdrawUniversalLocal {
    bool all;
    uint investedAssetsBeforeWithdraw;
    uint[] reservesBeforeWithdraw;
    uint totalSupplyBeforeWithdraw;
    uint depositorLiquidity;
    uint liquidityAmountToWithdraw;
    uint assetPrice;
    uint[] amountsToConvert;
    uint expectedTotalMainAssetAmount;
    uint[] expectedMainAssetAmounts;
    uint investedAssetsAfterWithdraw;
    uint balanceAfterWithdraw;
    address[] tokens;
    address asset;
  }
  //endregion DATA TYPES

  /////////////////////////////////////////////////////////////////////
  //region CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.1.5";

  /// @notice 1% gap to cover possible liquidation inefficiency
  /// @dev We assume that: conversion-result-calculated-by-prices - liquidation-result <= the-gap
  uint internal constant GAP_CONVERSION = 1_000;
  uint internal constant DENOMINATOR = 100_000;
  //endregion CONSTANTS

  /////////////////////////////////////////////////////////////////////
  //region VARIABLES
  //                Keep names and ordering!
  // Add only in the bottom and don't forget to decrease gap variable
  /////////////////////////////////////////////////////////////////////

  /// @dev Amount of underlying assets invested to the pool.
  uint internal _investedAssets;

  /// @dev Linked Tetu Converter
  ITetuConverter public converter;

  /// @notice Minimum token amounts that can be liquidated
  mapping(address => uint) public liquidationThresholds;

  /// @notice Percent of asset amount that can be not invested, it's allowed to just keep it on balance
  ///         decimals = {DENOMINATOR}
  /// @dev We need this threshold to avoid numerous conversions of small amounts
  uint public reinvestThresholdPercent;
  //endregion VARIABLES

  /////////////////////////////////////////////////////////////////////
  //region Events
  /////////////////////////////////////////////////////////////////////
  event LiquidationThresholdChanged(address token, uint amount);
  event ReinvestThresholdPercentChanged(uint amount);
  event OnDepositorEnter(uint[] amounts, uint[] consumedAmounts);
  event OnDepositorExit(uint liquidityAmount, uint[] withdrawnAmounts);
  event OnDepositorEmergencyExit(uint[] withdrawnAmounts);

  /// @notice Recycle was made
  /// @param rewardTokens Full list of reward tokens received from tetuConverter and depositor
  /// @param amountsToForward Amounts to be sent to forwarder
  event Recycle(
    address[] rewardTokens,
    uint[] amountsToForward,
    uint[] performanceAmounts
  );
  //endregion Events

  /////////////////////////////////////////////////////////////////////
  //region Initialization and configuration
  /////////////////////////////////////////////////////////////////////

  /// @notice Initialize contract after setup it as proxy implementation
  function __ConverterStrategyBase_init(
    address controller_,
    address splitter_,
    address converter_
  ) internal onlyInitializing {
    __StrategyBase_init(controller_, splitter_);
    converter = ITetuConverter(converter_);

    // 1% by default
    reinvestThresholdPercent = DENOMINATOR / 100;
    emit ReinvestThresholdPercentChanged(DENOMINATOR / 100);
  }

  function setLiquidationThreshold(address token, uint amount) external {
    StrategyLib.onlyOperators(controller());
    liquidationThresholds[token] = amount;
    emit LiquidationThresholdChanged(token, amount);
  }

  /// @param percent_ New value of the percent, decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  function setReinvestThresholdPercent(uint percent_) external {
    StrategyLib.onlyOperators(controller());
    require(percent_ <= DENOMINATOR, StrategyLib.WRONG_VALUE);

    reinvestThresholdPercent = percent_;
    emit ReinvestThresholdPercentChanged(percent_);
  }
  //endregion Initialization and configuration

  /////////////////////////////////////////////////////////////////////
  //region Deposit to the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Amount of underlying assets converted to pool assets and invested to the pool.
  function investedAssets() override public view virtual returns (uint) {
    return _investedAssets;
  }

  /// @notice Deposit given amount to the pool.
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    uint strategyLoss
  ){
    uint updatedInvestedAssets;
    // we need to compensate difference between last updated invested assets and the current value for do not allow share price fluctuation
    (updatedInvestedAssets, strategyLoss) = _updateInvestedAssetsAndGetLoss(updateTotalAssetsBeforeInvest_);

    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * updatedInvestedAssets / DENOMINATOR) {
      address _asset = asset;
      uint balanceBefore = AppLib.balance(_asset);
      (address[] memory tokens, uint indexAsset) = _getTokens(asset);

      // prepare array of amounts ready to deposit, borrow missed amounts
      uint[] memory amounts = _beforeDeposit(converter, amount_, tokens, indexAsset);

      // make deposit, actually consumed amounts can be different from the desired amounts
      (uint[] memory consumedAmounts,) = _depositorEnter(amounts);
      emit OnDepositorEnter(amounts, consumedAmounts);

      // update _investedAssets with new deposited amount
      uint updatedInvestedAssetsAfterDeposit = _updateInvestedAssets();
      // after deposit some asset can exist
      uint balanceAfter = AppLib.balance(_asset);

      // we need to compensate difference if during deposit we lost some assets
      if ((updatedInvestedAssetsAfterDeposit + balanceAfter) < (updatedInvestedAssets + balanceBefore)) {
        strategyLoss += (updatedInvestedAssets + balanceBefore) - (updatedInvestedAssetsAfterDeposit + balanceAfter);
      }
    }
  }
  //endregion Deposit to the pool

  /////////////////////////////////////////////////////////////////////
  //region Convert amounts before deposit
  /////////////////////////////////////////////////////////////////////

  /// @notice Prepare {tokenAmounts} to be passed to depositorEnter
  /// @dev Override this function to customize entry kind
  /// @param amount_ The amount of main asset that should be invested
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return tokenAmounts Amounts of depositor's assets ready to invest (this array can be passed to depositorEnter)
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    // calculate required collaterals for each token and temporary save them to tokenAmounts
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
    // temporary save collateral to tokensAmounts
    tokenAmounts = ConverterStrategyBaseLib2.getCollaterals(
      amount_,
      tokens_,
      weights,
      totalWeight,
      indexAsset_,
      IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle())
    );

    // make borrow and save amounts of tokens available for deposit to tokenAmounts, zero result amounts are possible
    tokenAmounts = ConverterStrategyBaseLib.getTokenAmounts(
      tetuConverter_,
      tokens_,
      indexAsset_,
      tokenAmounts,
      liquidationThresholds[tokens_[indexAsset_]]
    );
  }
  //endregion Convert amounts before deposit

  /////////////////////////////////////////////////////////////////////
  //region Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

  function _beforeWithdraw(uint /*amount*/) internal virtual {
    // do nothing
  }

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset in addition to the exist balance.
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  /// @return strategyLoss Loss should be covered from Insurance
  function _withdrawFromPool(uint amount) override internal virtual returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss
  ) {
    (expectedWithdrewUSD, assetPrice, strategyLoss) = _withdrawUniversal(amount);
  }

  /// @notice Withdraw all from the pool.
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  /// @return strategyLoss Loss should be covered from Insurance
  function _withdrawAllFromPool() override internal virtual returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss
  ) {
    (expectedWithdrewUSD, assetPrice, strategyLoss) = _withdrawUniversal(type(uint).max);
  }

  /// @param amount Amount to be trying to withdrawn. Max uint means attempt to withdraw all possible invested assets.
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing in terms of USD value of each asset in the pool
  /// @return __assetPrice Price of the {asset} taken from the price oracle
  /// @return strategyLoss Loss before withdrawing: [new-investedAssets - old-investedAssets]
  function _withdrawUniversal(uint amount) internal returns (
    uint expectedWithdrewUSD,
    uint __assetPrice,
    uint strategyLoss
  ) {
    _beforeWithdraw(amount);

    WithdrawUniversalLocal memory v;
    v.all = amount == type(uint).max;
    (v.investedAssetsBeforeWithdraw, strategyLoss) = _updateInvestedAssetsAndGetLoss(true);

    if ((v.all || amount != 0) && v.investedAssetsBeforeWithdraw != 0) {

      // --- init variables ---
      v.tokens = _depositorPoolAssets();
      v.asset = asset;
      ITetuConverter _converter = converter;
      uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(v.tokens, v.asset);
      uint balanceBefore = AppLib.balance(v.asset);

      v.reservesBeforeWithdraw = _depositorPoolReserves();
      v.totalSupplyBeforeWithdraw = _depositorTotalSupply();
      v.depositorLiquidity = _depositorLiquidity();
      v.assetPrice = ConverterStrategyBaseLib.getAssetPriceFromConverter(_converter, v.asset);
      // -----------------------

      // calculate how much liquidity we need to withdraw for getting the requested amount
      (v.liquidityAmountToWithdraw, v.amountsToConvert) = ConverterStrategyBaseLib2.getLiquidityAmount(
        v.all ? 0 : amount,
        address(this),
        v.tokens,
        indexAsset,
        _converter,
        v.investedAssetsBeforeWithdraw,
        v.depositorLiquidity
      );

      if (v.liquidityAmountToWithdraw != 0) {

        // =============== WITHDRAW =====================
        // make withdraw
        uint[] memory withdrawnAmounts = _depositorExit(v.liquidityAmountToWithdraw);
        // the depositor is able to use less liquidity than it was asked, i.e. Balancer-depositor leaves some BPT unused
        // use what exactly was withdrew instead of the expectation
        // assume that liquidity cannot increase in _depositorExit
        v.liquidityAmountToWithdraw = v.depositorLiquidity - _depositorLiquidity();
        emit OnDepositorExit(v.liquidityAmountToWithdraw, withdrawnAmounts);
        // ==============================================

        // we need to call expectation after withdraw for calculate it based on the real liquidity amount that was withdrew
        // it should be called BEFORE the converter will touch our positions coz we need to call quote the estimations
        // amountsToConvert should contains amounts was withdrawn from the pool and amounts received from the converter
        (v.expectedMainAssetAmounts, v.amountsToConvert) = ConverterStrategyBaseLib.postWithdrawActions(
          _converter,
          v.tokens,
          indexAsset,
          v.reservesBeforeWithdraw,
          v.liquidityAmountToWithdraw,
          v.totalSupplyBeforeWithdraw,
          v.amountsToConvert,
          withdrawnAmounts
        );
      } else {
        // we don't need to withdraw any amounts from the pool, available converted amounts are enough for us
        v.expectedMainAssetAmounts = ConverterStrategyBaseLib.postWithdrawActionsEmpty(
          _converter,
          v.tokens,
          indexAsset,
          v.amountsToConvert
        );
      }

      // convert amounts to main asset
      // it is safe to use amountsToConvert from expectation - we will try to repay only necessary amounts
      v.expectedTotalMainAssetAmount += _makeRequestedAmount(
        v.tokens,
        indexAsset,
        v.amountsToConvert,
        _converter,
        amount,
        v.expectedMainAssetAmounts
      );

      v.investedAssetsAfterWithdraw = _updateInvestedAssets();
      v.balanceAfterWithdraw = AppLib.balance(v.asset);

      // we need to compensate difference if during withdraw we lost some assets
      if ((v.investedAssetsAfterWithdraw + v.balanceAfterWithdraw) < (v.investedAssetsBeforeWithdraw + balanceBefore)) {
        strategyLoss += (v.investedAssetsBeforeWithdraw + balanceBefore) - (v.investedAssetsAfterWithdraw + v.balanceAfterWithdraw);
      }

      return (
        v.expectedTotalMainAssetAmount * v.assetPrice / 1e18,
        v.assetPrice,
        strategyLoss
      );
    }
    return (0, 0, 0);
  }

  /// @notice If pool supports emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    uint[] memory withdrawnAmounts = _depositorEmergencyExit();
    emit OnDepositorEmergencyExit(withdrawnAmounts);

    // convert amounts to main asset
    (address[] memory tokens, uint indexAsset) = _getTokens(asset);
    ConverterStrategyBaseLib.closePositionsToGetAmount(
      converter,
      _getLiquidator(controller()),
      indexAsset,
      liquidationThresholds,
      type(uint).max,
      tokens
    );

    // adjust _investedAssets
    _updateInvestedAssets();
  }
  //endregion Withdraw from the pool

  /////////////////////////////////////////////////////////////////////
  //region Convert amounts after withdraw
  /////////////////////////////////////////////////////////////////////

  /// @notice Convert {amountsToConvert_} to the main {asset}
  ///         Swap leftovers (if any) to the main asset.
  ///         If result amount is less than expected, try to close any other available debts (1 repay per block only)
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @param requestedAmount Amount to be withdrawn in terms of the asset in addition to the exist balance.
  ///        Max uint means attempt to withdraw all possible invested assets.
  /// @param amountsToConvert_ Amounts available for conversion after withdrawing from the pool
  /// @param expectedMainAssetAmounts Amounts of main asset that we expect to receive after conversion amountsToConvert_
  /// @return expectedAmount Expected total amount of main asset after all conversions, swaps and repays
  function _makeRequestedAmount(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_,
    ITetuConverter converter_,
    uint requestedAmount,
    uint[] memory expectedMainAssetAmounts
  ) internal returns (
    uint expectedAmount
  ) {
    // get the total expected amount
    for (uint i; i < tokens_.length; i = AppLib.uncheckedInc(i)) {
      expectedAmount += expectedMainAssetAmounts[i];
    }

    // we cannot repay a debt twice
    // suppose, we have usdt = 1 and we need to convert it to usdc, then get additional usdt=10 and make second repay
    // But: we cannot make repay(1) and than repay(10). We MUST make single repay(11)

    ITetuLiquidator liquidator = _getLiquidator(controller());
    if (requestedAmount != type(uint).max
      && expectedAmount > requestedAmount * (GAP_CONVERSION + DENOMINATOR) / DENOMINATOR
    ) {
      // amountsToConvert_ are enough to get requestedAmount
      ConverterStrategyBaseLib.convertAfterWithdraw(
        converter_,
        liquidator,
        indexAsset_,
        liquidationThresholds[tokens_[indexAsset_]],
        tokens_,
        amountsToConvert_
      );
    } else {
      // amountsToConvert_ are NOT enough to get requestedAmount
      // We are allowed to make only one repay per block, so, we shouldn't try to convert amountsToConvert_
      // We should try to close the exist debts instead:
      //    convert a part of main assets to get amount of secondary assets required to repay the debts
      // and only then make conversion.
      expectedAmount = ConverterStrategyBaseLib.closePositionsToGetAmount(
        converter_,
        liquidator,
        indexAsset_,
        liquidationThresholds,
        requestedAmount,
        tokens_
      ) + expectedMainAssetAmounts[indexAsset_];
    }

    return expectedAmount;
  }
  //endregion Convert amounts after withdraw

  /////////////////////////////////////////////////////////////////////
  //region Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual returns (address[] memory rewardTokensOut, uint[] memory amountsOut) {
    // get rewards from the Depositor
    (address[] memory rewardTokens, uint[] memory rewardAmounts, uint[] memory balancesBefore) = _depositorClaimRewards();

    (rewardTokensOut, amountsOut) = ConverterStrategyBaseLib2.claimConverterRewards(
      converter,
      _depositorPoolAssets(),
      rewardTokens,
      rewardAmounts,
      balancesBefore
    );
  }

  /// @dev Call recycle process and send tokens to forwarder.
  ///      Need to be separated from the claim process - the claim can be called by operator for other purposes.
  function _rewardsLiquidation(address[] memory rewardTokens, uint[] memory amounts) internal {
    uint len = rewardTokens.length;
    if (len > 0) {
      uint[] memory amountsToForward = _recycle(rewardTokens, amounts);

      // send forwarder-part of the rewards to the forwarder
      ConverterStrategyBaseLib2.sendTokensToForwarder(controller(), splitter, rewardTokens, amountsToForward);
    }
  }

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  /// We have two kinds of rewards:
  /// 1) rewards in depositor's assets (the assets returned by _depositorPoolAssets)
  /// 2) any other rewards
  /// All received rewards divided on two parts: to forwarder, to compound
  ///   Compound-part of Rewards-2 can be liquidated
  ///   Compound part of Rewards-1 should be just added to baseAmounts
  /// All forwarder-parts are returned in amountsToForward and should be transferred to the forwarder.
  /// @dev {_recycle} is implemented as separate (inline) function to simplify unit testing
  /// @param rewardTokens_ Full list of reward tokens received from tetuConverter and depositor
  /// @param rewardAmounts_ Amounts of {rewardTokens_}; we assume, there are no zero amounts here
  /// @return amountsToForward Amounts to be sent to forwarder
  function _recycle(
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) internal returns (uint[] memory amountsToForward) {
    // send performance-part of the rewards to performanceReceiver
    (uint[] memory rewardAmounts, uint[] memory performanceAmounts) = ConverterStrategyBaseLib2.sendPerformanceFee(
        performanceFee,
        performanceReceiver,
        splitter,
        rewardTokens_,
        rewardAmounts_
      );

    // send other part of rewards to forwarder/compound
    (amountsToForward) = ConverterStrategyBaseLib.recycle(
      converter,
      asset,
      compoundRatio,
      _depositorPoolAssets(),
      _getLiquidator(controller()),
      liquidationThresholds,
      rewardTokens_,
      rewardAmounts
    );

    emit Recycle(
      rewardTokens_,
      amountsToForward,
      performanceAmounts
    );
  }
  //endregion Claim rewards

  /////////////////////////////////////////////////////////////////////
  //region Hardwork
  /////////////////////////////////////////////////////////////////////

  /// @notice A virtual handler to make any action before hardwork
  function _preHardWork(bool reInvest) internal virtual {}

  /// @notice A virtual handler to make any action after hardwork
  function _postHardWork() internal virtual {}

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual view returns (bool) {
    // check claimable amounts and compare with thresholds
    return true;
  }

  /// @notice Do hard work with reinvesting
  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function doHardWork() override public returns (uint earned, uint lost) {
    require(msg.sender == splitter, StrategyLib.DENIED);
    return _doHardWork(true);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim);

  /// @param reInvest Deposit to pool all available amount if it's greater than the threshold
  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function _doHardWork(bool reInvest) internal returns (uint earned, uint lost) {
    // ATTENTION! splitter will not cover the loss if it is lower than profit

    // register autocompound income or possible lose if assets fluctuated
    uint investedAssetsBefore = _investedAssets;
    uint investedAssetsLocal = _updateInvestedAssets();
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(investedAssetsBefore, investedAssetsLocal, 0, 0);

    _preHardWork(reInvest);

    // claim rewards and get current asset balance
    (uint earnedFromRewards, uint lostFromRewards, uint assetBalance) = _handleRewards();
    earned += earnedFromRewards;
    lost += lostFromRewards;

    // re-invest income
    if (reInvest && assetBalance > reinvestThresholdPercent * investedAssetsLocal / DENOMINATOR) {
      _depositToPool(assetBalance, false);
      (earned, lost) = ConverterStrategyBaseLib.registerIncome(
        investedAssetsLocal + assetBalance, // assets in use before deposit
        _investedAssets + AppLib.balance(asset), // assets in use after deposit
        earned,
        lost
      );
    }

    _postHardWork();
  }
  //endregion Hardwork

  /////////////////////////////////////////////////////////////////////
  //region InvestedAssets Calculations
  /////////////////////////////////////////////////////////////////////

  /// @notice Updates cached _investedAssets to actual value
  /// @dev Should be called after deposit / withdraw / claim; virtual - for ut
  function _updateInvestedAssets() internal returns (uint investedAssetsOut) {
    investedAssetsOut = _calcInvestedAssets();
    _investedAssets = investedAssetsOut;
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because we need to update current balances in the internal protocols.
  /// @return Invested asset amount under control (in terms of {asset})
  function _calcInvestedAssets() internal returns (uint) {
    (address[] memory tokens, uint indexAsset) = _getTokens(asset);
    return ConverterStrategyBaseLib.calcInvestedAssets(
      tokens,
      // quote exit should check zero liquidity
      _depositorQuoteExit(_depositorLiquidity()),
      indexAsset,
      converter
    );
  }

  function calcInvestedAssets() external returns (uint) {
    StrategyLib.onlyOperators(controller());
    return _calcInvestedAssets();
  }

  /// @notice Update invested assets and return possible lose [new-investedAssets - old-investedAssets]
  /// @param updateTotalAssetsBeforeInvest_ If false - skip update, return delta = 0
  function _updateInvestedAssetsAndGetLoss(bool updateTotalAssetsBeforeInvest_) internal returns (
    uint updatedInvestedAssets,
    uint loss
  ) {
    uint __investedAssets = _investedAssets;

    updatedInvestedAssets = updateTotalAssetsBeforeInvest_
      ? _updateInvestedAssets()
      : __investedAssets;

    loss = updateTotalAssetsBeforeInvest_
      ? updatedInvestedAssets < __investedAssets ? __investedAssets - updatedInvestedAssets : 0
      : uint(0);
  }
  //endregion InvestedAssets Calculations

  /////////////////////////////////////////////////////////////////////
  //region ITetuConverterCallback
  /////////////////////////////////////////////////////////////////////

  /// @notice Converters asks to send some amount back.
  /// @param theAsset_ Required asset (either collateral or borrow)
  /// @param amount_ Required amount of the {theAsset_}
  /// @return amountOut Amount sent to balance of TetuConverter, amountOut <= amount_
  function requirePayAmountBack(address theAsset_, uint amount_) external override returns (uint amountOut) {
    address __converter = address(converter);
    require(msg.sender == __converter, StrategyLib.DENIED);

    // detect index of the target asset
    (address[] memory tokens, uint indexTheAsset) = _getTokens(theAsset_);
    // get amount of target asset available to be sent
    uint balance = AppLib.balance(theAsset_);

    // withdraw from the pool if not enough
    if (balance < amount_) {
      // the strategy doesn't have enough target asset on balance
      // withdraw all from the pool but don't convert assets to underlying
      uint liquidity = _depositorLiquidity();
      if (liquidity != 0) {
        uint[] memory withdrawnAmounts = _depositorExit(liquidity);
        emit OnDepositorExit(liquidity, withdrawnAmounts);
      }
    }

    amountOut = ConverterStrategyBaseLib.swapToGivenAmountAndSendToConverter(
      amount_,
      indexTheAsset,
      tokens,
      __converter,
      controller(),
      asset,
      liquidationThresholds
    );

    // update invested assets anyway, even if we suppose it will be called in other places
    _updateInvestedAssets();
  }

  /// @notice TetuConverter calls this function when it sends any amount to user's balance
  /// @param assets_ Any asset sent to the balance, i.e. inside repayTheBorrow
  /// @param amounts_ Amount of {asset_} that has been sent to the user's balance
  function onTransferAmounts(address[] memory assets_, uint[] memory amounts_) external override {
    require(msg.sender == address(converter), StrategyLib.DENIED);

    uint len = assets_.length;
    require(len == amounts_.length, AppErrors.INCORRECT_LENGTHS);

    // TetuConverter is able two call this function in two cases:
    // 1) rebalancing (the health factor of some borrow is too low)
    // 2) forcible closing of the borrow
    // In both cases we update invested assets value here
    // and avoid fixing any related losses in hardwork
    _updateInvestedAssets();
  }
  //endregion ITetuConverterCallback

  /////////////////////////////////////////////////////////////////////
  //region Others
  /////////////////////////////////////////////////////////////////////

  /// @notice Unlimited capacity by default
  function capacity() external virtual view returns (uint) {
    return 2 ** 255;
    // almost same as type(uint).max but more gas efficient
  }

  function _getTokens(address asset_) internal view returns (address[] memory tokens, uint indexAsset) {
    tokens = _depositorPoolAssets();
    indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset_);
    require(indexAsset != type(uint).max, StrategyLib.WRONG_VALUE);
  }

  function _getLiquidator(address controller_) internal view returns (ITetuLiquidator) {
    return ITetuLiquidator(IController(controller_).liquidator());
  }
  //endregion Others

  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[46] private __gap;

}
