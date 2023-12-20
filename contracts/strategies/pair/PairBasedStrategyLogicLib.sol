// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../ConverterStrategyBaseLib.sol";
import "./PairBasedStrategyLib.sol";
import "../ConverterStrategyBaseLib2.sol";

/// @notice Library for the UniV3-like strategies with two tokens in the pool
library PairBasedStrategyLogicLib {
  //region ------------------------------------------------------- Data types
  /// @notice Local variables required inside withdrawByAggStep and quoteWithdrawByAgg
  struct WithdrawLocal {
    /// @notice [underlying, not-underlying]
    address[] tokens;
    address controller;
    /// @notice liquidationThresholds for the {tokens}, greater or equal to {DEFAULT_LIQUIDATION_THRESHOLD}
    uint[] liquidationThresholds;
    uint planKind;
    uint propNotUnderlying18;
    uint entryDataParam;
  }

  /// @notice Common part of all XXXXConverterStrategyLogicLib.State
  struct PairState {
    address pool;
    address strategyProfitHolder;
    /// @notice This is underlying
    address tokenA;
    /// @notice This is not underlying
    address tokenB;

    bool isStablePool;
    /// @notice Tokens are swapped in the pool (pool.tokenB is underlying, pool.tokenA is not-underlying)
    bool depositorSwapTokens;

    int24 tickSpacing;
    int24 lowerTick;
    int24 upperTick;
    int24 rebalanceTickRange;
    uint128 totalLiquidity;

    /// @notice Fuse for tokens
    PairBasedStrategyLib.FuseStateParams fuseAB;

    /// @notice 1 means that the fuse was triggered ON and then all debts were closed
    ///         and assets were converter to underlying using withdrawStepByAgg.
    ///         This flag is automatically cleared to 0 if fuse is triggered OFF.
    uint withdrawDone;

    /// @notice Timestamp of last call of rebalanceNoSwaps() or zero if withdrawByAggStep() was called last
    uint lastRebalanceNoSwap;

    /// @notice reserve space for future needs
    uint[50 - 17] __gap;
  }

  struct RebalanceNoSwapsLocal {
    address tokenA;
    address tokenB;
    bool depositorSwapTokens;
    int24 newLowerTick;
    int24 newUpperTick;
    uint prop0;
    uint prop1;
  }

  struct WithdrawByAggStepLocal {
    PairBasedStrategyLogicLib.WithdrawLocal w;
    address tokenToSwap;
    address aggregator;
    address controller;
    address converter;
    address splitter;
    uint amountToSwap;
    uint profitToCover;
    uint oldTotalAssets;
    uint entryToPool;
  }
  //endregion ------------------------------------------------------- Data types

  //region ------------------------------------------------------- Events
  //endregion ------------------------------------------------------- Events

  //region ------------------------------------------------------- Helpers
  /// @notice Prepare array of amounts ready to deposit, borrow missed amounts
  /// @param amount_ Amount of tokenA
  /// @param tokenA Underlying
  /// @param tokenB Not-underlying
  /// @param prop0 Required proportion of underlying, > 0. Proportion of not-underlying is calculates as 1e18 - {prop0}
  /// @param liquidationThresholds Dust-thresholds for the tokens A and B
  /// @return tokenAmounts Amounts of token A and B to be deposited, [A, B]
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address tokenA,
    address tokenB,
    uint prop0,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    return BorrowLib.prepareToDeposit(
      tetuConverter_,
      amount_,
      [tokenA, tokenB],
      [
        AppLib._getLiquidationThreshold(liquidationThresholds[tokenA]),
        AppLib._getLiquidationThreshold(liquidationThresholds[tokenB])
      ],
      prop0
    );
  }

  /// @notice Initialize {dest} in place. Underlying is always first in {dest.tokens}.
  /// @param tokens_ [underlying, not-underlying]
  function initWithdrawLocal(
    WithdrawLocal memory dest,
    address[2] memory tokens_,
    mapping(address => uint) storage liquidationThresholds,
    bytes memory planEntryData,
    address controller
  ) internal view { // it's internal because it initializes {dest}
    dest.controller = controller;
    StrategyLib2.onlyOperators(dest.controller);

    dest.planKind = IterationPlanLib.getEntryKind(planEntryData);
    (dest.propNotUnderlying18, dest.entryDataParam)  = PairBasedStrategyLib._extractProp(dest.planKind, planEntryData);

    dest.tokens = new address[](2);
    (dest.tokens[0], dest.tokens[1]) = (tokens_[0], tokens_[1]);

    dest.liquidationThresholds = new uint[](2);
    dest.liquidationThresholds[0] = AppLib._getLiquidationThreshold(liquidationThresholds[dest.tokens[0]]);
    dest.liquidationThresholds[1] = AppLib._getLiquidationThreshold(liquidationThresholds[dest.tokens[1]]);
  }

  function calcTickRange(int24 tick, int24 tickRange, int24 tickSpacing) public pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
      lowerTick = ((tick - tickRange) / tickSpacing - 1) * tickSpacing;
    } else {
      lowerTick = (tick - tickRange) / tickSpacing * tickSpacing;
    }
    upperTick = tickRange == 0 ? lowerTick + tickSpacing : lowerTick + tickRange * 2;
  }
  //endregion ------------------------------------------------------- Helpers

  //region ------------------------------------------------------- PairState-helpers
  /// @notice Set the initial values to PairState instance
  /// @param pairState Depositor storage state struct to be initialized
  /// @param addr [pool, asset, pool.token0(), pool.token1()]
  ///        asset: Underlying asset of the depositor.
  /// @param tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  /// @param fuseThresholds Fuse thresholds for tokens (stable pool only)
  function setInitialDepositorValues(
    PairState storage pairState,
    address[4] calldata addr,
    int24[4] calldata tickData,
    bool isStablePool_,
    uint[4] calldata fuseThresholds
  ) external {
    pairState.pool = addr[0];
    address asset = addr[1];
    address token0 = addr[2];
    address token1 = addr[3];

    pairState.tickSpacing = tickData[0];
    pairState.lowerTick = tickData[1];
    pairState.upperTick = tickData[2];
    pairState.rebalanceTickRange = tickData[3];

    require(asset == token0 || asset == token1, PairBasedStrategyLib.INCORRECT_ASSET);
    if (asset == token0) {
      pairState.tokenA = token0;
      pairState.tokenB = token1;
      pairState.depositorSwapTokens = false;
    } else {
      pairState.tokenA = token1;
      pairState.tokenB = token0;
      pairState.depositorSwapTokens = true;
    }

    if (isStablePool_) {
      /// for stable pools fuse can be enabled
      pairState.isStablePool = true;
      PairBasedStrategyLib.setFuseStatus(pairState.fuseAB, PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(pairState.fuseAB, fuseThresholds);
    }

    // totalLiquidity is 0, no need to initialize
    // withdrawDone is 0, no need to initialize
  }

  function updateFuseStatus(
    PairBasedStrategyLogicLib.PairState storage pairState,
    bool fuseStatusChangedAB,
    PairBasedStrategyLib.FuseStatus fuseStatusAB
  ) external {
    bool updated;
    if (fuseStatusChangedAB) {
      PairBasedStrategyLib.setFuseStatus(pairState.fuseAB, fuseStatusAB);
      updated = true;
    }

    if (updated) {
      // if fuse is triggered ON, full-withdraw is required
      // if fuse is triggered OFF, the assets will be deposited back to pool
      // in both cases withdrawDone should be reset
      pairState.withdrawDone = 0;
    }
  }

  /// @notice Returns the current state of the contract
  /// @return addr [tokenA, tokenB, pool, profitHolder]
  /// @return tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  /// @return nums [totalLiquidity, fuse-status-tokenA, withdrawDone, 4 thresholds of token A, lastRebalanceNoSwap, 5 reserved values]
  /// @return boolValues [isStablePool, depositorSwapTokens]
  function getDefaultState(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  ) {
    addr = new address[](4);
    tickData = new int24[](4);
    nums = new uint[](13);
    boolValues = new bool[](2);

    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_A] = pairState.tokenA;
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_B] = pairState.tokenB;
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_POOL] = pairState.pool;
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_PROFIT_HOLDER] = pairState.strategyProfitHolder;

    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_TICK_SPACING] = pairState.tickSpacing;
    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_LOWER_TICK] = pairState.lowerTick;
    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_UPPER_TICK] = pairState.upperTick;
    tickData[PairBasedStrategyLib.IDX_TICK_DEFAULT_STATE_REBALANCE_TICK_RANGE] = pairState.rebalanceTickRange;

    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_TOTAL_LIQUIDITY] = uint(pairState.totalLiquidity);
    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_FUSE_STATUS] = uint(pairState.fuseAB.status);
    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_WITHDRAW_DONE] = pairState.withdrawDone;
    for (uint i = 0; i < 4; ++i) {
      nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_THRESHOLD_0 + i] = pairState.fuseAB.thresholds[i];
    }
    nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_LAST_REBALANCE_NO_SWAP] = pairState.lastRebalanceNoSwap;

    boolValues[PairBasedStrategyLib.IDX_BOOL_VALUES_DEFAULT_STATE_IS_STABLE_POOL] = pairState.isStablePool;
    boolValues[PairBasedStrategyLib.IDX_BOOL_VALUES_DEFAULT_STATE_DEPOSITOR_SWAP_TOKENS] = pairState.depositorSwapTokens;
  }

  /// @notice Get info about a swap required by next call of {withdrawByAggStep} within the given plan
  /// @param amounts_ Amounts of [underlying, not-underlying] that will be received from the pool before withdrawing
  function quoteWithdrawByAgg(
    PairBasedStrategyLogicLib.PairState storage pairState,
    bytes memory planEntryData,
    uint[] memory amounts_,
    address controller_,
    ITetuConverter converter_,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    // check operator-only, initialize w
    WithdrawLocal memory w;
    initWithdrawLocal(
      w,
      [pairState.tokenA, pairState.tokenB],
      liquidationThresholds,
      planEntryData,
      controller_
    );

    (tokenToSwap, amountToSwap) = PairBasedStrategyLib.quoteWithdrawStep(
      [address(converter_), address(AppLib._getLiquidator(w.controller))],
      w.tokens,
      w.liquidationThresholds,
      amounts_,
      w.planKind,
      [w.propNotUnderlying18, w.entryDataParam]
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

  /// @notice Calculate amounts to be deposited to pool, calculate loss, fix profitToCover
  /// @param addr_ [tokenToSwap, aggregator, controller, converter, splitter]
  /// @param values_ [amountToSwap_, profitToCover, oldTotalAssets, not used here]
  /// @param tokens [underlying, not-underlying] (values been read from pairBase)
  /// @return completed All debts were closed, leftovers were swapped to proper proportions
  /// @return tokenAmounts Amounts to be deposited to pool. If {tokenAmounts} contains zero amount return empty array.
  function withdrawByAggStep(
    address[5] calldata addr_,
    uint[4] calldata values_,
    bytes memory swapData,
    bytes memory planEntryData,
    address[2] memory tokens,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    bool completed,
    uint[] memory tokenAmounts,
    uint loss
  ) {
    WithdrawByAggStepLocal memory v;

    v.tokenToSwap = addr_[0];
    v.aggregator = addr_[1];
    v.controller = addr_[2];
    v.converter = addr_[3];
    v.splitter = addr_[4];

    v.amountToSwap = values_[0];
    v.profitToCover = values_[1];
    v.oldTotalAssets = values_[2];

    // initialize v
    PairBasedStrategyLogicLib.initWithdrawLocal(v.w, tokens, liquidationThresholds, planEntryData, v.controller);

    // make withdraw iteration according to the selected plan
    completed = PairBasedStrategyLib.withdrawStep(
      [v.converter, address(AppLib._getLiquidator(v.w.controller))],
      v.w.tokens,
      v.w.liquidationThresholds,
      v.tokenToSwap,
      v.amountToSwap,
      v.aggregator,
      swapData,
      v.aggregator == address(0),
      v.w.planKind,
      [v.w.propNotUnderlying18, v.w.entryDataParam]
    );

    // fix loss / profitToCover
    if (v.profitToCover != 0) {
      ConverterStrategyBaseLib2.sendToInsurance(
        v.w.tokens[0],
        v.profitToCover,
        v.splitter,
        v.oldTotalAssets,
        IERC20(v.w.tokens[0]).balanceOf(address(this))
      );
    }

    (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmountsPair(
      ITetuConverter(v.converter),
      v.oldTotalAssets,
      v.w.tokens[0],
      v.w.tokens[1],
      [v.w.liquidationThresholds[0], v.w.liquidationThresholds[1]]
    );
  }

  /// @notice Rebalance asset to proportions {propTokenA}:{1e18-propTokenA}, fix profitToCover
  /// @param propTokenA Proportion of {tokenA}, > 0. Proportion of {tokenB} is calculates as 1e18 - prop0
  /// @param liquidationThresholdsAB [liquidityThreshold of token A, liquidityThreshold of tokenB]
  function _rebalanceNoSwaps(
    address[2] calldata converterLiquidator,
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint profitToCover,
    uint totalAssets,
    address splitter,
    uint[2] calldata liquidationThresholdsAB,
    uint propTokenA
  ) internal {
    address tokenA = pairState.tokenA;
    address tokenB = pairState.tokenB;

    BorrowLib.rebalanceAssets(
      ITetuConverter(converterLiquidator[0]),
      ITetuLiquidator(converterLiquidator[1]),
      tokenA,
      tokenB,
      propTokenA,
      liquidationThresholdsAB[0], // liquidityThreshold of token A
      liquidationThresholdsAB[1], // liquidityThreshold of token B
      profitToCover
    );

    // we assume here, that rebalanceAssets provides profitToCover on balance and set leftovers to right proportions
    if (profitToCover != 0) {
      ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets, IERC20(tokenA).balanceOf(address(this)));
    }
  }
  //endregion ------------------------------------------------------- PairState-helpers

  //region ------------------------------------------------------- needStrategyRebalance
  /// @notice Determine if the strategy needs to be rebalanced.
  /// @return needRebalance A boolean indicating if {rebalanceNoSwaps} should be called
  function needStrategyRebalance(
    PairBasedStrategyLogicLib.PairState storage pairState,
    ITetuConverter converter_,
    int24 tick,
    uint poolPrice
  ) external view returns (
    bool needRebalance,
    bool fuseStatusChangedAB,
    PairBasedStrategyLib.FuseStatus fuseStatusAB
  ) {
    if (pairState.isStablePool) {
      uint price = ConverterStrategyBaseLib2.getOracleAssetsPrice(
        converter_,
        pairState.tokenA,
        pairState.tokenB
      );
      (fuseStatusChangedAB, fuseStatusAB) = PairBasedStrategyLib.needChangeFuseStatus(pairState.fuseAB, price, poolPrice);
      needRebalance = fuseStatusChangedAB
        || (
          !PairBasedStrategyLib.isFuseTriggeredOn(fuseStatusAB)
          && _needPoolRebalance(pairState, tick)
        );
    } else {
      needRebalance = _needPoolRebalance(pairState, tick);
    }

    return (needRebalance, fuseStatusChangedAB, fuseStatusAB); // hide warning
  }

  /// @notice Determine if the pool needs to be rebalanced.
  /// @return A boolean indicating if the pool needs to be rebalanced.
  function _needPoolRebalance(
    int24 tick,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    int24 rebalanceTickRange
  ) internal pure returns (bool) {
    if (upperTick - lowerTick == tickSpacing) {
      return tick < lowerTick || tick >= upperTick;
    } else {
      int24 halfRange = (upperTick - lowerTick) / 2;
      int24 oldMedianTick = lowerTick + halfRange;
      return (tick > oldMedianTick)
        ? tick - oldMedianTick >= rebalanceTickRange
        : oldMedianTick - tick > rebalanceTickRange;
    }
  }

  function _needPoolRebalance(PairBasedStrategyLogicLib.PairState storage pairState, int24 tick) internal view returns (bool) {
    return _needPoolRebalance(
      tick,
      pairState.lowerTick,
      pairState.upperTick,
      pairState.tickSpacing,
      pairState.rebalanceTickRange
    );
  }
  //endregion ------------------------------------------------------- needStrategyRebalance
}
