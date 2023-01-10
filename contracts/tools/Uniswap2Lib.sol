// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../integrations/uniswap/IUniswapV2Router02.sol";

/// @notice Helper utils for Uniswap2
library Uniswap2Lib {

  /// @notice What amounts of tokens A an B we will receive if we call removeLiquidity(liquidity_)
  function quoteRemoveLiquidity(
    IUniswapV2Router02 router_,
    address user_,
    address tokenA_,
    address tokenB_,
    uint liquidity_
  ) internal view returns(
    uint amountA,
    uint amountB
  ) {
    // todo
    return (amountA, amountB);
  }
}