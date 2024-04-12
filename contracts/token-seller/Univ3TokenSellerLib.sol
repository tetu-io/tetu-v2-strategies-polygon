// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

library Univ3TokenSellerLib {
  function calcTickRange(int24 tick, int24 tickRange, int24 tickSpacing) internal pure returns (
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
}