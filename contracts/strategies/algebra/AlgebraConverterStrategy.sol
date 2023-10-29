// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./AlgebraDepositor.sol";
import "./AlgebraConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingV2Strategy.sol";
import "../pair/PairBasedStrategyLib.sol";
import "./AlgebraStrategyErrors.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

contract AlgebraConverterStrategy is AlgebraDepositor, ConverterStrategyBase, IRebalancingV2Strategy {

  //region ------------------------------------------------- Constants

  string public constant override NAME = "Algebra Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.ALGEBRA;
  string public constant override STRATEGY_VERSION = "3.0.1";

  //endregion ------------------------------------------------- Constants

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
    IncentiveKey memory key,
    uint[4] calldata fuseThresholds
  ) external initializer {
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    AlgebraConverterStrategyLogicLib.initStrategyState(
      state,
      [controller_, pool_],
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset(),
      isStablePool,
      fuseThresholds
    );

    AlgebraConverterStrategyLogicLib.initFarmingState(state, key);

    // setup specific name for UI
    StrategyLib2._changeStrategySpecificName(baseState, AlgebraConverterStrategyLogicLib.createSpecificName(state.pair));
  }
  //endregion ------------------------------------------------- INIT

  //region --------------------------------------------- OPERATOR ACTIONS

  /// @notice Manually set status of the fuse
  /// @param status See PairBasedStrategyLib.FuseStatus enum for possile values
  function setFuseStatus(uint status) external {
    StrategyLib2.onlyOperators(controller());
    PairBasedStrategyLib.setFuseStatus(state.pair.fuseAB, PairBasedStrategyLib.FuseStatus(status));
  }

  /// @notice Set thresholds for the fuse: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  ///         Decimals 18. The thresholds are compared with prices from TetuConverter's price oracle.
  ///         Example: [0.9, 0.92, 1.08, 1.1]
  ///         Price falls below 0.9 - fuse is ON. Price rises back up to 0.92 - fuse is OFF.
  ///         Price raises more and reaches 1.1 - fuse is ON again. Price falls back and reaches 1.08 - fuse OFF again.
  /// @param values Price thresholds: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  function setFuseThresholds(uint[4] memory values) external {
    StrategyLib2.onlyOperators(controller());
    PairBasedStrategyLib.setFuseThresholds(state.pair.fuseAB, values);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib2.onlyOperators(controller());
    state.pair.strategyProfitHolder = strategyProfitHolder;
  }

  /// @notice Set withdrawDone value.
  ///         When a fuse was triggered ON, all debts should be closed and asset should be converted to underlying.
  ///         After completion of the conversion withdrawDone can be set to 1.
  ///         So, {getFuseStatus} will return  withdrawDone=1 and you will know, that withdraw is not required
  /// @param done 0 - full withdraw required, 1 - full withdraw was done
  function setWithdrawDone(uint done) external {
    StrategyLib2.onlyOperators(controller());
    state.pair.withdrawDone = done;
  }
  //endregion --------------------------------------------- OPERATOR ACTIONS

  //region --------------------------------------------- METRIC VIEWS

  /// @notice Check if the strategy is ready for hard work.
  /// @return A boolean indicating if the strategy is ready for hard work.
  function isReadyToHardWork() override external virtual view returns (bool) {
    return !needRebalance()
    && !_isFuseTriggeredOn()
    && AlgebraConverterStrategyLogicLib.isReadyToHardWork(state, _csbs.converter, controller());
  }

  /// @notice Check if the strategy needs rebalancing.
  /// @return A boolean indicating if the strategy needs rebalancing.
  function needRebalance() public view returns (bool) {
    return AlgebraConverterStrategyLogicLib.needStrategyRebalance(state.pair, _csbs.converter);
  }

  /// @notice Returns the current state of the contract
  /// @return addr [tokenA, tokenB, pool, profitHolder]
  /// @return tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  /// @return nums [totalLiquidity, fuse-status-tokenA, fuse-status-tokenB, withdrawDone, 4 thresholds of token A, 4 thresholds of token B]
  /// @return boolValues [isStablePool, depositorSwapTokens]
  function getDefaultState() external override view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  ) {
    return PairBasedStrategyLogicLib.getDefaultState(state.pair);
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
    uint[] memory tokenAmounts = AlgebraConverterStrategyLogicLib.rebalanceNoSwaps(
      state.pair,
      [address(_csbs.converter), address(AppLib._getLiquidator(_controller))],
      oldTotalAssets,
      profitToCover,
      baseState.splitter,
      checkNeedRebalance,
      liquidationThresholds
    );
    _rebalanceAfter(tokenAmounts);
    state.pair.lastRebalanceNoSwap = block.timestamp;
  }
  //endregion--------------------------------------------- REBALANCE

  //region --------------------------------------------- Withdraw by iterations

  /// @notice Get info about a swap required by next call of {withdrawByAggStep} within the given plan
  function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap) {
    // restriction "operator only" is checked inside {initWithdrawLocal} in {quoteWithdrawStep}

    // estimate amounts to be withdrawn from the pool
    uint totalLiquidity = state.pair.totalLiquidity;
    uint[] memory amountsOut = (totalLiquidity == 0)
      ? new uint[](2)
      : _depositorQuoteExit(totalLiquidity);

    return PairBasedStrategyLogicLib.quoteWithdrawByAgg(
      state.pair,
      planEntryData,
      amountsOut,
      controller(),
      _csbs.converter,
      liquidationThresholds
    );
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
    (completed, tokenAmounts) = AlgebraConverterStrategyLogicLib.withdrawByAggStep(
      [tokenToSwap_, aggregator_, controller(), address(_csbs.converter), baseState.splitter],
      [amountToSwap_, profitToCover, oldTotalAssets, entryToPool],
      swapData,
      planEntryData,
      state.pair,
      liquidationThresholds
    );

    // enter to the pool
    _rebalanceAfter(tokenAmounts);
    state.pair.lastRebalanceNoSwap = 0;

    if (completed && _isFuseTriggeredOn()) {
      // full withdraw was completed, we can exclude next calls of withdrawByAggStep
      state.pair.withdrawDone = 1;
    }

    ConverterStrategyBaseLib2.fixTooHighInvestedAssets(baseState.asset, oldTotalAssets, _csbs);
  }

  function getPropNotUnderlying18() external view returns (uint) {
    return AlgebraConverterStrategyLogicLib.getPropNotUnderlying18(state.pair);
  }

  //endregion ------------------------------------ Withdraw by iterations

  //region--------------------------------------------- INTERNAL LOGIC
  function _beforeDeposit(
    ITetuConverter converter_,
    uint amount_,
    address[] memory tokens_,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    require(!needRebalance(), AlgebraStrategyErrors.NEED_REBALANCE);
    (uint prop0, uint prop1) = AlgebraConverterStrategyLogicLib.getEntryDataProportions(
      IAlgebraPool(state.pair.pool),
      state.pair.lowerTick,
      state.pair.upperTick,
      state.pair.depositorSwapTokens
    );

    // get token amounts for token A, token B
    address tokenA = state.pair.tokenA;
    tokenAmounts = PairBasedStrategyLogicLib._beforeDeposit(
      converter_,
      amount_,
      tokenA,
      state.pair.tokenB,
      prop0 * 1e18 / (prop0 + prop1),
      liquidationThresholds
    );

    // take into account a possibility that tokens_ can contain [B, A]
    if (tokens_[0] != tokenA) {
      (tokenAmounts[0], tokenAmounts[1]) = (tokenAmounts[1], tokenAmounts[0]);
    }
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  /// @return earned The amount of earned rewards.
  /// @return lost The amount of lost rewards.
  /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
  function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    earned = AlgebraConverterStrategyLogicLib.calcEarned(state.pair.tokenA, controller(), rewardTokens, amounts);
    _rewardsLiquidation(rewardTokens, amounts);
    return (earned, lost, AppLib.balance(baseState.asset));
  }

  /// @notice Deposit given amount to the pool.
  /// @param amount_ The amount to be deposited.
  /// @param updateTotalAssetsBeforeInvest_ A boolean indicating if the total assets should be updated before investing.
  /// @return strategyLoss Loss should be covered from Insurance
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    uint strategyLoss
  ) {
    if (PairBasedStrategyLib.isFuseTriggeredOn(state.pair.fuseAB.status)) {
      uint[] memory tokenAmounts = new uint[](2);
      tokenAmounts[0] = amount_;
      emit OnDepositorEnter(tokenAmounts, tokenAmounts);
      return 0;
    } else {
      return super._depositToPool(amount_, updateTotalAssetsBeforeInvest_);
    }
  }

  function _beforeWithdraw(uint /*amount*/) internal view override {
    require(!needRebalance(), AlgebraStrategyErrors.NEED_REBALANCE);
  }

  /// @notice Check need-rebalance and fuse-ON
  /// @return True if the hardwork should be skipped
  function _preHardWork(bool reInvest) internal view override returns (bool) {
    reInvest; // hide warning
    require(!needRebalance(), AlgebraStrategyErrors.NEED_REBALANCE);
    require(!_isFuseTriggeredOn(), AlgebraStrategyErrors.FUSE_IS_ACTIVE);
    return false;
  }

  /// @notice Prepare to rebalance: check operator-only, fix price changes, call depositor exit
  function _rebalanceBefore() internal returns (uint profitToCover, uint oldTotalAssets) {
    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    // withdraw all liquidity from pool
    // after disableFuse() liquidity is zero
    if (state.pair.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }
  }

  /// @notice Make actions after rebalance: depositor enter, update invested assets
  function _rebalanceAfter(uint[] memory tokenAmounts) internal {
    if (tokenAmounts.length == 2 && !_isFuseTriggeredOn()) {
      _depositorEnter(tokenAmounts);
    }
    _updateInvestedAssets();
  }

  function _isFuseTriggeredOn() internal view returns (bool) {
    return PairBasedStrategyLib.isFuseTriggeredOn(state.pair.fuseAB.status);
  }
  //endregion--------------------------------------- INTERNAL LOGIC
}
