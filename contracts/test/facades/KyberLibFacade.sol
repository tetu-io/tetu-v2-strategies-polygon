// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/kyber/KyberLib.sol";

/// @notice Provide direct access to UniswapV3Lib functions for unit tests
contract KyberLibFacade {
  function getAmountsForLiquidity(
    uint160 sqrtRatioX96,
    int24 lowerTick,
    int24 upperTick,
    uint128 liquidity
  ) public pure returns (uint amount0, uint amount1) {
    return KyberLib.getAmountsForLiquidity(sqrtRatioX96, lowerTick, upperTick, liquidity);
  }
}
