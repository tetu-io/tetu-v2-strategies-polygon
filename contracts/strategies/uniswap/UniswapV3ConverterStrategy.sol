// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingV2Strategy.sol";
import "./Uni3StrategyErrors.sol";
import "../pair/PairBasedStrategyLib.sol";
import "hardhat/console.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
/// @notice This strategy provides delta-neutral liquidity hedging for Uniswap V3 pools. It rebalances the liquidity
///         by utilizing fill-up and swap methods depending on the range size of the liquidity provided.
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase, IRebalancingV2Strategy {

  //region ------------------------------------------------- Constants

  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.UNIV3;
  string public constant override STRATEGY_VERSION = "2.0.0";

  //endregion ------------------------------------------------- Constants

  //region ------------------------------------------------- Data types

  struct WithdrawByAggStepLocal {
    ITetuConverter converter;
    address liquidator;
    address tokenToSwap;
    address aggregator;
    IUniswapV3Pool pool;
    bool useLiquidator;
    uint oldTotalAssets;
    uint profitToCover;
    uint[] tokenAmounts;
    int24 newLowerTick;
    int24 newUpperTick;
  }

  //endregion ------------------------------------------------- Data types

  //region ------------------------------------------------- INIT

  /// @notice Initialize the strategy with the given parameters.
  /// @param controller_ The address of the controller.
  /// @param splitter_ The address of the splitter.
  /// @param converter_ The address of the converter.
  /// @param pool_ The address of the pool.
  /// @param tickRange_ The tick range for the liquidity position.
  /// @param rebalanceTickRange_ The tick range for rebalancing.
  /// @param fuseThresholdsA Price thresholds for token A [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  /// @param fuseThresholdsB Price thresholds for token B [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  function init(
    address controller_,
    address splitter_,
    address converter_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_,
    uint[4] memory fuseThresholdsA,
    uint[4] memory fuseThresholdsB
  ) external initializer {
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    UniswapV3ConverterStrategyLogicLib.initStrategyState(
      state,
      controller_,
      converter_,
      pool_,
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset(),
      fuseThresholdsA,
      fuseThresholdsB
    );

    // setup specific name for UI
    StrategyLib2._changeStrategySpecificName(baseState, UniswapV3ConverterStrategyLogicLib.createSpecificName(state));
  }
  //endregion ------------------------------------------------- INIT

  //region --------------------------------------------- OPERATOR ACTIONS

  /// @notice Manually set status of the fuse
  /// @param status See PairBasedStrategyLib.FuseStatus enum for possile values
  /// @param index01 0 - token A, 1 - token B
  function setFuseStatus(uint index01, uint status) external {
    StrategyLib2.onlyOperators(controller());
    PairBasedStrategyLib.setFuseStatus(state.fuseAB[index01], PairBasedStrategyLib.FuseStatus(status));
  }

  /// @notice Set thresholds for the fuse: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  ///         Example: [0.9, 0.92, 1.08, 1.1]
  ///         Price falls below 0.9 - fuse is ON. Price rises back up to 0.92 - fuse is OFF.
  ///         Price raises more and reaches 1.1 - fuse is ON again. Price falls back and reaches 1.08 - fuse OFF again.
  /// @param values Price thresholds: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  /// @param index01 0 - token A, 1 - token B
  function setFuseThresholds(uint index01, uint[4] memory values) external {
    StrategyLib2.onlyOperators(controller());
    PairBasedStrategyLib.setFuseThresholds(state.fuseAB[index01], values);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib2.onlyOperators(controller());
    state.strategyProfitHolder = strategyProfitHolder;
  }
  //endregion --------------------------------------------- OPERATOR ACTIONS

  //region --------------------------------------------- METRIC VIEWS

  /// @notice Check if the strategy is ready for hard work.
  /// @return A boolean indicating if the strategy is ready for hard work.
  function isReadyToHardWork() override external virtual view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.isReadyToHardWork(state, converter);
  }

  /// @notice Check if the strategy needs rebalancing.
  /// @return A boolean indicating if {rebalanceNoSwaps} should be called.
  function needRebalance() public view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.needStrategyRebalance(state, converter);
  }

  /// @notice Get current fuse status, see PairBasedStrategyLib.FuseStatus for possible values
  function getFuseStatus() external override view returns (uint) {
    return 0; // todo uint(state.fuse.status);
  }

  //endregion ---------------------------------------------- METRIC VIEWS

  //region--------------------------------------------- REBALANCE
  /// @notice Rebalance using borrow/repay only, no swaps
  /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
  function rebalanceNoSwaps(bool checkNeedRebalance) external {
    _rebalanceNoSwaps(checkNeedRebalance);
  }

  function _rebalanceNoSwaps(bool checkNeedRebalance) internal {
    address _controller = controller();
    StrategyLib2.onlyOperators(_controller);

    (uint profitToCover, uint oldTotalAssets) = _rebalanceBefore();
    uint[] memory tokenAmounts = UniswapV3ConverterStrategyLogicLib.rebalanceNoSwaps(
      state,
      [address(converter), address(AppLib._getLiquidator(_controller))],
      oldTotalAssets,
      profitToCover,
      baseState.splitter,
      checkNeedRebalance,
      liquidationThresholds
    );
    _rebalanceAfter(tokenAmounts);
  }
  //endregion--------------------------------------------- REBALANCE

  //region --------------------------------------------- Withdraw by iterations

  /// @notice Get info about a swap required by next call of {withdrawByAggStep} within the given plan
  function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap) {
    PairBasedStrategyLogicLib.WithdrawLocal memory w;

    // check operator-only, initialize v
    PairBasedStrategyLogicLib.initWithdrawLocal(
      w,
      _depositorPoolAssets(),
      baseState.asset,
      liquidationThresholds,
      planEntryData,
      controller()
    );

    // estimate amounts to be withdrawn from the pool
    uint totalLiquidity = state.totalLiquidity;
    uint[] memory amountsOut = (totalLiquidity == 0)
      ? new uint[](2)
      : _depositorQuoteExit(totalLiquidity);

    (tokenToSwap, amountToSwap) = PairBasedStrategyLib.quoteWithdrawStep(
      [address(converter), address(AppLib._getLiquidator(w.controller))],
      w.tokens,
      w.liquidationThresholds,
      amountsOut,
      w.planKind,
      w.propNotUnderlying18
    );
    if (amountToSwap != 0) {
      // withdrawByAggStep will execute REPAY1 - SWAP - REPAY2
      // but quoteWithdrawByAgg and withdrawByAggStep are executed in different blocks
      // so, REPAY1 can return less collateral than quoteWithdrawByAgg expected
      // As result, we can have less amount on balance than required amountToSwap
      // So, we need to reduce amountToSwap on small gap amount
      amountToSwap -= amountToSwap * PairBasedStrategyLib.GAP_AMOUNT_TO_SWAP / 100_000;
    }
  }

  /// @notice Make withdraw iteration: [exit from the pool], [make 1 swap], [repay a debt], [enter to the pool]
  ///         Typical sequence of the actions is: exit from the pool, make 1 swap, repay 1 debt.
  ///         You can enter to the pool if you are sure that you won't have borrow + repay on AAVE3 in the same block.
  /// @dev All swap-by-agg data should be prepared using {quoteWithdrawByAgg} off-chain
  /// @param tokenToSwapAndAggregator Array with two params (workaround for stack too deep):
  ///             [0] tokenToSwap_ What token should be swapped to other
  ///             [1] aggregator_ Aggregator that should be used on next swap. 0 - use liquidator
  /// @param amountToSwap_ Amount that should be swapped. 0 - no swap
  /// @param swapData Swap rote that was prepared off-chain.
  /// @param planEntryData PLAN_XXX + additional data, see IterationPlanKinds
  /// @param entryToPool Allow to enter to the pool at the end. Use false if you are going to make several iterations.
  ///                    It's possible to enter back to the pool by calling {rebalanceNoSwaps} at any moment
  ///                    0 - not allowed, 1 - allowed, 2 - allowed only if completed
  /// @return completed All debts were closed, leftovers were swapped to the required proportions.
  function withdrawByAggStep(
    address[2] calldata tokenToSwapAndAggregator,
    uint amountToSwap_,
    bytes memory swapData,
    bytes memory planEntryData,
    uint entryToPool
  ) external returns (bool completed) {
    PairBasedStrategyLogicLib.WithdrawLocal memory w;

    // check operator-only, initialize v
    PairBasedStrategyLogicLib.initWithdrawLocal(
      w,
      _depositorPoolAssets(),
      baseState.asset,
      liquidationThresholds,
      planEntryData,
      controller()
    );

    // Prepare to rebalance: fix price changes, call depositor exit if totalLiquidity != 0
    WithdrawByAggStepLocal memory v;
    (v.profitToCover, v.oldTotalAssets) = _rebalanceBefore();
    v.converter = converter;
    v.liquidator = address(AppLib._getLiquidator(w.controller));

    // decode tokenToSwapAndAggregator
    v.tokenToSwap = tokenToSwapAndAggregator[0];
    v.aggregator = tokenToSwapAndAggregator[1];
    v.useLiquidator = v.aggregator == address(0);

    console.log("withdrawByAggStep.tokenToSwap", v.tokenToSwap);
    console.log("withdrawByAggStep.aggregator", v.aggregator);
    console.log("withdrawByAggStep.tokenToSwapAndAggregator[1]", tokenToSwapAndAggregator[1]);
    console.log("withdrawByAggStep.useLiquidator", v.useLiquidator);
    console.log("withdrawByAggStep.swapData", swapData.length);

    // make withdraw iteration according to the selected plan
    completed = PairBasedStrategyLib.withdrawStep(
      [address(v.converter), v.liquidator],
      w.tokens,
      w.liquidationThresholds,
      v.tokenToSwap,
      amountToSwap_,
      v.aggregator,
      swapData,
      v.useLiquidator,
      w.planKind,
      w.propNotUnderlying18
    );

    if (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_WITH_REBALANCE) {
      // make rebalance and enter back to the pool. We won't have any swaps here
      v.tokenAmounts = UniswapV3ConverterStrategyLogicLib.rebalanceNoSwaps(
        state,
        [address(v.converter), v.liquidator],
        v.oldTotalAssets,
        v.profitToCover,
        baseState.splitter,
        false,
        liquidationThresholds // todo pass array, not mapping
      );
      _rebalanceAfter(v.tokenAmounts);
    } else {
      v.pool = state.pool;
      // fix loss / profitToCover
      v.tokenAmounts = UniswapV3ConverterStrategyLogicLib.afterWithdrawStep(
        v.converter,
        v.pool,
        w.tokens,
        v.oldTotalAssets,
        v.profitToCover,
        state.strategyProfitHolder,
        baseState.splitter
      );

      if (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED
        || (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
      ) {
        // Make actions after rebalance: depositor enter, update invested assets
        (v.newLowerTick, v.newUpperTick) = UniswapV3DebtLib._calcNewTickRange(v.pool, state.lowerTick, state.upperTick, state.tickSpacing);
        state.lowerTick = v.newLowerTick;
        state.upperTick = v.newUpperTick;

        _rebalanceAfter(v.tokenAmounts);
      }
    }

    _updateInvestedAssets();
  }

  /// @notice View function required by reader. TODO replace by more general function that reads slot directly
  function getPoolTokens() external view returns (address tokenA, address tokenB) {
    return (state.tokenA, state.tokenB);
  }

  /// @notice Calculate proportions of [underlying, not-underlying] required by the internal pool of the strategy
  /// @return Proportion of the not-underlying [0...1e18]
  function getPropNotUnderlying18() external view returns (uint) {
    console.log("getPropNotUnderlying18", UniswapV3ConverterStrategyLogicLib.getPropNotUnderlying18(state));
    return UniswapV3ConverterStrategyLogicLib.getPropNotUnderlying18(state);
  }
  //endregion ------------------------------------ Withdraw by iterations

  //region--------------------------------------------- INTERNAL LOGIC

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory /*tokens_*/,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    require(!needRebalance(), Uni3StrategyErrors.NEED_REBALANCE);
    bytes memory entryData = UniswapV3ConverterStrategyLogicLib.getEntryData(
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.depositorSwapTokens
    );
    return PairBasedStrategyLogicLib._beforeDeposit(
      tetuConverter_,
      amount_,
      state.tokenA,
      state.tokenB,
      entryData,
      liquidationThresholds
    );
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  /// @return earned The amount of earned rewards.
  /// @return lost The amount of lost rewards.
  /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
  function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    address asset = baseState.asset;
    earned = UniswapV3ConverterStrategyLogicLib.calcEarned(asset, controller(), rewardTokens, amounts);
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
    if (
      PairBasedStrategyLib.isFuseTriggeredOn(state.fuseAB[0].status)
      || PairBasedStrategyLib.isFuseTriggeredOn(state.fuseAB[1].status)
    ) {
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

  /// @notice Prepare to rebalance: fix price changes, call depositor exit if totalLiquidity != 0
  function _rebalanceBefore() internal returns (uint profitToCover, uint oldTotalAssets) {
    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    // withdraw all liquidity from pool
    // after disableFuse() liquidity is zero
    if (state.totalLiquidity != 0) {
      _depositorEmergencyExit();
    }
  }

  /// @notice Make actions after rebalance: depositor enter, add fillup if necessary, update invested assets
  function _rebalanceAfter(uint[] memory tokenAmounts) internal {
    if (tokenAmounts.length == 2) {
      console.log("_rebalanceAfter.tokenAmounts[0]", tokenAmounts[0]);
      console.log("_rebalanceAfter.tokenAmounts[1]", tokenAmounts[1]);
      _depositorEnter(tokenAmounts);
    }

    _updateInvestedAssets();
  }

  //endregion--------------------------------------- INTERNAL LOGIC
}
