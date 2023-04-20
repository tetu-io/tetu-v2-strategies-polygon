// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice A source of asset price for AAVE3 price oracle
/// @dev Restored from https://polygonscan.com/address/0xb023e699F5a33916Ea823A16485e259257cA8Bd1#code
interface AggregatorInterface {
  function latestAnswer() external view returns (int256);

  function latestTimestamp() external view returns (uint256);

  function latestRound() external view returns (uint256);

  function getAnswer(uint256 roundId) external view returns (int256);

  function getTimestamp(uint256 roundId) external view returns (uint256);

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt);
}