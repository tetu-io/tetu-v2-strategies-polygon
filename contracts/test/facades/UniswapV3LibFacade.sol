// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/uniswap/UniswapV3Lib.sol";

/// @notice Provide direct access to UniswapV3Lib functions for unit tests
contract UniswapV3LibFacade {
  function getTickSpacing(uint24 fee) external pure returns (int24) {
    return UniswapV3Lib.getTickSpacing(fee);
  }

  function getFees(UniswapV3Lib.PoolPosition memory position) external view returns (uint fee0, uint fee1) {
    return UniswapV3Lib.getFees(position);
  }

  function addLiquidityPreview(address pool_, int24 lowerTick_, int24 upperTick_, uint amount0Desired_, uint amount1Desired_) external view returns (
    uint amount0Consumed,
    uint amount1Consumed,
    uint128 liquidityOut
  ) {
    return UniswapV3Lib.addLiquidityPreview(pool_, lowerTick_, upperTick_, amount0Desired_, amount1Desired_);
  }

  function getLiquidityForAmounts(
    uint160 sqrtRatioX96,
    int24 lowerTick,
    int24 upperTick,
    uint amount0,
    uint amount1
  ) external pure returns (uint128 liquidity) {
    return UniswapV3Lib.getLiquidityForAmounts(sqrtRatioX96, lowerTick, upperTick, amount0, amount1);
  }

  function getAmountsForLiquidity(
    uint160 sqrtRatioX96,
    int24 lowerTick,
    int24 upperTick,
    uint128 liquidity
  ) external pure returns (uint amount0, uint amount1) {
    return UniswapV3Lib.getAmountsForLiquidity(sqrtRatioX96, lowerTick, upperTick, liquidity);
  }

  function mulDiv(uint a, uint b, uint denominator) external pure returns (uint result) {
    return UniswapV3Lib.mulDiv(a, b, denominator);
  }

  function mulDivRoundingUp(uint a, uint b, uint denominator) external pure returns (uint result) {
    return UniswapV3Lib.mulDivRoundingUp(a, b, denominator);
  }

  function getPrice(address pool_, address tokenIn) external view returns (uint) {
    return UniswapV3Lib.getPrice(pool_, tokenIn);
  }

  function _getSqrtRatioAtTick(int24 tick) external pure returns (uint160 sqrtPriceX96) {
    return UniswapV3Lib._getSqrtRatioAtTick(tick);
  }

  function _getTickAtSqrtRatio(uint160 sqrtPriceX96) external pure returns (int24 tick) {
    return UniswapV3Lib._getTickAtSqrtRatio(sqrtPriceX96);
  }

  function _getFinalTick(int256 log_2, uint160 sqrtPriceX96) external pure returns (int24 tick) {
    return UniswapV3Lib._getFinalTick(log_2, sqrtPriceX96);
  }

  function _getLiquidityForAmount0(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint amount0) external pure returns (uint128 liquidity) {
    return UniswapV3Lib._getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
  }

  function _getLiquidityForAmount1(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint amount1) external pure returns (uint128 liquidity) {
    return UniswapV3Lib._getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
  }

  function _getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) external pure returns (uint amount0) {
    return UniswapV3Lib._getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
  }

  function _getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) external pure returns (uint amount1) {
    return UniswapV3Lib._getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
  }

}
