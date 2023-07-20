// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./KyberDepositor.sol";
import "./KyberConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingV2Strategy.sol";
import "../../interfaces/IFarmingStrategy.sol";
import "./KyberStrategyErrors.sol";


contract KyberConverterStrategy is KyberDepositor, ConverterStrategyBase, IRebalancingV2Strategy, IFarmingStrategy {

  //region ------------------------------------------------- Constants

  string public constant override NAME = "Kyber Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.KYBER;
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
    address liquidator;
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
    IPool pool;
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
    int24 rebalanceTickRange_,
    bool isStablePool,
    uint pId
  ) external initializer {
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    KyberConverterStrategyLogicLib.initStrategyState(
      state,
      controller_,
      converter_,
      pool_,
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset(),
      isStablePool
    );

    state.pId = pId;

    // setup specific name for UI
    StrategyLib2._changeStrategySpecificName(baseState, KyberConverterStrategyLogicLib.createSpecificName(state));
  }
  //endregion ------------------------------------------------- INIT

  //region --------------------------------------------- OPERATOR ACTIONS

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib2.onlyOperators(controller());
    state.isFuseTriggered = false;
    state.lastPrice = ConverterStrategyBaseLib2.getOracleAssetsPrice(converter, state.tokenA, state.tokenB);

    KyberConverterStrategyLogicLib.emitDisableFuse();
  }

  function changePId(uint pId) external {
    StrategyLib2.onlyOperators(controller());
    require(!state.staked, KyberStrategyErrors.NOT_UNSTAKED);
    state.pId = pId;
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib2.onlyOperators(controller());
    state.fuseThreshold = newFuseThreshold;

    KyberConverterStrategyLogicLib.emitNewFuseThreshold(newFuseThreshold);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib2.onlyOperators(controller());
    state.strategyProfitHolder = strategyProfitHolder;
  }
  //endregion --------------------------------------------- OPERATOR ACTIONS

  //region --------------------------------------------- METRIC VIEWS

  /// @notice Check if the strategy needs rebalancing.
  /// @return A boolean indicating if the strategy needs rebalancing.
  function needRebalance() public view returns (bool) {
    (bool needStake, bool needUnstake) = KyberConverterStrategyLogicLib.needRebalanceStaking(state);
    return KyberConverterStrategyLogicLib.needRebalance(state) || needStake || needUnstake;
  }

  function canFarm() external view returns (bool) {
    return !KyberConverterStrategyLogicLib.isFarmEnded(state.pId);
  }

  /// @notice View function required by reader
  function getPoolTokens() external view returns (address tokenA, address tokenB) {
    return (state.tokenA, state.tokenB);
  }
  //endregion ---------------------------------------------- METRIC VIEWS

  //region --------------------------------------------- CALLBACKS

  function onERC721Received(
    address,
    address,
    uint256,
    bytes memory
  ) external pure returns (bytes4) {
    return this.onERC721Received.selector;
  }
  //endregion --------------------------------------------- CALLBACKS

  //region--------------------------------------------- REBALANCE

  /// @notice Rebalance using borrow/repay only, no swaps
  /// @return True if the fuse was triggered
  /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
  function rebalanceNoSwaps(bool checkNeedRebalance) external returns (bool) {
    (uint profitToCover, uint oldTotalAssets,) = _rebalanceBefore(checkNeedRebalance);
    (uint[] memory tokenAmounts, bool fuseEnabledOut) = KyberConverterStrategyLogicLib.rebalanceNoSwaps(
      state,
      [address(converter), address(AppLib._getLiquidator(controller()))],
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

  function withdrawByAggStep(
    address[2] calldata tokenToSwapAndAggregator,
    uint amountToSwap_,
    bytes memory swapData,
    bytes memory planEntryData,
    uint entryToPool
  ) external returns (bool completed) {
    // Prepare to rebalance: check operator-only, fix price changes, call depositor exit if totalLiquidity != 0
    WithdrawByAggStepLocal memory v;
    (v.profitToCover, v.oldTotalAssets, v.controller) = _rebalanceBefore(false);
    v.converter = converter;
    v.liquidator = address(AppLib._getLiquidator(v.controller));

    // decode tokenToSwapAndAggregator
    v.tokenToSwap = tokenToSwapAndAggregator[0];
    v.aggregator = tokenToSwapAndAggregator[1];
    if (v.aggregator == address(0)) {
      v.useLiquidator = true;
      v.aggregator = v.liquidator;
    }

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
      (v.tokenAmounts,) = KyberConverterStrategyLogicLib.rebalanceNoSwaps(
        state,
        [address(converter), v.liquidator],
        v.oldTotalAssets,
        v.profitToCover,
        baseState.splitter,
        false
      );
      _rebalanceAfter(v.tokenAmounts);
    } else {
      v.pool = state.pool;
      // fix loss / profitToCover
      v.tokenAmounts = KyberConverterStrategyLogicLib.afterWithdrawStep(
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
        (v.newLowerTick, v.newUpperTick) = KyberDebtLib._calcNewTickRange(v.pool, state.lowerTick, state.upperTick, state.tickSpacing);
        state.lowerTick = v.newLowerTick;
        state.upperTick = v.newUpperTick;

        _rebalanceAfter(v.tokenAmounts);
      }
    }

    _updateInvestedAssets();
  }

  function getPropNotUnderlying18() external view returns (uint) {
    return KyberConverterStrategyLogicLib.getPropNotUnderlying18(state);
  }
  //endregion ------------------------------------ Withdraw by iterations

  //region--------------------------------------------- INTERNAL LOGIC

  /// @notice Prepare to rebalance: check operator-only, fix price changes, call depositor exit
  function _rebalanceBefore(bool checkNeedRebalance) internal returns (uint profitToCover, uint oldTotalAssets, address controllerOut) {
    controllerOut = controller();
    StrategyLib2.onlyOperators(controllerOut);

    require(needRebalance() || !checkNeedRebalance, KyberStrategyErrors.NO_REBALANCE_NEEDED);

    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    KyberConverterStrategyLogicLib.claimRewardsBeforeExitIfRequired(state);

    // withdraw all liquidity from pool
    // after disableFuse() liquidity is zero
    if (state.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }
  }

  /// @notice Make actions after rebalance: depositor enter, add fillup if necessary, update invested assets
  function _rebalanceAfter(uint[] memory tokenAmounts) internal {
    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);
    }

    _updateInvestedAssets();
  }

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory /*tokens_*/,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    require(!needRebalance(), KyberStrategyErrors.NEED_REBALANCE);

    tokenAmounts = new uint[](2);
    uint spentCollateral;

    bytes memory entryData = KyberConverterStrategyLogicLib.getEntryData(
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
    address asset = baseState.asset;
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    earned = KyberConverterStrategyLogicLib.calcEarned(asset, controller(), rewardTokens, amounts);
    _rewardsLiquidation(rewardTokens, amounts);
    return (earned, lost, AppLib.balance(asset));
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
    require(!needRebalance(), KyberStrategyErrors.NEED_REBALANCE);
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
  //endregion--------------------------------------- INTERNAL LOGIC
}
