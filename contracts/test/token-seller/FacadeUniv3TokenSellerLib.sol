// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../../token-seller/Univ3TokenSellerLib.sol";

contract FacadeUniv3TokenSellerLib {

  //region ------------------------------ Utils
  /// @notice Calculate distance from current tick to lower bound in percents of the total tick range, decimals 5
  function calcNeedToRefreshRatio(int24 tick, int24 lowerBound, int24 upperBound) external pure returns (int32 ratio) {
    return Univ3TokenSellerLib.calcNeedToRefreshRatio(tick, lowerBound, upperBound);
  }

  //endregion ------------------------------ Utils

  //region ------------------------------ Calculate tick range

  function calcTickRange(int24 tick, int24 tickRange, int24 tickSpacing) external pure returns (int24 lowerTick, int24 upperTick) {
    return Univ3TokenSellerLib.calcTickRangeSymmetrically(tick, tickRange, tickSpacing);
  }

  function calcTickRangeRightHalf(int24 tick, int24 tickRange, int24 tickSpacing) external pure returns (int24 lowerTick, int24 upperTick) {
    return Univ3TokenSellerLib.calcTickRangeRightHalf(tick, tickRange, tickSpacing);
  }
  //endregion ------------------------------ Calculate tick range

}