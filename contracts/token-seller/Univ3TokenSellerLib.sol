// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

library Univ3TokenSellerLib {
  /// @notice Calculate values of lowerTick and upperTick so that the {tick} is in the middle of the total range
  /// @param tick Current tick (according to the current price)
  /// @param tickRange Half of the total range: upperTick - lowerTick = 2 * totalRange.
  /// {tickRange} must be evenly divisible by {tickSpacing}
  /// @param tickSpacing Distance between ticks (related to the fee)
  function calcTickRangeSymmetrically(int24 tick, int24 tickRange, int24 tickSpacing) internal pure returns (
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

  /// @notice Calculate values of lowerTick and upperTick so that the {tick} is at the left edge of the total range
  /// @param tick Current tick (according to the current price)
  /// @param tickRange Total range size = upperTick - lowerTick. It must be evenly divisible by {tickSpacing}
  /// @param tickSpacing Distance between ticks (related to the fee)
  function calcTickRangeRightHalf(int24 tick, int24 tickRange, int24 tickSpacing) internal pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
      lowerTick = (tick / tickSpacing - 1) * tickSpacing;
    } else {
      lowerTick = tick / tickSpacing * tickSpacing;
    }
    upperTick = tickRange == 0 ? lowerTick + tickSpacing : lowerTick + tickRange;
  }
}