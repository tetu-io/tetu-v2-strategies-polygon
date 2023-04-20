// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/aave/AggregatorInterface.sol";

/// @notice A source of asset's price for AAVE3 price oracle
///         See price oracle 0xb023e699F5a33916Ea823A16485e259257cA8Bd1
contract Aave3AggregatorInterfaceMock is AggregatorInterface {
  int256 public price;
  uint public round;
  mapping(uint => uint) roundToTimestamp;
  mapping(uint => int256) roundToPrice;

  constructor (int256 price_) {
    price = price_;
    round = 1;
    roundToTimestamp[round] = block.timestamp;
    roundToPrice[round] = price_;
  }

  function setPrice(int256 price_) external {
    price = price_;
    round += 1;
    roundToTimestamp[round] = block.timestamp;
    roundToPrice[round] = price_;
  }

  // ---------------  AggregatorInterface ----------------------------------------------------------
  function latestAnswer() external override view returns (int256) {
    return price;
  }

  function latestTimestamp() external override view returns (uint256) {
    return roundToTimestamp[round];
  }

  function latestRound() external override view returns (uint256) {
    return round;
  }

  function getAnswer(uint256 roundId) external override view returns (int256) {
    return roundToPrice[roundId];
  }

  function getTimestamp(uint256 roundId) external override view returns (uint256) {
    return roundToTimestamp[roundId];
  }
}