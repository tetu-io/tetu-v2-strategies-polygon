// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Interface required to implement PairBasedStrategyReader
interface IPairBasedStrategyReaderAccess {
  function converter() external view returns (address);
  function splitter() external view returns (address);
  function totalAssets() external view returns (uint);
  function getPoolTokens() external view returns (address tokenA, address tokenB);
}
