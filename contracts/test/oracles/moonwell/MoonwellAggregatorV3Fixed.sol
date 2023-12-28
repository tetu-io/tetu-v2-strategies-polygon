// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../../../integrations/pancake/IPancakeV3Pool.sol";
import "../../../integrations/moonwell/IMoonwellPriceOracle.sol";
import "../../../integrations/moonwell/IMoonwellAggregatorV3Interface.sol";

contract MoonwellAggregatorV3Fixed is IMoonwellAggregatorV3Interface {
  uint public price8;
  constructor (uint price_) {
    price8 = price_;
  }

  function decimals() external pure returns (uint8) {
    return 8;
  }

  function description() external pure returns (string memory) {
    return "test";
  }

  function version() external pure returns (uint256) {
    return 1;
  }

  // getRoundData and latestRoundData should both raise "No data present"
  // if they do not have data to report, instead of returning unset values
  // which could be misinterpreted as actual reported values.
  function getRoundData(uint80 /*_roundId*/) external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    return (
      uint80(block.timestamp / 60),
      int256(price8),
      block.timestamp / 60 * 60,
      block.timestamp / 60 * 60,
      uint80(block.timestamp / 60)
    );
  }

  function latestRoundData() external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    return (
      uint80(block.timestamp / 60),
      int256(price8),
      block.timestamp / 60 * 60,
      block.timestamp / 60 * 60,
      uint80(block.timestamp / 60)
    );
  }
}