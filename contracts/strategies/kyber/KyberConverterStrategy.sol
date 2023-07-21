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
    uint oldTotalAssets;
    uint profitToCover;
    uint[] tokenAmounts;
    address tokenToSwap;
    address aggregator;
    bool useLiquidator;
    int24 newLowerTick;
    int24 newUpperTick;
    IPool pool;
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
    address _controller = controller();
    StrategyLib2.onlyOperators(_controller);

    (uint profitToCover, uint oldTotalAssets) = _rebalanceBefore(checkNeedRebalance);
    (uint[] memory tokenAmounts, bool fuseEnabledOut) = KyberConverterStrategyLogicLib.rebalanceNoSwaps(
      state,
      [address(converter), address(AppLib._getLiquidator(_controller))],
      oldTotalAssets,
      profitToCover,
      baseState.splitter,
      checkNeedRebalance,
      liquidationThresholds
    );
    _rebalanceAfter(tokenAmounts);
    return fuseEnabledOut;
  }
  //endregion--------------------------------------------- REBALANCE

  //region --------------------------------------------- Withdraw by iterations

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
    (v.profitToCover, v.oldTotalAssets) = _rebalanceBefore(false);
    v.converter = converter;
    v.liquidator = address(AppLib._getLiquidator(w.controller));

    // decode tokenToSwapAndAggregator
    v.tokenToSwap = tokenToSwapAndAggregator[0];
    v.aggregator = tokenToSwapAndAggregator[1];
    v.useLiquidator = v.aggregator == address(0);

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
      (v.tokenAmounts,) = KyberConverterStrategyLogicLib.rebalanceNoSwaps(
        state,
        [address(v.converter), v.liquidator],
        v.oldTotalAssets,
        v.profitToCover,
        baseState.splitter,
        false,
        liquidationThresholds
      );
      _rebalanceAfter(v.tokenAmounts);
    } else {
      v.pool = state.pool;
      // fix loss / profitToCover
      v.tokenAmounts = KyberConverterStrategyLogicLib.afterWithdrawStep(
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
  function _rebalanceBefore(bool checkNeedRebalance) internal returns (uint profitToCover, uint oldTotalAssets) {
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
  //endregion--------------------------------------- INTERNAL LOGIC
}
