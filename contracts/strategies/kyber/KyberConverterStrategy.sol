// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./KyberDepositor.sol";
import "./KyberConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingV2Strategy.sol";
import "../../interfaces/IFarmingStrategy.sol";
import "./KyberStrategyErrors.sol";
import "../pair/PairBasedStrategyLogicLib.sol";


contract KyberConverterStrategy is KyberDepositor, ConverterStrategyBase, IRebalancingV2Strategy, IFarmingStrategy {

  //region ------------------------------------------------- Constants

  string public constant override NAME = "Kyber Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.KYBER;
  string public constant override STRATEGY_VERSION = "2.0.0";
  //endregion ------------------------------------------------- Constants

  //region ------------------------------------------------- Data types

  struct WithdrawByAggStepLocal {
    ITetuConverter converter;
    address liquidator;
    address tokenToSwap;
    address aggregator;
    IPool pool;
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
    bool isStablePool,
    uint pId,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
  ) external initializer {
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    KyberConverterStrategyLogicLib.initStrategyState(
      state,
      [controller_, pool_],
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset(),
      isStablePool,
      fuseThresholdsA,
      fuseThresholdsB
    );

    state.pId = pId;

    // setup specific name for UI
    StrategyLib2._changeStrategySpecificName(baseState, KyberConverterStrategyLogicLib.createSpecificName(state));
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

  function changePId(uint pId) external {
    StrategyLib2.onlyOperators(controller());
    require(!state.staked, KyberStrategyErrors.NOT_UNSTAKED);
    state.pId = pId;
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
    return KyberConverterStrategyLogicLib.needStrategyRebalance(state, converter) || needStake || needUnstake;
  }

  function canFarm() external view returns (bool) {
    return !KyberConverterStrategyLogicLib.isFarmEnded(state.pId);
  }

  /// @notice View function required by reader
  function getPoolTokens() external view returns (address tokenA, address tokenB) {
    return (state.tokenA, state.tokenB);
  }

  /// @notice Returns the current state of the contract
  /// @return addr [tokenA, tokenB, pool, profitHolder]
  /// @return tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  function getDefaultState() external override view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums
  ) {
    addr = new address[](4);
    tickData = new int24[](4);
    nums = new uint[](4);

    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_A] = state.tokenA;
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_B] = state.tokenB;
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_POOL] = address(state.pool);
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_PROFIT_HOLDER] = state.strategyProfitHolder;

    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_TICK_SPACING] = state.tickSpacing;
    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_LOWER_TICK] = state.lowerTick;
    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_UPPER_TICK] = state.upperTick;
    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_REBALANCE_TICK_RANGE] = state.rebalanceTickRange;

    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_TOTAL_LIQUIDITY] = uint(state.totalLiquidity);
    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_A] = uint(state.fuseAB[0].status);
    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_B] = uint(state.fuseAB[1].status);
    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_WITHDRAW_DONE] = state.withdrawDone;
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
  /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
  function rebalanceNoSwaps(bool checkNeedRebalance) external {
    address _controller = controller();
    StrategyLib2.onlyOperators(_controller);

    (uint profitToCover, uint oldTotalAssets) = _rebalanceBefore();
    uint[] memory tokenAmounts = KyberConverterStrategyLogicLib.rebalanceNoSwaps(
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

  function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap) {
    PairBasedStrategyLogicLib.WithdrawLocal memory w;

    // check operator-only, initialize v
    PairBasedStrategyLogicLib.initWithdrawLocal(
      w,
      [state.tokenA, state.tokenB],
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
  /// @param tokenToSwap_ What token should be swapped to other
  /// @param aggregator_ Aggregator that should be used on next swap. 0 - use liquidator
  /// @param amountToSwap_ Amount that should be swapped. 0 - no swap
  /// @param swapData Swap rote that was prepared off-chain.
  /// @param planEntryData PLAN_XXX + additional data, see IterationPlanKinds
  /// @param entryToPool Allow to enter to the pool at the end. Use false if you are going to make several iterations.
  ///                    It's possible to enter back to the pool by calling {rebalanceNoSwaps} at any moment
  ///                    0 - not allowed, 1 - allowed, 2 - allowed only if completed
  /// @return completed All debts were closed, leftovers were swapped to the required proportions.
  function withdrawByAggStep(
    address tokenToSwap_,
    address aggregator_,
    uint amountToSwap_,
    bytes memory swapData,
    bytes memory planEntryData,
    uint entryToPool
  ) external returns (bool completed) {
    // restriction "operator only" is checked inside UniswapV3ConverterStrategyLogicLib.withdrawByAggStep

    // fix price changes, exit from the pool
    (uint profitToCover, uint oldTotalAssets) = _rebalanceBefore();

    // check "operator only", make withdraw step, cover-loss, send profit to cover, prepare to enter to the pool
    uint[] memory tokenAmounts;
    (completed, tokenAmounts) = KyberConverterStrategyLogicLib.withdrawByAggStep(
      [tokenToSwap_, aggregator_, controller(), address(converter), baseState.asset, baseState.splitter],
      [amountToSwap_, profitToCover, oldTotalAssets, entryToPool],
      swapData,
      planEntryData,
      state,
      liquidationThresholds
    );

    // enter to the pool
    _rebalanceAfter(tokenAmounts);
  }

  function getPropNotUnderlying18() external view returns (uint) {
    return KyberConverterStrategyLogicLib.getPropNotUnderlying18(state);
  }

  /// @notice Set withdrawDone value.
  ///         When a fuse was triggered ON, all debts should be closed and asset should be converted to underlying.
  ///         After completion of the conversion withdrawDone can be set to 1.
  ///         So, {getFuseStatus} will return  withdrawDone=1 and you will know, that withdraw is not required
  /// @param done 0 - full withdraw required, 1 - full withdraw was done
  function setWithdrawDone(uint done) external override {
    state.withdrawDone = done;
  }
  //endregion ------------------------------------ Withdraw by iterations

  //region--------------------------------------------- INTERNAL LOGIC

  /// @notice Prepare to rebalance: check operator-only, fix price changes, call depositor exit
  function _rebalanceBefore() internal returns (uint profitToCover, uint oldTotalAssets) {
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
    bytes memory entryData = KyberConverterStrategyLogicLib.getEntryData(
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
    require(!needRebalance(), KyberStrategyErrors.NEED_REBALANCE);
  }
  //endregion--------------------------------------- INTERNAL LOGIC
}
