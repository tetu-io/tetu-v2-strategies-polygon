// SPDX-License-Identifier: MIT
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
    /// [underlying, not-underlying]
    address[] tokens;
    address controller;
    /// liquidationThresholds for the {tokens}
    uint[] liquidationThresholds;
    uint planKind;
    uint propNotUnderlying18;
  }

  /// @notice Common part of all XXXXConverterStrategyLogicLib.State
  struct PairState {
    address pool;
    address strategyProfitHolder;
    address tokenA;
    address tokenB;

    bool isStablePool;
    bool depositorSwapTokens;

    int24 tickSpacing;
    int24 lowerTick;
    int24 upperTick;
    int24 rebalanceTickRange;
    uint128 totalLiquidity;

    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams[2] fuseAB;
    /// @notice 1 means that the fuse was triggered ON and then all debts were closed
    ///         and assets were converter to underlying using withdrawStepByAgg.
    ///         This flag is automatically cleared to 0 if fuse is triggered OFF.
    uint withdrawDone;
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

  //endregion ------------------------------------------------------- Data types

  //region ------------------------------------------------------- Helpers
  /// @notice Prepare array of amounts ready to deposit, borrow missed amounts
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address tokenA,
    address tokenB,
    bytes memory entryData,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    tokenAmounts = new uint[](2);
    uint spentCollateral;

    AppLib.approveIfNeeded(tokenA, amount_, address(tetuConverter_));
    (spentCollateral, tokenAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      tokenA,
      tokenB,
      amount_,
      liquidationThresholds[tokenA] // amount_ is set in terms of collateral asset
    );

    tokenAmounts[0] = amount_ > spentCollateral
      ? amount_ - spentCollateral
      : 0;
  }

  /// @param tokens Result of _depositorPoolAssets(). This array is changed in place and returned as {tokensOut}
  /// @param asset underlying
  function initWithdrawLocal(
    WithdrawLocal memory dest,
    address[2] memory tokens,
    address asset,
    mapping(address => uint) storage liquidationThresholds,
    bytes memory planEntryData,
    address controller
  ) internal view { // it's internal because it initializes {dest}
    dest.controller = controller;
    StrategyLib2.onlyOperators(dest.controller);

    dest.planKind = IterationPlanLib.getEntryKind(planEntryData);
    dest.propNotUnderlying18 = PairBasedStrategyLib._extractProp(dest.planKind, planEntryData);

    dest.tokens = new address[](2);
    if (tokens[1] == asset) {
      (dest.tokens[0], dest.tokens[1]) = (tokens[1], tokens[0]);
    } else {
      (dest.tokens[0], dest.tokens[1]) = (tokens[0], tokens[1]);
    }

    dest.liquidationThresholds = new uint[](2);
    dest.liquidationThresholds[0] = liquidationThresholds[dest.tokens[0]];
    dest.liquidationThresholds[1] = liquidationThresholds[dest.tokens[1]];
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
  /// @param fuseThresholdsA Fuse thresholds for token A (stable pool only)
  /// @param fuseThresholdsB Fuse thresholds for token B (stable pool only)
  function setInitialDepositorValues(
    PairState storage pairState,
    address[4] calldata addr,
    int24[4] calldata tickData,
    bool isStablePool_,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
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
      PairBasedStrategyLib.setFuseStatus(pairState.fuseAB[0], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(pairState.fuseAB[0], fuseThresholdsA);
      PairBasedStrategyLib.setFuseStatus(pairState.fuseAB[1], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(pairState.fuseAB[1], fuseThresholdsB);
    }

    // totalLiquidity is 0, no need to initialize
    // withdrawDone is 0, no need to initialize
  }

  function updateFuseStatus(
    PairBasedStrategyLogicLib.PairState storage pairState,
    bool[2] calldata fuseStatusChangedAB,
    PairBasedStrategyLib.FuseStatus[2] calldata fuseStatusAB
  ) external {
    bool updated;
    for (uint i = 0; i < 2; i = AppLib.uncheckedInc(i)) {
      if (fuseStatusChangedAB[i]) {
        PairBasedStrategyLib.setFuseStatus(pairState.fuseAB[i], fuseStatusAB[i]);
        updated = true;
      }
    }

    if (updated) {
      // if fuse is triggered ON, full-withdraw is required
      // if fuse is triggered OFF, the assets will be deposited back to pool
      // in both cases withdrawDone should be reset
      pairState.withdrawDone = 0;
    }
  }
  //endregion ------------------------------------------------------- PairState-helpers

  //region ------------------------------------------------------- needStrategyRebalance
  /// @notice Determine if the strategy needs to be rebalanced.
  /// @return needRebalance A boolean indicating if {rebalanceNoSwaps} should be called
  function needStrategyRebalance(
    PairBasedStrategyLogicLib.PairState storage pairState,
    ITetuConverter converter_,
    int24 tick
  ) external view returns (
    bool needRebalance,
    bool[2] memory fuseStatusChangedAB,
    PairBasedStrategyLib.FuseStatus[2] memory fuseStatusAB
  ) {
    if (pairState.isStablePool) {
      uint[2] memory prices;
      (prices[0], prices[1]) = ConverterStrategyBaseLib2.getOracleAssetsPrices(converter_, pairState.tokenA, pairState.tokenB);
      for (uint i = 0; i < 2; i = AppLib.uncheckedInc(i)) {
        (fuseStatusChangedAB[i], fuseStatusAB[i]) = PairBasedStrategyLib.needChangeFuseStatus(pairState.fuseAB[i], prices[i]);
      }
      needRebalance = fuseStatusChangedAB[0]
        || fuseStatusChangedAB[1]
        || (
          !PairBasedStrategyLib.isFuseTriggeredOn(fuseStatusAB[0])
          && !PairBasedStrategyLib.isFuseTriggeredOn(fuseStatusAB[1])
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