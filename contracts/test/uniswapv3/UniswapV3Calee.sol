// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../../integrations/uniswap/IUniswapV3SwapCallback.sol";
import "hardhat/console.sol";

contract UniswapV3Callee is IUniswapV3MintCallback, IUniswapV3SwapCallback {
  /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
  uint160 internal constant MIN_SQRT_RATIO = 4295128739 + 1;
  /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
  uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342 - 1;

  bool public noRevert;

  function toggleNoRevert() external {
    noRevert = !noRevert;
  }

  function swap(
    address pool,
    address recipient,
    address tokenIn,
    uint amount
  ) external {
    address token0 = IUniswapV3Pool(pool).token0();
    if (noRevert) {
      try IUniswapV3Pool(pool).swap(
        recipient,
        tokenIn == token0,
        int(amount),
        tokenIn == token0 ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
        abi.encode(msg.sender)
      ) {} catch {
        console.log('Swap failed');
      }
    } else {
      IUniswapV3Pool(pool).swap(
        recipient,
        tokenIn == token0,
        int(amount),
        tokenIn == token0 ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
        abi.encode(msg.sender)
      );
    }
  }

  function mint(
    address pool,
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount
  ) external {
    IUniswapV3Pool(pool).mint(recipient, tickLower, tickUpper, amount, abi.encode(msg.sender));
  }

  function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
  ) external override {
    address sender = abi.decode(data, (address));

    if (amount0Delta > 0) {
      IERC20(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, uint(amount0Delta));
    } else if (amount1Delta > 0) {
      IERC20(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, uint(amount1Delta));
    }
  }

  /// @notice Uniswap V3 callback fn, called back on pool.mint
  function uniswapV3MintCallback(
    uint amount0Owed,
    uint amount1Owed,
    bytes calldata data
  ) external override {
    address sender = abi.decode(data, (address));
    if (amount0Owed > 0) {
      IERC20(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, amount0Owed);
    }
    if (amount1Owed > 0) {
      IERC20(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, amount1Owed);
    }
  }

}
