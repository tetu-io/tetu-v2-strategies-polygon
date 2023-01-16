// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/uniswap/IUniswapV2Router02.sol";
import "../../tools/Uniswap2Lib.sol";

/// @notice Provide direct access to Uniswal2Lib functions for unit tests
contract Uniswap2LibFacade {
  function quoteRemoveLiquidity(
    IUniswapV2Router02 router_,
    address user_,
    address tokenA_,
    address tokenB_,
    uint liquidity_
  ) external view returns(
    uint amountAOut,
    uint amountBOut
  ) {
    return Uniswap2Lib.quoteRemoveLiquidity(router_, user_, tokenA_, tokenB_, liquidity_);
  }
}