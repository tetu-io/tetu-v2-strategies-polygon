// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./IPairBasedDefaultStateProvider.sol";

/// @notice Interface required to implement PairBasedStrategyReader
interface IPairBasedStrategyReaderAccess is IPairBasedDefaultStateProvider {
  function converter() external view returns (address);
  function splitter() external view returns (address);
  function totalAssets() external view returns (uint);
  function asset() external view returns (address);
}
