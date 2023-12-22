// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../../../integrations/pancake/IPancakeV3Pool.sol";
import "../../../integrations/moonwell/IMoonwellPriceOracle.sol";
import "../../../integrations/moonwell/IMoonwellAggregatorV3Interface.sol";
import "hardhat/console.sol";

contract MoonwellAggregatorV3PancakePool is IMoonwellAggregatorV3Interface{
  uint private constant TWO_96 = 2 ** 96;

  address public pool;
  address public tokenIn;
  constructor (address pool_, address tokenIn_) {
    pool = pool_;
    tokenIn = tokenIn_;
  }

  function decimals() external view returns (uint8) {
    return 8;
  }

  function description() external view returns (string memory) {
    return "test";
  }

  function version() external view returns (uint256) {
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
      int256(getPrice()),
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
      int256(getPrice()),
      block.timestamp / 60 * 60,
      block.timestamp / 60 * 60,
      uint80(block.timestamp / 60)
    );
  }

  function getPrice() public view returns (uint) {
    address token0 = IPancakeV3Pool(pool).token0();
    address token1 = IPancakeV3Pool(pool).token1();

    uint256 tokenInDecimals = tokenIn == token0 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    uint256 tokenOutDecimals = tokenIn == token1 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    (uint160 sqrtPriceX96,,,,,,) = IPancakeV3Pool(pool).slot0();

    uint divider = tokenOutDecimals < 18 ? Math.max(10 ** tokenOutDecimals / 10 ** tokenInDecimals, 1) : 1;

    uint priceDigits = _countDigits(uint(sqrtPriceX96));
    uint purePrice;
    uint precision;
    if (tokenIn == token0) {
      precision = 10 ** ((priceDigits < 29 ? 29 - priceDigits : 0) + tokenInDecimals);
      uint part = uint(sqrtPriceX96) * precision / TWO_96;
      purePrice = part * part;
    } else {
      precision = 10 ** ((priceDigits > 29 ? priceDigits - 29 : 0) + tokenInDecimals);
      uint part = TWO_96 * precision / uint(sqrtPriceX96);
      purePrice = part * part;
    }
    uint price = purePrice / divider / precision / (precision > 1e18 ? (precision / 1e18) : 1);

    if (tokenOutDecimals > 8) {
      price = price / 10 ** (tokenOutDecimals - 8);
    } else if (tokenOutDecimals < 8) {
      price = price * 10 ** (8 - tokenOutDecimals);
    }
    console.log("getPrice.price", price);
    return price;
  }

  function _countDigits(uint n) internal pure returns (uint) {
    if (n == 0) {
      return 0;
    }
    uint count = 0;
    while (n != 0) {
      n = n / 10;
      ++count;
    }
    return count;
  }

}