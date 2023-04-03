// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/uniswap/UniswapV3Lib.sol";

/// @notice Provide direct access to UniswapV3Lib functions for unit tests
contract UniswapV3LibFacade {
  function getAmountsForLiquidity(
    uint160 sqrtRatioX96,
    int24 lowerTick,
    int24 upperTick,
    uint128 liquidity
  ) public pure returns (uint amount0, uint amount1) {
    return UniswapV3Lib.getAmountsForLiquidity(sqrtRatioX96, lowerTick, upperTick, liquidity);
  }
}
