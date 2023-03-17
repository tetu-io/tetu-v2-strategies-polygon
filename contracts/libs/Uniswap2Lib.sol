// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

//import "../integrations/uniswap/IUniswapV2Router02.sol";
//import "../integrations/uniswap/IUniswapV2Factory.sol";
//import "../integrations/uniswap/IUniswapV2Pair.sol";
//
//import "hardhat/console.sol";
//
///// @notice Helper utils for Uniswap2
//library Uniswap2Lib {
//
//  /// @notice What amounts of tokens A an B we will receive if we call removeLiquidity(liquidity_)
//  /// @dev The implementation is made on the base of DystRouter01.quoteRemoveLiquidity
//  function quoteRemoveLiquidity(
//    IUniswapV2Router02 router_,
//    address /*user_*/,
//    address tokenA_,
//    address tokenB_,
//    uint liquidity_
//  ) internal view returns(
//    uint amountAOut,
//    uint amountBOut
//  ) {
//    console.log("quoteRemoveLiquidity", liquidity_);
//    IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(router_.factory()).getPair(tokenA_, tokenB_));
//
//    if (address(pair) == address(0)) {
//      return (0, 0);
//    }
//    console.log("quoteRemoveLiquidity.pair", address(pair));
//
//    (uint reserve0, uint reserve1,) = pair.getReserves();
//    (uint reserveA, uint reserveB) = tokenA_ == pair.token0()
//      ? (reserve0, reserve1)
//      : (reserve1, reserve0);
//
//    console.log("quoteRemoveLiquidity.reserves", reserveA, reserveB);
//
//    uint totalSupply = pair.totalSupply();
//    console.log("quoteRemoveLiquidity.totalSupply", totalSupply);
//    // using balances ensures pro-rata distribution
//    amountAOut = liquidity_ * reserveA / totalSupply;
//    // using balances ensures pro-rata distribution
//    amountBOut = liquidity_ * reserveB / totalSupply;
//    console.log("quoteRemoveLiquidity.amountAOut, amountBOut", amountAOut, amountBOut);
//  }
//}
