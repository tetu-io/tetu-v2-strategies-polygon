// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../ConverterStrategyBaseLib.sol";
import "./PairBasedStrategyLib.sol";

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

    tokenAmounts[0] = amount_ - spentCollateral;
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
  ) internal view {
    dest.controller = controller;
    StrategyLib2.onlyOperators(dest.controller);

    dest.planKind = IterationPlanLib.getEntryKind(planEntryData);
    dest.propNotUnderlying18 = PairBasedStrategyLib._extractProp(dest.planKind, planEntryData);

    if (tokens[1] == asset) {
      (tokens[0], tokens[1]) = (tokens[1], tokens[0]);
    }

    dest.tokens = new address[](2);
    if (tokens[1] == asset) {
      (dest.tokens[0], dest.tokens[1]) = (tokens[1], tokens[0]);
    } else {
      (dest.tokens[0], dest.tokens[1]) = (tokens[0], tokens[1]);
    }

    dest.liquidationThresholds = new uint[](2);
    dest.liquidationThresholds[0] = liquidationThresholds[tokens[0]];
    dest.liquidationThresholds[1] = liquidationThresholds[tokens[1]];
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
  /// @param addr [pool, asset, pool.token0(), pool.token1()]
  ///        asset: Underlying asset of the depositor.
  /// @param state_ Depositor storage state struct
  /// @param tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  /// @param fuseThresholdsA Fuse thresholds for token A (stable pool only)
  /// @param fuseThresholdsB Fuse thresholds for token B (stable pool only)
  function _setInitialDepositorValues(
    PairState storage state_,
    address[4] calldata addr,
    int24[4] calldata tickData,
    bool isStablePool_,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
  ) external {
    state_.pool = addr[0];
    address asset = addr[1];
    address token0 = addr[2];
    address token1 = addr[3];

    state_.tickSpacing = tickData[0];
    state_.lowerTick = tickData[1];
    state_.upperTick = tickData[2];
    state_.rebalanceTickRange = tickData[3];

    require(asset == token0 || asset == token1, PairBasedStrategyLib.INCORRECT_ASSET);
    if (asset == token0) {
      state_.tokenA = token0;
      state_.tokenB = token1;
      state_.depositorSwapTokens = false;
    } else {
      state_.tokenA = token1;
      state_.tokenB = token0;
      state_.depositorSwapTokens = true;
    }

    if (isStablePool_) {
      /// for stable pools fuse can be enabled
      state_.isStablePool = true;
      PairBasedStrategyLib.setFuseStatus(state_.fuseAB[0], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(state_.fuseAB[0], fuseThresholdsA);
      PairBasedStrategyLib.setFuseStatus(state_.fuseAB[1], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(state_.fuseAB[1], fuseThresholdsB);
    }

    // totalLiquidity is 0, no need to initialize
    // withdrawDone is 0, no need to initialize
  }
  //endregion ------------------------------------------------------- PairState-helpers
}