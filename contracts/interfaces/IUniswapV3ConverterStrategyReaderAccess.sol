// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Interface required to implement UniswapV3Reader
interface IUniswapV3ConverterStrategyReaderAccess {
  function converter() external view returns (address);
  function splitter() external view returns (address);
  function totalAssets() external view returns (uint);
  // function liquidationThresholds(address asset) external view returns (uint);
}
