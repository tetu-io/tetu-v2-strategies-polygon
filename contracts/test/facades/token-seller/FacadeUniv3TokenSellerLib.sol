// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../../../token-seller/Univ3TokenSellerLib.sol";

contract FacadeUniv3TokenSellerLib {
  function calcTickRange(int24 tick, int24 tickRange, int24 tickSpacing) external pure returns (int24 lowerTick, int24 upperTick) {
    return Univ3TokenSellerLib.calcTickRangeSymmetrically(tick, tickRange, tickSpacing);
  }

  function calcTickRangeRightHalf(int24 tick, int24 tickRange, int24 tickSpacing) external pure returns (int24 lowerTick, int24 upperTick) {
    return Univ3TokenSellerLib.calcTickRangeRightHalf(tick, tickRange, tickSpacing);
  }

}