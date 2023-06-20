// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./IUniswapV3Depositor.sol";

/// @notice Interface required to implement UniswapV3Reader
interface IUniswapV3ConverterStrategyReaderAccess is IUniswapV3Depositor {
  function converter() external view returns (address);
  function splitter() external view returns (address);
  function totalAssets() external view returns (uint);
  // function liquidationThresholds(address asset) external view returns (uint);
}
