// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/aave/AggregatorInterface.sol";


/// @notice A source of asset's price for AAVE3 price oracle
///         See price oracle 0xb023e699F5a33916Ea823A16485e259257cA8Bd1
contract Aave3PriceSourceFixed is AggregatorInterface {
  int256 public price;

  constructor (int256 price_) {
    price = price_;
  }

  // ---------------  AggregatorInterface ----------------------------------------------------------
  function latestAnswer() external override view returns (int256) {
    return price;
  }

  function latestTimestamp() external override view returns (uint256) {
    return block.timestamp / 60 * 60;
  }

  function latestRound() external override view returns (uint256) {
    return block.timestamp / 60;
  }

  function getAnswer(uint256 /*roundId*/) external override view returns (int256) {
    return price;
  }

  function getTimestamp(uint256 /*roundId*/) external override view returns (uint256) {
    return block.timestamp / 60 * 60;
  }

}