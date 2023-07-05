// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingStrategy.sol";
import "./Uni3StrategyErrors.sol";
import "./UniswapV3AggLib.sol";

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
/// @notice This strategy provides delta-neutral liquidity hedging for Uniswap V3 pools. It rebalances the liquidity
///         by utilizing fill-up and swap methods depending on the range size of the liquidity provided.
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase, IRebalancingStrategy {

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.UNIV3;
  string public constant override STRATEGY_VERSION = "1.4.7";
  uint internal constant ENTRY_TO_POOL_IS_ALLOWED = 1;
  uint internal constant ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;

  /////////////////////////////////////////////////////////////////////
  ///                Data types
  /////////////////////////////////////////////////////////////////////
  struct WithdrawByAggStepLocal {
    address controller;
    ITetuConverter converter;
    address[] tokens;
    uint[] liquidationThresholds;
    uint oldTotalAssets;
    uint profitToCover;
  }

  /////////////////////////////////////////////////////////////////////
  ///                INIT
  /////////////////////////////////////////////////////////////////////

  /// @notice Initialize the strategy with the given parameters.
  /// @param controller_ The address of the controller.
  /// @param splitter_ The address of the splitter.
  /// @param converter_ The address of the converter.
  /// @param pool_ The address of the pool.
  /// @param tickRange_ The tick range for the liquidity position.
  /// @param rebalanceTickRange_ The tick range for rebalancing.
  function init(
    address controller_,
    address splitter_,
    address converter_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) external initializer {
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    UniswapV3ConverterStrategyLogicLib.initStrategyState(
      state,
      controller_,
      converter_,
      pool_,
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset()
    );

    // setup specific name for UI
    strategySpecificName = UniswapV3ConverterStrategyLogicLib.createSpecificName(state);
    emit StrategyLib.StrategySpecificNameChanged(strategySpecificName); // todo: change to _checkStrategySpecificNameChanged
  }

  /////////////////////////////////////////////////////////////////////
  ///                OPERATOR ACTIONS
  /////////////////////////////////////////////////////////////////////

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib.onlyOperators(controller());
    UniswapV3ConverterStrategyLogicLib.disableFuse(state, converter);
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib.onlyOperators(controller());
    UniswapV3ConverterStrategyLogicLib.newFuseThreshold(state, newFuseThreshold);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib.onlyOperators(controller());
    state.strategyProfitHolder = strategyProfitHolder;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   METRIC VIEWS
  /////////////////////////////////////////////////////////////////////

  /// @notice Check if the strategy is ready for hard work.
  /// @return A boolean indicating if the strategy is ready for hard work.
  function isReadyToHardWork() override external virtual view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.isReadyToHardWork(state, converter);
  }

  /// @notice Check if the strategy needs rebalancing.
  /// @return A boolean indicating if the strategy needs rebalancing.
  function needRebalance() public view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.needRebalance(
      state.isFuseTriggered,
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.tickSpacing,
      state.rebalanceTickRange
    );
  }

  /// @return swapAtoB, swapAmount
  function quoteRebalanceSwap() external returns (bool, uint) {
    return UniswapV3ConverterStrategyLogicLib.quoteRebalanceSwap(state, converter);
  }

  /////////////////////////////////////////////////////////////////////
  //region--------------------------------------------- REBALANCE
  /////////////////////////////////////////////////////////////////////

  /// @dev The rebalancing functionality is the core of this strategy.
  ///      Depending on the size of the range of liquidity provided, the Fill-up or Swap method is used.
  ///      There is also an attempt to cover rebalancing losses with rewards.
  function rebalance() external {
    (uint profitToCover, uint oldTotalAssets, address _controller) = _rebalanceBefore();
    (uint[] memory tokenAmounts, bool isNeedFillup) = UniswapV3ConverterStrategyLogicLib.rebalance(
      state,
      converter,
      _controller,
      oldTotalAssets,
      profitToCover,
      splitter
    );
    _rebalanceAfter(tokenAmounts, isNeedFillup);
  }

  function rebalanceSwapByAgg(bool direction, uint amount, address agg, bytes memory swapData) external {
    (uint profitToCover, uint oldTotalAssets,) = _rebalanceBefore();

    // _depositorEnter(tokenAmounts) if length == 2
    uint[] memory tokenAmounts = UniswapV3ConverterStrategyLogicLib.rebalanceSwapByAgg(
      state,
      converter,
      oldTotalAssets,
      UniswapV3ConverterStrategyLogicLib.RebalanceSwapByAggParams(direction, amount, agg, swapData),
      profitToCover,
      splitter
    );
    _rebalanceAfter(tokenAmounts, false);
  }

  /// @notice Rebalance using borrow/repay only, no swaps
  /// @return True if the fuse was triggered (so, it's necessary to call UniswapV3DebtLib.closeDebtByAgg)
  /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
  function rebalanceNoSwaps(bool checkNeedRebalance) external returns (bool) {
    (uint profitToCover, uint oldTotalAssets,) = _rebalanceBefore();
    (uint[] memory tokenAmounts, bool fuseEnabledOut) = UniswapV3ConverterStrategyLogicLib.rebalanceNoSwaps(
      state,
      converter,
      oldTotalAssets,
      profitToCover,
      splitter,
      checkNeedRebalance
    );
    _rebalanceAfter(tokenAmounts, false);
    return fuseEnabledOut;
  }
  //endregion--------------------------------------------- REBALANCE

  //region ------------------------------------ Withdraw by iterations

  /// @notice Get info about a swap required by next call of {withdrawByAggStep}
  /// @param propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                           The leftovers should be swapped to get following result proportions of the assets:
  ///                           not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  function quoteWithdrawByAgg(uint propNotUnderlying18, bool singleIteration) external returns (address tokenToSwap, uint amountToSwap) {
    require(propNotUnderlying18 <= 1e18, AppErrors.WRONG_VALUE); // 0 is allowed
    StrategyLib.onlyOperators(controller());

    // get tokens as following: [underlying, not-underlying]
    (address[] memory tokens, uint[] memory thresholds) = _getTokensAndThresholds();

    // estimate amounts to be withdrawn from the pool
    uint totalLiquidity = state.totalLiquidity;
    uint[] memory amountsOut = (totalLiquidity == 0)
      ? new uint[](2)
      : _depositorQuoteExit(totalLiquidity);

    return UniswapV3AggLib.quoteWithdrawStep(converter, tokens, thresholds, propNotUnderlying18, amountsOut, singleIteration);
  }

  /// @notice Make withdraw iteration: [exit from the pool], [make 1 swap], [repay a debt], [enter to the pool]
  ///         Typical sequence of the actions is: exit from the pool, make 1 swap, repay 1 debt.
  ///         You can enter to the pool if you are sure that you won't have borrow + repay on AAVE3 in the same block.
  /// @dev All swap-by-agg data should be prepared using {quoteWithdrawByAgg} off-chain
  /// @param tokenToSwap_ What token should be swapped to other
  /// @param amountToSwap_ Amount that should be swapped. 0 - no swap
  /// @param aggregator_ Aggregator that should be used on next swap. 0 - use liquidator
  /// @param swapData Swap rote that was prepared off-chain.
  /// @param options 3 items packed to single array:
  ///   0: propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                           The leftovers should be swapped to get following result proportions of the assets:
  ///                           not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  ///   1: allowEntryToPool Allow to enter to the pool at the end. Use false if you are going to make several iterations.
  ///                         It's possible to enter back to the pool by calling {rebalanceNoSwaps} at any moment
  ///                         0 - not allowed, 1 - allowed, 2 - allowed only if completed
  ///   2: singleIteration 0 - single iteration (repay then swap), 1 - multiple iterations (swap then repay)
  /// @return completed All debts were closed, leftovers were swapped to the required proportions.
  function withdrawByAggStep(
    address tokenToSwap_,
    uint amountToSwap_,
    address aggregator_,
    bytes memory swapData,
    uint[3] calldata options // uint propNotUnderlying18, uint allowEntryToPool, uint singleIteration
  ) external returns (bool completed) {
    require(options[0] <= 1e18, AppErrors.WRONG_VALUE); // 0 is allowed

    WithdrawByAggStepLocal memory v;
    (v.profitToCover, v.oldTotalAssets, v.controller) = _rebalanceBefore();
    v.converter = converter;

    // get tokens as following: [underlying, not-underlying]
    (v.tokens, v.liquidationThresholds) = _getTokensAndThresholds();
    console.log("withdrawByAggStep.init.0", IERC20(v.tokens[0]).balanceOf(address(this)));
    console.log("withdrawByAggStep.init.1", IERC20(v.tokens[1]).balanceOf(address(this)));

    // make at most 1 swap and repay at most 1 debt
    completed = UniswapV3AggLib.withdrawStep(
      v.converter,
      v.tokens,
      v.liquidationThresholds,
      tokenToSwap_,
      amountToSwap_,
      aggregator_ == address(0)
        ? address(AppLib._getLiquidator(v.controller))
        : aggregator_,
      swapData,
      aggregator_ == address(0),
      options[0], // propNotUnderlying18
      options[2] != 0 // single iteration
    );

    console.log("withdrawByAggStep.after.withdrawStep.0", IERC20(v.tokens[0]).balanceOf(address(this)));
    console.log("withdrawByAggStep.after.withdrawStep.1", IERC20(v.tokens[1]).balanceOf(address(this)));

    if (options[1] == ENTRY_TO_POOL_IS_ALLOWED
      || (options[1] == ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
    ) {
      // make rebalance and enter back to the pool. We won't have any swaps here
      (uint[] memory tokenAmounts, bool fuseEnabledOut) = UniswapV3ConverterStrategyLogicLib.rebalanceNoSwaps(
        state,
        converter,
        v.oldTotalAssets,
        v.profitToCover,
        splitter,
        false
      );
      console.log("withdrawByAggStep.after.rebalanceNoSwaps.0", IERC20(v.tokens[0]).balanceOf(address(this)));
      console.log("withdrawByAggStep.after.rebalanceNoSwaps.1", IERC20(v.tokens[1]).balanceOf(address(this)));

      _rebalanceAfter(tokenAmounts, false);
    } else {
      // fix loss / profitToCover
      UniswapV3ConverterStrategyLogicLib.afterWithdrawStep(
        converter,
        state.pool,
        v.tokens,
        v.oldTotalAssets,
        v.profitToCover,
        state.strategyProfitHolder,
        splitter
      );
    }
    console.log("withdrawByAggStep.final.0", IERC20(v.tokens[0]).balanceOf(address(this)));
    console.log("withdrawByAggStep.final.1", IERC20(v.tokens[1]).balanceOf(address(this)));

    _updateInvestedAssets();
  }

  /// @notice View function required by reader. TODO replace by more general function that reads slot directly
  function getPoolTokens() external view returns (address tokenA, address tokenB) {
    return (state.tokenA, state.tokenB);
  }

  //endregion ------------------------------------ Withdraw by iterations

  /////////////////////////////////////////////////////////////////////
  ///                   INTERNAL LOGIC
  /////////////////////////////////////////////////////////////////////

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory /*tokens_*/,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    require(!needRebalance(), Uni3StrategyErrors.NEED_REBALANCE);

    tokenAmounts = new uint[](2);
    uint spentCollateral;

    bytes memory entryData = UniswapV3ConverterStrategyLogicLib.getEntryData(
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.depositorSwapTokens
    );

    AppLib.approveIfNeeded(state.tokenA, amount_, address(tetuConverter_));
    (spentCollateral, tokenAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      state.tokenA,
      state.tokenB,
      amount_,
      0
    );

    tokenAmounts[0] = amount_ - spentCollateral;
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  /// @return earned The amount of earned rewards.
  /// @return lost The amount of lost rewards.
  /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
  function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    earned = UniswapV3ConverterStrategyLogicLib.calcEarned(state.tokenA, controller(), rewardTokens, amounts);
    _rewardsLiquidation(rewardTokens, amounts);
    lost = 0; // hide warning
    assetBalanceAfterClaim = AppLib.balance(asset);
  }

  /// @notice Deposit given amount to the pool.
  /// @param amount_ The amount to be deposited.
  /// @param updateTotalAssetsBeforeInvest_ A boolean indicating if the total assets should be updated before investing.
  /// @return strategyLoss Loss should be covered from Insurance
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    uint strategyLoss
  ) {
    if (state.isFuseTriggered) {
      uint[] memory tokenAmounts = new uint[](2);
      tokenAmounts[0] = amount_;
      emit OnDepositorEnter(tokenAmounts, tokenAmounts);
      return 0;
    } else {
      return super._depositToPool(amount_, updateTotalAssetsBeforeInvest_);
    }
  }

  function _beforeWithdraw(uint /*amount*/) internal view override {
    require(!needRebalance(), Uni3StrategyErrors.NEED_REBALANCE);
  }

  /// @return tokens [underlying, not-underlying]
  /// @return thresholds liquidationThresholds for the {tokens}
  function _getTokensAndThresholds() internal view returns (address[] memory tokens, uint[] memory thresholds) {
    tokens = _depositorPoolAssets();
    if (tokens[1] == asset) {
      (tokens[0], tokens[1]) = (tokens[1], tokens[0]);
    }

    thresholds = new uint[](2);
    thresholds[0] = liquidationThresholds[tokens[0]];
    thresholds[1] = liquidationThresholds[tokens[1]];
  }

  /// @notice Prepare to rebalance: check operator-only, fix price changes, call depositor exit if totalLiquidity != 0
  function _rebalanceBefore() internal returns (uint profitToCover, uint oldTotalAssets, address controllerOut) {
    controllerOut = controller();
    StrategyLib.onlyOperators(controllerOut);

    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    // withdraw all liquidity from pool
    // after disableFuse() liquidity is zero
    if (state.totalLiquidity != 0) {
      _depositorEmergencyExit();
    }
  }

  /// @notice Make actions after rebalance: depositor enter, add fillup if necessary, update invested assets
  function _rebalanceAfter(uint[] memory tokenAmounts, bool isNeedFillup) internal {
    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);
    }

    //add fill-up liquidity part of fill-up is used
    if (isNeedFillup) {
      UniswapV3ConverterStrategyLogicLib.addFillup(state);
    }
    _updateInvestedAssets();
  }

}
