// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV3.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverterCallback.sol";
import "./ConverterStrategyBaseLib.sol";
import "./ConverterStrategyBaseLib2.sol";
import "./DepositorBase.sol";
import "../interfaces/IConverterStrategyBase.sol";

/////////////////////////////////////////////////////////////////////
///                        TERMS
///  Main asset == underlying: the asset deposited to the vault by users
///  Secondary assets: all assets deposited to the internal pool except the main asset
/////////////////////////////////////////////////////////////////////
// History:
// 3.0.1 refactoring of emergency exit
// 3.1.0 use bookkeeper, new set of events
// 3.1.2 scb-867

/// @title Abstract contract for base Converter strategy functionality
/// @notice All depositor assets must be correlated (ie USDC/USDT/DAI)
/// @author bogdoslav, dvpublic, a17
abstract contract ConverterStrategyBase is IConverterStrategyBase, ITetuConverterCallback, DepositorBase, StrategyBaseV3 {
  using SafeERC20 for IERC20;

  //region -------------------------------------------------------- DATA TYPES
  struct WithdrawUniversalLocal {
    ITetuConverter converter;
    /// @notice Target asset that should be received on balance.
    ///         It's underlying in _withdrawUniversal(), but it can be any other asset in requirePayAmountBack()
    address theAsset;
    /// @notice List of tokens received by _depositorPoolAssets()
    address[] tokens;
    /// @notice Index of the {asset} in {tokens}
    uint indexTheAsset;
    /// @notice Initial balance of the [asset}
    uint balanceBefore;
    uint indexUnderlying;
  }
  //endregion -------------------------------------------------------- DATA TYPES

  //region -------------------------------------------------------- CONSTANTS

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "3.1.2";

  /// @notice 1% gap to cover possible liquidation inefficiency
  /// @dev We assume that: conversion-result-calculated-by-prices - liquidation-result <= the-gap
  uint internal constant GAP_CONVERSION = 1_000;
  uint internal constant DENOMINATOR = 100_000;
  /// @notice If we need to withdraw A, we always tries to receive on balance A + delta
  ///         and have at least delta on balance after withdraw to prevent situation when we have debts
  ///         but don't have any liquidity to pay the debts and receive locked collaterals back
  ///
  ///         Delta will be in the range [GAP_WITHDRAW...2 * GAP_WITHDRAW]
  uint internal constant GAP_WITHDRAW = 1_000;
  //endregion -------------------------------------------------------- CONSTANTS

  //region -------------------------------------------------------- VARIABLES
  /////////////////////////////////////////////////////////////////////
  //                Keep names and ordering!
  // Add only in the bottom and don't forget to decrease gap variable
  /////////////////////////////////////////////////////////////////////

  /// @notice Minimum token amounts that can be liquidated
  /// @dev These thresholds are used to workaround dust problems in many other cases, not during liquidation only
  mapping(address => uint) public liquidationThresholds;

  /// @notice Internal variables of ConverterStrategyBase
  ConverterStrategyBaseState internal _csbs;
  //endregion -------------------------------------------------------- VARIABLES

  //region -------------------------------------------------------- Getters
  function converter() external view returns (ITetuConverter) {
    return _csbs.converter;
  }

  function reinvestThresholdPercent() external view returns (uint) {
    return _csbs.reinvestThresholdPercent;
  }

  function debtToInsurance() external view returns (int) {
    return _csbs.debtToInsurance;
  }
  //endregion -------------------------------------------------------- Getters

  //region -------------------------------------------------------- Events
  event OnDepositorEnter(uint[] amounts, uint[] consumedAmounts);
  event OnDepositorExit(uint liquidityAmount, uint[] withdrawnAmounts);
  event OnDepositorEmergencyExit(uint[] withdrawnAmounts);
  event OnHardWorkEarnedLost(
    uint investedAssetsNewPrices,
    uint earnedByPrices,
    uint earnedHandleRewards,
    uint lostHandleRewards,
    uint earnedDeposit,
    uint lostDeposit,
    uint paidDebtToInsurance
  );
  //endregion -------------------------------------------------------- Events

  //region -------------------------------------------------------- Initialization and configuration

  /// @notice Initialize contract after setup it as proxy implementation
  function __ConverterStrategyBase_init(
    address controller_,
    address splitter_,
    address converter_
  ) internal onlyInitializing {
    __StrategyBase_init(controller_, splitter_);
    _csbs.converter = ITetuConverter(converter_);

    // 1% by default
    _csbs.reinvestThresholdPercent = DENOMINATOR / 100;
    emit ConverterStrategyBaseLib2.ReinvestThresholdPercentChanged(DENOMINATOR / 100);
  }

  /// @dev Liquidation thresholds are used to detect dust in many cases, not only in liquidation case
  /// @param amount Min amount of token allowed to liquidate, token's decimals are used.
  function setLiquidationThreshold(address token, uint amount) external {
    ConverterStrategyBaseLib2.checkLiquidationThresholdChanged(controller(), token, amount);
    liquidationThresholds[token] = amount;
  }

  /// @param percent_ New value of the percent, decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  function setReinvestThresholdPercent(uint percent_) external {
    ConverterStrategyBaseLib2.checkReinvestThresholdPercentChanged(controller(), percent_);
    _csbs.reinvestThresholdPercent = percent_;
  }
  //endregion -------------------------------------------------------- Initialization and configuration

  //region -------------------------------------------------------- Deposit to the pool

  /// @notice Amount of underlying assets converted to pool assets and invested to the pool.
  function investedAssets() override public view virtual returns (uint) {
    return _csbs.investedAssets;
  }

  /// @notice Deposit given amount to the pool.
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    uint strategyLoss
  ){
    (uint updatedInvestedAssets, uint earnedByPrices) = _fixPriceChanges(updateTotalAssetsBeforeInvest_);
    (strategyLoss,) = _depositToPoolUniversal(amount_, earnedByPrices, updatedInvestedAssets);
  }

  /// @notice Deposit {amount_} to the pool, send {earnedByPrices_} to insurance.
  ///         totalAsset will decrease on earnedByPrices_ and sharePrice won't change after all recalculations.
  /// @dev We need to deposit {amount_} and withdraw {earnedByPrices_} here
  /// @param amount_ Amount of underlying to be deposited
  /// @param earnedByPrices_ Profit received because of price changing
  /// @param investedAssets_ Invested assets value calculated with updated prices
  /// @return strategyLoss Loss happened on the depositing. It doesn't include any price-changing losses
  /// @return amountSentToInsurance Price-changing-profit that was sent to the insurance
  function _depositToPoolUniversal(uint amount_, uint earnedByPrices_, uint investedAssets_) internal virtual returns (
    uint strategyLoss,
    uint amountSentToInsurance
  ){
    address _asset = baseState.asset;

    uint amountToDeposit = amount_ > earnedByPrices_
      ? amount_ - earnedByPrices_
      : 0;

    // skip deposit for small amounts
    bool needToDeposit = amountToDeposit > _csbs.reinvestThresholdPercent * investedAssets_ / DENOMINATOR;
    uint balanceBefore = AppLib.balance(_asset);

    // send earned-by-prices to the insurance, ignore dust values
    if (earnedByPrices_ > AppLib._getLiquidationThreshold(liquidationThresholds[_asset])) {
      if (needToDeposit || balanceBefore >= earnedByPrices_) {
        (amountSentToInsurance,) = ConverterStrategyBaseLib2.sendToInsurance(
          _asset,
          earnedByPrices_,
          baseState.splitter,
          investedAssets_ + balanceBefore,
          balanceBefore
        );
      } else {
        // needToDeposit is false and we don't have enough amount to cover earned-by-prices, we need to withdraw
        (/* expectedWithdrewUSD */,, strategyLoss, amountSentToInsurance) = _withdrawUniversal(0, earnedByPrices_, investedAssets_);
      }
    }

    // make deposit
    if (needToDeposit) {
      (address[] memory tokens, uint indexAsset) = _getTokens(_asset);

      // prepare array of amounts ready to deposit, borrow missed amounts
      uint[] memory amounts = _beforeDeposit(_csbs.converter, amountToDeposit, tokens, indexAsset);

      // make deposit, actually consumed amounts can be different from the desired amounts
      if (!ConverterStrategyBaseLib2.findZeroAmount(amounts)) {
        // we cannot enter to pool if at least one of amounts is zero
        // we check != 0 and don't use thresholds because some strategies allow to enter to the pool with amount < liquidation threshold
        (uint[] memory consumedAmounts,) = _depositorEnter(amounts);
        emit OnDepositorEnter(amounts, consumedAmounts);
      }

      // update _investedAssets with new deposited amount
      uint investedAssetsAfter = _updateInvestedAssets();

      // we need to compensate difference if during deposit we lost some assets
      (,strategyLoss) = ConverterStrategyBaseLib2._registerIncome(
        investedAssets_ + balanceBefore,
        investedAssetsAfter + AppLib.balance(_asset) + amountSentToInsurance
      );
    }

    return (strategyLoss, amountSentToInsurance);
  }
  //endregion -------------------------------------------------------- Deposit to the pool

  //region -------------------------------------------------------- Convert amounts before deposit

  /// @notice Prepare {tokenAmounts} to be passed to depositorEnter
  /// @dev Override this function to customize entry kind
  /// @param amount_ The amount of main asset that should be invested
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return tokenAmounts Amounts of depositor's assets ready to invest (this array can be passed to depositorEnter)
  function _beforeDeposit(
    ITetuConverter converter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    // calculate required collaterals for each token and temporary save them to tokenAmounts
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
    return ConverterStrategyBaseLib.beforeDeposit(
      converter_,
      amount_,
      tokens_,
      indexAsset_,
      weights,
      totalWeight,
      liquidationThresholds
    );
  }
  //endregion -------------------------------------------------------- Convert amounts before deposit

  //region -------------------------------------------------------- Get requested amount

  /// @notice Initialize members of {v}
  /// @param underlying true if asset_ is underlying
  function _initWithdrawUniversalLocal(address asset_, WithdrawUniversalLocal memory v, bool underlying) internal view {
    v.tokens = _depositorPoolAssets();
    v.theAsset = asset_;
    v.converter = _csbs.converter;
    v.indexTheAsset = AppLib.getAssetIndex(v.tokens, asset_);
    v.balanceBefore = AppLib.balance(asset_);
    v.indexUnderlying = underlying ? v.indexTheAsset : AppLib.getAssetIndex(v.tokens, baseState.asset);
  }

  /// @notice Get the specified {amount} of the given {v.asset} on the balance
  /// @dev Ensures that either all debts are closed, or a non-zero amount remains on the balance or in the pool to pay off the debts
  /// @param amount_ Required amount of {v.asset}. Use type(uint).max to withdraw all
  /// @return expectedTotalAssetAmount Expected amount of {v.asset} that should be received on the balance
  ///                                  Expected total amount of given asset after all withdraws, conversions, swaps and repays
  function _makeRequestedAmount(uint amount_, WithdrawUniversalLocal memory v) internal virtual returns ( // it's virtual to simplify unit testing
    uint expectedTotalAssetAmount
  ) {
    uint depositorLiquidity = _depositorLiquidity();

    // calculate how much liquidity we need to withdraw for getting at least requested amount of the {v.asset}
    uint[] memory quoteAmounts = _depositorQuoteExit(depositorLiquidity);
    uint liquidityAmountToWithdraw = ConverterStrategyBaseLib2.getLiquidityAmount(
      amount_,
      v.tokens,
      v.indexTheAsset,
      v.converter,
      quoteAmounts,
      depositorLiquidity,
      v.indexUnderlying
    );

    if (liquidityAmountToWithdraw != 0) {
      uint[] memory withdrawnAmounts = _depositorExit(liquidityAmountToWithdraw, false);
      // the depositor is able to use less liquidity than it was asked, i.e. Balancer-depositor leaves some BPT unused
      // use what exactly was withdrew instead of the expectation
      // assume that liquidity cannot increase in _depositorExit
      liquidityAmountToWithdraw = depositorLiquidity - _depositorLiquidity();
      emit OnDepositorExit(liquidityAmountToWithdraw, withdrawnAmounts);
    }

    // try to receive at least requested amount of the {v.asset} on the balance
    uint expectedBalance = ConverterStrategyBaseLib.makeRequestedAmount(
      v.tokens,
      v.indexTheAsset,
      v.converter,
      AppLib._getLiquidator(controller()),
      (amount_ == type(uint).max ? amount_ : v.balanceBefore + amount_), // current balance + the amount required to be withdrawn on balance
      liquidationThresholds
    );

    require(expectedBalance >= v.balanceBefore, AppErrors.BALANCE_DECREASE);
    return expectedBalance - v.balanceBefore;
  }

  //endregion -------------------------------------------------------- Get requested amount

  //region -------------------------------------------------------- Withdraw from the pool

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
    // calculate profit/loss because of price changes, try to compensate the loss from the insurance
    (uint investedAssetsNewPrices, uint earnedByPrices) = _fixPriceChanges(true);
    (expectedWithdrewUSD, assetPrice, strategyLoss,) = _withdrawUniversal(amount, earnedByPrices, investedAssetsNewPrices);
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
    return _withdrawFromPool(type(uint).max);
  }

  /// @dev The function is virtual to simplify unit testing
  /// @param amount_ Amount to be trying to withdrawn. Max uint means attempt to withdraw all possible invested assets.
  /// @param earnedByPrices_ Additional amount that should be withdrawn and send to the insurance
  /// @param investedAssets_ Value of invested assets recalculated using current prices
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing in terms of USD value of each asset in the pool
  /// @return assetPrice Price of the {asset} taken from the price oracle
  /// @return strategyLoss Loss before withdrawing: [new-investedAssets - old-investedAssets]
  /// @return amountSentToInsurance Actual amount of underlying sent to the insurance
  function _withdrawUniversal(uint amount_, uint earnedByPrices_, uint investedAssets_) virtual internal returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss,
    uint amountSentToInsurance
  ) {
    // amount to withdraw; we add a little gap to avoid situation "opened debts, no liquidity to pay"
    uint amount = amount_ == type(uint).max
      ? amount_
      : (amount_ + earnedByPrices_) * (DENOMINATOR + GAP_WITHDRAW) / DENOMINATOR;
    _beforeWithdraw(amount);

    if (amount != 0 && investedAssets_ != 0) {
      WithdrawUniversalLocal memory v;
      _initWithdrawUniversalLocal(baseState.asset, v, true);

      // get at least requested amount of the underlying on the balance
      assetPrice = ConverterStrategyBaseLib2.getAssetPriceFromConverter(v.converter, v.theAsset);
      expectedWithdrewUSD = AppLib.sub0(_makeRequestedAmount(amount, v), earnedByPrices_) * assetPrice / 1e18;

      (amountSentToInsurance, strategyLoss) = ConverterStrategyBaseLib2.calculateIncomeAfterWithdraw(
        baseState.splitter,
        v.theAsset,
        investedAssets_,
        v.balanceBefore,
        earnedByPrices_,
        _updateInvestedAssets()
      );
    }

    return (
      expectedWithdrewUSD,
      assetPrice,
      strategyLoss,
      amountSentToInsurance
    );
  }

  /// @notice Withdraw all amounts from the pool using minimum actions (it skips claiming rewards, fees and so on)
  function _emergencyExitFromPool() override internal virtual {
    uint[] memory withdrawnAmounts = _depositorEmergencyExit();
    emit OnDepositorEmergencyExit(withdrawnAmounts);
    // we don't convert amounts to main asset to avoid any excess actions
    // update of invested assets is necessary in any case
    _updateInvestedAssets();
  }
  //endregion -------------------------------------------------------- Withdraw from the pool

  //region -------------------------------------------------------- Claim rewards

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual returns (address[] memory rewardTokensOut, uint[] memory amountsOut) {
    // get rewards from the Depositor
    (address[] memory rewardTokens, uint[] memory rewardAmounts, uint[] memory balancesBefore) = _depositorClaimRewards();

    (rewardTokensOut, amountsOut) = ConverterStrategyBaseLib2.claimConverterRewards(
      _csbs.converter,
      _depositorPoolAssets(),
      rewardTokens,
      rewardAmounts,
      balancesBefore
    );
  }

  /// @dev Call recycle process and send tokens to forwarder.
  ///      Need to be separated from the claim process - the claim can be called by operator for other purposes.
  /// @return paidDebtToInsurance Earned amount spent on debt-to-insurance payment
  function _rewardsLiquidation(address[] memory rewardTokens_, uint[] memory rewardAmounts_) internal returns (
    uint paidDebtToInsurance
  ) {
    if (rewardTokens_.length != 0) {
      paidDebtToInsurance = ConverterStrategyBaseLib.recycle(
        baseState,
        _csbs,
        _depositorPoolAssets(),
        controller(),
        liquidationThresholds,
        rewardTokens_,
        rewardAmounts_
      );
    }
    return paidDebtToInsurance;
  }
  //endregion -------------------------------------------------------- Claim rewards

  //region -------------------------------------------------------- Hardwork

  /// @notice A virtual handler to make any action before hardwork
  /// @return True if the hardwork should be skipped
  function _preHardWork(bool reInvest) internal virtual returns (bool) {
    reInvest; // hide warning
    return false;
  }

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
    require(msg.sender == baseState.splitter, StrategyLib2.DENIED);
    return _doHardWork(true);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  /// @return earned The amount of earned rewards.
  /// @return lost The amount of lost rewards.
  /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
  /// @return paidDebtToInsurance A part of {earned} spent on debt-to-insurance payment
  function _handleRewards() internal virtual returns (
    uint earned,
    uint lost,
    uint assetBalanceAfterClaim,
    uint paidDebtToInsurance
  );

  /// @param reInvest Deposit to pool all available amount if it's greater than the threshold
  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function _doHardWork(bool reInvest) internal returns (uint earned, uint lost) {
    // ATTENTION! splitter will not cover the loss if it is lower than profit
    (uint investedAssetsNewPrices, uint earnedByPrices) = _fixPriceChanges(true);
    if (!_preHardWork(reInvest)) {
      // claim rewards and get current asset balance
      (uint earned1, uint lost1, uint assetBalance, uint paidDebtToInsurance) = _handleRewards();

      // re-invest income
      (uint investedAssetsAfterHandleRewards,,) = _calcInvestedAssets();
      (, uint amountSentToInsurance) = _depositToPoolUniversal(
        reInvest
        && investedAssetsAfterHandleRewards != 0
        && assetBalance > _csbs.reinvestThresholdPercent * investedAssetsAfterHandleRewards / DENOMINATOR
          ? assetBalance
          : 0,
        earnedByPrices,
        investedAssetsAfterHandleRewards
      );

      (earned, lost) = ConverterStrategyBaseLib2._registerIncome(
        investedAssetsNewPrices + assetBalance, // assets in use before handling rewards
        _csbs.investedAssets + AppLib.balance(baseState.asset) + amountSentToInsurance // assets in use after deposit
      );

      _postHardWork();
      emit OnHardWorkEarnedLost(investedAssetsNewPrices, earnedByPrices, earned1, lost1, earned, lost, paidDebtToInsurance);

      earned = AppLib.sub0(earned + earned1, paidDebtToInsurance);
      lost += lost1;
    }

    // register amount paid for the debts and amount received for the provided collaterals
    ConverterStrategyBaseLib2.registerBorrowResults(_csbs.converter, baseState.asset);

    return (earned, lost);
  }
  //endregion -------------------------------------------------------- Hardwork

  //region -------------------------------------------------------- InvestedAssets Calculations

  /// @notice Updates cached _investedAssets to actual value
  /// @dev Should be called after deposit / withdraw / claim; virtual - for ut
  function _updateInvestedAssets() internal returns (uint investedAssetsOut) {
    (investedAssetsOut,,) = _calcInvestedAssets();
    _csbs.investedAssets = investedAssetsOut;
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because we need to update current balances in the internal protocols.
  /// @return amountOut Invested asset amount under control (in terms of {asset})
  /// @return prices Asset prices in USD, decimals 18
  /// @return decs 10**decimals
  function _calcInvestedAssets() internal returns (uint amountOut, uint[] memory prices, uint[] memory decs) {
    (address[] memory tokens, uint indexAsset) = _getTokens(baseState.asset);
    return ConverterStrategyBaseLib2.calcInvestedAssets(
      tokens,
      _getDepositorQuoteExitAmountsOut(tokens),
      indexAsset,
      _csbs.converter,
      true
    );
  }

  function calcInvestedAssets() external returns (uint investedAssetsOut) {
    StrategyLib2.onlyOperators(controller());
    (investedAssetsOut,,) = _calcInvestedAssets();
  }

  /// @notice Calculate amount of deposited tokens that can be received from the pool after withdrawing all liquidity.
  function _getDepositorQuoteExitAmountsOut(address[] memory tokens) internal returns (
    uint[] memory depositorQuoteExitAmountsOut
  ) {
    uint liquidity = _depositorLiquidity();
    return liquidity == 0
      ? new uint[](tokens.length)
      : _depositorQuoteExit(liquidity);
  }

  /// @notice Calculate profit/loss happened because of price changing. Try to cover the loss, send the profit to the insurance
  /// @param updateInvestedAssetsAmount_ If false - just return current value of invested assets
  /// @return investedAssetsOut Updated value of {_investedAssets}
  /// @return earnedOut Profit that was received because of price changes. It should be sent back to insurance.
  /// It's too dangerous to try to get this amount here because of the problem "borrow-repay is not allowed in a single block"
  /// So, we need to handle it in the caller code.
  function _fixPriceChanges(bool updateInvestedAssetsAmount_) internal returns (uint investedAssetsOut, uint earnedOut) {
    if (updateInvestedAssetsAmount_) {
      (address[] memory tokens, uint indexAsset) = _getTokens(baseState.asset);
      (investedAssetsOut, earnedOut) = ConverterStrategyBaseLib2.fixPriceChanges(
        _csbs,
        baseState,
        _getDepositorQuoteExitAmountsOut(tokens),
        tokens,
        indexAsset
      );
    } else {
      (investedAssetsOut, earnedOut) = (_csbs.investedAssets, 0);
    }
  }
  //endregion -------------------------------------------------------- InvestedAssets Calculations

  //region -------------------------------------------------------- ITetuConverterCallback

  /// @notice Converters asks to send some amount back.
  ///         The results depend on whether the required amount is on the balance:
  ///         1. The {amount_} exists on the balance: send the amount to TetuConverter, return {amount_}
  ///         2. The {amount_} doesn't exist on the balance. Try to receive the {amount_}.
  ///         2.1. if the required amount is received: return {amount_}
  ///         2.2. if less amount X (X < {amount_}) is received return X - gap
  ///         In the case 2 no amount is send to TetuConverter.
  ///         Converter should make second call of requirePayAmountBack({amountOut}) to receive the assets.
  /// @param theAsset_ Required asset (either collateral or borrow), it can be NOT underlying
  /// @param amount_ Required amount of {theAsset_}
  /// @return amountOut Amount that was send OR can be claimed on the next call.
  ///                   The caller should control own balance to know if the amount was actually send
  ///                   (because we need compatibility with exist not-NSR strategies)
  function requirePayAmountBack(address theAsset_, uint amount_) external override returns (uint amountOut) {
    WithdrawUniversalLocal memory v;
    _initWithdrawUniversalLocal(theAsset_, v, false);
    require(msg.sender == address(v.converter), StrategyLib.DENIED);
    require(amount_ != 0, AppErrors.ZERO_VALUE);
    require(v.indexTheAsset != type(uint).max, AppErrors.WRONG_ASSET);

    (uint _investedAssets, uint earnedByPrices) = _fixPriceChanges(true);
    v.balanceBefore = ConverterStrategyBaseLib2.sendProfitGetAssetBalance(theAsset_, v.balanceBefore, _investedAssets, earnedByPrices, baseState);

    // amount to withdraw; we add a little gap to avoid situation "opened debts, no liquidity to pay"
    // At first we add only 1 gap.
    // This is min allowed amount that we should have on balance to be able to send {amount_} to the converter
    uint amountPlusGap = amount_ * (DENOMINATOR + GAP_WITHDRAW) / DENOMINATOR;

    if (v.balanceBefore >= amountPlusGap) {
      // the requested amount is available, send it to the converter
      IERC20(theAsset_).safeTransfer(address(v.converter), amount_);
      amountOut = amount_;
    } else {
      // the requested amount is not available
      // so, we cannot send anything to converter in this call
      // try to receive requested amount to balance
      // we should receive amount with extra gap, where gap is in the range (GAP_WITHDRAW, 2 * GAP_WITHDRAW]
      // The caller will be able to claim requested amount (w/o extra gap) in the next call
      if (_investedAssets == 0) {
        // there are no invested amounts, we can use amount on balance only
        // but we cannot send all amount, we should keep not zero amount on balance
        // to avoid situation "opened debts, no liquidity to pay"
        // as soon as the converter asks for payment, we still have an opened debt..
        amountOut = v.balanceBefore * DENOMINATOR / (DENOMINATOR + GAP_WITHDRAW);
      } else {
        uint amountTwoGaps = amount_ * (DENOMINATOR + 2 * GAP_WITHDRAW) / DENOMINATOR;
        // get at least requested amount of {theAsset_} on the balance
        _makeRequestedAmount(amountTwoGaps - v.balanceBefore, v);

        uint balanceAfter = AppLib.balance(theAsset_);
        amountOut = balanceAfter > amountPlusGap
          ? amount_
          : balanceAfter * DENOMINATOR / (DENOMINATOR + GAP_WITHDRAW);
      }
    }

    // update invested assets anyway, even if we suppose it will be called in other places
    _updateInvestedAssets();

    return amountOut;
  }

  /// @notice TetuConverter calls this function when it sends any amount to user's balance
  /// @param assets_ Any asset sent to the balance, i.e. inside repayTheBorrow
  /// @param amounts_ Amount of {asset_} that has been sent to the user's balance
  function onTransferAmounts(address[] memory assets_, uint[] memory amounts_) external override {
    require(msg.sender == address(_csbs.converter), StrategyLib2.DENIED);
    require(assets_.length == amounts_.length, AppErrors.INCORRECT_LENGTHS);

    // TetuConverter is able two call this function in two cases:
    // 1) rebalancing (the health factor of some borrow is too low)
    // 2) forcible closing of the borrow
    // In both cases we update invested assets value here
    // and avoid fixing any related losses in hardwork
    _updateInvestedAssets();
  }
  //endregion -------------------------------------------------------- ITetuConverterCallback

  //region -------------------------------------------------------- Others

  /// @notice Unlimited capacity by default
  function capacity() external virtual view returns (uint) {
    return 2 ** 255;
    // almost same as type(uint).max but more gas efficient
  }

  /// @return tokens Result of {_depositorPoolAssets}
  /// @return indexAsset Index of the underlying in {tokens}
  function _getTokens(address asset_) internal view returns (address[] memory tokens, uint indexAsset) {
    tokens = _depositorPoolAssets();
    indexAsset = AppLib.getAssetIndex(tokens, asset_);
    require(indexAsset != type(uint).max, StrategyLib2.WRONG_VALUE);
  }
  //endregion -------------------------------------------------------- Others


  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[50 - 4] private __gap; // 50 - count of variables

}
