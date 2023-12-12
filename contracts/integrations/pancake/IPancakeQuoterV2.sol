// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

/// @dev Restored from base-chain:0x864ED564875BdDD6F421e226494a0E7c071C06f8
interface IPancakeQuoterV2 {
    function WETH9() external view returns (address);

    function deployer() external view returns (address);

    function factory() external view returns (address);

    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes memory path) external view;

    function quoteExactInput(bytes memory path, uint256 amountIn) external returns (
        uint256 amountOut,
        uint160[] memory sqrtPriceX96AfterList,
        uint32[] memory initializedTicksCrossedList,
        uint256 gasEstimate
    );

    function quoteExactInputSingle(IQuoterV2.QuoteExactInputSingleParams memory params) external returns (
        uint256 amountOut,
        uint160 sqrtPriceX96After,
        uint32 initializedTicksCrossed,
        uint256 gasEstimate
    );

    function quoteExactOutput(bytes memory path, uint256 amountOut) external returns (
        uint256 amountIn,
        uint160[] memory sqrtPriceX96AfterList,
        uint32[] memory initializedTicksCrossedList,
        uint256 gasEstimate
    );

    function quoteExactOutputSingle(IQuoterV2.QuoteExactOutputSingleParams memory params) external returns (
        uint256 amountIn,
        uint160 sqrtPriceX96After,
        uint32 initializedTicksCrossed,
        uint256 gasEstimate
    );
}

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }
}