// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/pair/PairBasedStrategyLogicLib.sol";

contract PairBasedStrategyLogicLibFacade {
  mapping(address => uint) internal liquidationThresholds;

  function setLiquidationThreshold(address asset, uint threshold) external {
    liquidationThresholds[asset] = threshold;
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
    address[] memory tokens,
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
}

