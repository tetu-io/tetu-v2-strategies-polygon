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

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
/// @notice This strategy provides delta-neutral liquidity hedging for Uniswap V3 pools. It rebalances the liquidity
///         by utilizing fill-up and swap methods depending on the range size of the liquidity provided.
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase, IRebalancingV2Strategy {

  //region ------------------------------------------------- Constants

  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.UNIV3;
  string public constant override STRATEGY_VERSION = "2.0.0";

  /// @notice Enter to the pool at the end of withdrawByAggStep
  uint internal constant ENTRY_TO_POOL_IS_ALLOWED = 1;
  /// @notice Enter to the pool at the end of withdrawByAggStep only if full withdrawing has been completed
  uint internal constant ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;
  /// @notice Make rebalance-without-swaps at the end of withdrawByAggStep and enter to the pool after the rebalancing
  uint internal constant ENTRY_TO_POOL_WITH_REBALANCE = 3;

  /// @notice A gap to reduce AmountToSwap calculated inside quoteWithdrawByAgg, [0...100_000]
  uint public constant GAP_AMOUNT_TO_SWAP = 100;
  //endregion ------------------------------------------------- Constants

  //region ------------------------------------------------- Data types

  struct WithdrawByAggStepLocal {
    address controller;
    ITetuConverter converter;
    address[] tokens;
    uint[] liquidationThresholds;
    uint oldTotalAssets;
    uint profitToCover;
    uint[] tokenAmounts;
    uint planKind;
    uint propNotUnderlying18;
    address tokenToSwap;
    address aggregator;
    bool useLiquidator;
    int24 newLowerTick;
    int24 newUpperTick;
    IUniswapV3Pool pool;
  }

  struct QuoteWithdrawByAggLocal {
    address[] tokens;
    uint[] liquidationThresholds;
    uint planKind;
    uint totalLiquidity;
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
    baseState.strategySpecificName = UniswapV3ConverterStrategyLogicLib.createSpecificName(state);
    emit StrategyLib2.StrategySpecificNameChanged(baseState.strategySpecificName); // todo: change to _checkStrategySpecificNameChanged
  }
  //endregion ------------------------------------------------- INIT

  //region --------------------------------------------- OPERATOR ACTIONS

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib2.onlyOperators(controller());
    UniswapV3ConverterStrategyLogicLib.disableFuse(state, converter);
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib2.onlyOperators(controller());
    UniswapV3ConverterStrategyLogicLib.newFuseThreshold(state, newFuseThreshold);
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
  //endregion ---------------------------------------------- METRIC VIEWS

  //region--------------------------------------------- REBALANCE
  /// @notice Rebalance using borrow/repay only, no swaps
  /// @return True if the fuse was triggered
  /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
  function rebalanceNoSwaps(bool checkNeedRebalance) external returns (bool) {
    return _rebalanceNoSwaps(checkNeedRebalance);
  }

  function _rebalanceNoSwaps(bool checkNeedRebalance) internal returns (bool) {
    (uint profitToCover, uint oldTotalAssets,) = _rebalanceBefore();
    (uint[] memory tokenAmounts, bool fuseEnabledOut) = UniswapV3ConverterStrategyLogicLib.rebalanceNoSwaps(
      state,
      converter,
      oldTotalAssets,
      profitToCover,
      baseState.splitter,
      checkNeedRebalance
    );
    _rebalanceAfter(tokenAmounts);
    return fuseEnabledOut;
  }
  //endregion--------------------------------------------- REBALANCE

  //region --------------------------------------------- Withdraw by iterations

  /// @notice Get info about a swap required by next call of {withdrawByAggStep} within the given plan
  function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap) {
    StrategyLib2.onlyOperators(controller());
    QuoteWithdrawByAggLocal memory v;

    // get tokens as following: [underlying, not-underlying]
    (v.tokens, v.liquidationThresholds) = _getTokensAndThresholds();

    v.planKind = IterationPlanLib.getEntryKind(planEntryData);

    // estimate amounts to be withdrawn from the pool
    v.totalLiquidity = state.totalLiquidity;
    uint[] memory amountsOut = (v.totalLiquidity == 0)
      ? new uint[](2)
      : _depositorQuoteExit(v.totalLiquidity);

    (tokenToSwap, amountToSwap) = PairBasedStrategyLib.quoteWithdrawStep(
      converter,
      v.tokens,
      v.liquidationThresholds,
      amountsOut,
      v.planKind,
      _extractProp(v.planKind, planEntryData)
    );
    if (amountToSwap != 0) {
      // withdrawByAggStep will execute REPAY1 - SWAP - REPAY2
      // but quoteWithdrawByAgg and withdrawByAggStep are executed in different blocks
      // so, REPAY1 can return less collateral than quoteWithdrawByAgg expected
      // As result, we can have less amount on balance than required amountToSwap
      // So, we need to reduce amountToSwap on small gap amount
      amountToSwap -= amountToSwap * GAP_AMOUNT_TO_SWAP / 100_000;
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
    // Prepare to rebalance: check operator-only, fix price changes, call depositor exit if totalLiquidity != 0
    WithdrawByAggStepLocal memory v;
    (v.profitToCover, v.oldTotalAssets, v.controller) = _rebalanceBefore();
    v.converter = converter;

    // decode tokenToSwapAndAggregator
    v.tokenToSwap = tokenToSwapAndAggregator[0];
    v.aggregator = tokenToSwapAndAggregator[1];
    if (v.aggregator == address(0)) {
      v.useLiquidator = true;
      v.aggregator = address(AppLib._getLiquidator(v.controller));
    }
    console.log("withdrawByAggStep.tokenToSwap", v.tokenToSwap);
    console.log("withdrawByAggStep.aggregator", v.aggregator);
    console.log("withdrawByAggStep.tokenToSwapAndAggregator[1]", tokenToSwapAndAggregator[1]);
    console.log("withdrawByAggStep.useLiquidator", v.useLiquidator);
    console.log("withdrawByAggStep.swapData", swapData.length);

    // get tokens as following: [underlying, not-underlying]
    (v.tokens, v.liquidationThresholds) = _getTokensAndThresholds();
    v.planKind = IterationPlanLib.getEntryKind(planEntryData);
    v.propNotUnderlying18 = _extractProp(v.planKind, planEntryData);

    // make withdraw iteration according to the selected plan
    completed = PairBasedStrategyLib.withdrawStep(
      v.converter,
      v.tokens,
      v.liquidationThresholds,
      v.tokenToSwap,
      amountToSwap_,
      v.aggregator,
      swapData,
      v.useLiquidator,
      v.planKind,
      v.propNotUnderlying18
    );

    if (entryToPool == ENTRY_TO_POOL_WITH_REBALANCE) {
      // make rebalance and enter back to the pool. We won't have any swaps here
      (v.tokenAmounts,) = UniswapV3ConverterStrategyLogicLib.rebalanceNoSwaps(
        state,
        converter,
        v.oldTotalAssets,
        v.profitToCover,
        baseState.splitter,
        false
      );
      _rebalanceAfter(v.tokenAmounts);
    } else {
      v.pool = state.pool;
      // fix loss / profitToCover
      v.tokenAmounts = UniswapV3ConverterStrategyLogicLib.afterWithdrawStep(
        converter,
        v.pool,
        v.tokens,
        v.oldTotalAssets,
        v.profitToCover,
        state.strategyProfitHolder,
        baseState.splitter
      );

      if (entryToPool == ENTRY_TO_POOL_IS_ALLOWED
        || (entryToPool == ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
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
    if (tokens[1] == baseState.asset) {
      (tokens[0], tokens[1]) = (tokens[1], tokens[0]);
    }

    thresholds = new uint[](2);
    thresholds[0] = liquidationThresholds[tokens[0]];
    thresholds[1] = liquidationThresholds[tokens[1]];
  }

  /// @notice Prepare to rebalance: check operator-only, fix price changes, call depositor exit if totalLiquidity != 0
  function _rebalanceBefore() internal returns (uint profitToCover, uint oldTotalAssets, address controllerOut) {
    controllerOut = controller();
    StrategyLib2.onlyOperators(controllerOut);

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

  function _extractProp(uint planKind, bytes memory planEntryData) internal pure returns(uint propNotUnderlying18) {
    if (planKind == IterationPlanLib.PLAN_SWAP_REPAY) {
      // custom proportions
      (, propNotUnderlying18) = abi.decode(planEntryData, (uint, uint));
      require(propNotUnderlying18 <= 1e18, AppErrors.WRONG_VALUE); // 0 is allowed
    } else if (planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY) {
      // the proportions should be taken from the pool
      // new value of the proportions should also be read from the pool after each swap
      propNotUnderlying18 = type(uint).max;
    }

    return propNotUnderlying18;
  }
  //endregion--------------------------------------- INTERNAL LOGIC
}
