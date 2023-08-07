// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

///@notice Restored from 0x4d47fd5a29904Dae0Ef51b1c450C9750F15D7856
interface IKyberQuoterV2 {
    function WETH9() external view returns (address);

    function factory() external view returns (address);

    function quoteExactInput(bytes memory path, uint256 amountIn)
    external
    returns (uint256 amountOut);

    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);

    function quoteExactOutput(bytes memory path, uint256 amountOut)
    external
    returns (uint256 amountIn);

    function quoteExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountIn);

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes memory path
    ) external view;
}
