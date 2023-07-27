// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/pair/PairBasedStrategyLogicLib.sol";

contract PairBasedStrategyLogicLibFacade {
  mapping(address => uint) internal liquidationThresholds;
  PairBasedStrategyLogicLib.PairState internal pairState;

  function setLiquidationThreshold(address asset, uint threshold) external {
    liquidationThresholds[asset] = threshold;
  }

  /// @param tickParams [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  function setPairState(
    address[2] memory tokensAB,
    address pool,
    bool isStablePool,
    int24[4] memory tickParams,
    bool depositorSwapTokens,
    uint128 totalLiquidity,
    address strategyProfitHolder,
    PairBasedStrategyLib.FuseStateParams[2] memory fuseAB
  ) external {
    pairState.tokenA = tokensAB[0];
    pairState.tokenB = tokensAB[1];

    pairState.pool = address(pool);
    pairState.isStablePool = isStablePool;

    pairState.tickSpacing = tickParams[0];
    pairState.lowerTick = tickParams[1];
    pairState.upperTick = tickParams[2];
    pairState.rebalanceTickRange = tickParams[3];

    pairState.depositorSwapTokens = depositorSwapTokens;
    pairState.totalLiquidity = totalLiquidity;
    pairState.strategyProfitHolder = strategyProfitHolder;
    pairState.fuseAB[0] = fuseAB[0];
    pairState.fuseAB[1] = fuseAB[1];
  }

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address tokenA,
    address tokenB,
    bytes memory entryData
  ) external returns (uint[] memory tokenAmounts) {
    return PairBasedStrategyLogicLib._beforeDeposit(tetuConverter_, amount_, tokenA, tokenB, entryData, liquidationThresholds);
  }

  function initWithdrawLocal(
    PairBasedStrategyLogicLib.WithdrawLocal memory dest,
    address[2] memory tokens,
    address asset,
    bytes memory planEntryData,
    address controller
  ) external view {
    return PairBasedStrategyLogicLib.initWithdrawLocal(dest, tokens, asset, liquidationThresholds, planEntryData, controller);
  }

  function _needPoolRebalance(
    int24 tick,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    int24 rebalanceTickRange
  ) external pure returns (bool) {
    return PairBasedStrategyLogicLib._needPoolRebalance(tick, lowerTick, upperTick, tickSpacing, rebalanceTickRange);
  }

  function needStrategyRebalance(
    ITetuConverter converter_,
    int24 tick
  ) external view returns (
    bool needRebalance,
    bool[2] memory fuseStatusChangedAB,
    PairBasedStrategyLib.FuseStatus[2] memory fuseStatusAB
  ) {
    return PairBasedStrategyLogicLib.needStrategyRebalance(pairState, converter_, tick);
  }
}

