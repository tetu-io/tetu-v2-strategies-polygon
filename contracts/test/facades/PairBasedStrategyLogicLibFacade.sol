// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/pair/PairBasedStrategyLogicLib.sol";

contract PairBasedStrategyLogicLibFacade {
  mapping(address => uint) public liquidationThresholds;
  PairBasedStrategyLogicLib.PairState internal pairState;

  //region Auxiliary functions
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
    PairBasedStrategyLib.FuseStateParams[2] memory fuseAB,
    uint withdrawDone
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

    pairState.withdrawDone = withdrawDone;
  }

  function getPairState() external view returns(
    address[2] memory tokensAB,
    address pool,
    bool isStablePool,
    int24[4] memory tickParams,
    bool depositorSwapTokens,
    uint128 totalLiquidity,
    address strategyProfitHolder,
    uint[10] memory fuseParams, // [fuse A status, 4 thresholds of fuse A, fuse B status, 4 thresholds of fuse B]
    uint withdrawDone
  ) {
    return (
      [pairState.tokenA, pairState.tokenB],
      pairState.pool,
      pairState.isStablePool,
      [pairState.tickSpacing, pairState.lowerTick, pairState.upperTick, pairState.rebalanceTickRange],
      pairState.depositorSwapTokens,
      pairState.totalLiquidity,
      pairState.strategyProfitHolder,
      [
        uint(pairState.fuseAB[0].status),
        pairState.fuseAB[0].thresholds[0],
        pairState.fuseAB[0].thresholds[1],
        pairState.fuseAB[0].thresholds[2],
        pairState.fuseAB[0].thresholds[3],
        uint(pairState.fuseAB[1].status),
        pairState.fuseAB[1].thresholds[0],
        pairState.fuseAB[1].thresholds[1],
        pairState.fuseAB[1].thresholds[2],
        pairState.fuseAB[1].thresholds[3]
      ],
      pairState.withdrawDone
    );
  }
  //endregion Auxiliary functions

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
    address[2] calldata tokens,
    bytes memory planEntryData,
    address controller
  ) external view returns (
    PairBasedStrategyLogicLib.WithdrawLocal memory dest // for tests it's ok to return a struct
  ) {
    PairBasedStrategyLogicLib.initWithdrawLocal(dest, tokens, liquidationThresholds, planEntryData, controller);
    return dest;
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

  function setInitialDepositorValues(
    address[4] calldata addr,
    int24[4] calldata tickData,
    bool isStablePool_,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
  ) external {
    PairBasedStrategyLogicLib.setInitialDepositorValues(pairState, addr, tickData, isStablePool_, fuseThresholdsA, fuseThresholdsB);
  }

  function updateFuseStatus(
    bool[2] calldata fuseStatusChangedAB,
    PairBasedStrategyLib.FuseStatus[2] calldata fuseStatusAB
  ) external {
    PairBasedStrategyLogicLib.updateFuseStatus(pairState, fuseStatusChangedAB, fuseStatusAB);
  }

  function getDefaultState() external view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  ) {
    return PairBasedStrategyLogicLib.getDefaultState(pairState);
  }
}

