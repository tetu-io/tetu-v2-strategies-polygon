// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/aave/AggregatorInterface.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "hardhat/console.sol";

/// @notice A source of asset's price for AAVE3 price oracle
///         See price oracle 0xb023e699F5a33916Ea823A16485e259257cA8Bd1
contract Aave3PriceSourceUniswapV3 is AggregatorInterface {
  IUniswapV3Pool public pool;
  address public token;
  uint private constant TWO_96 = 2 ** 96;

  constructor (address pool_, address token_) {
    pool = IUniswapV3Pool(pool_);
    token = token_;
  }

  // ---------------  AggregatorInterface ----------------------------------------------------------
  function latestAnswer() external override view returns (int256) {
    return int(_getPrice());
  }

  function latestTimestamp() external override view returns (uint256) {
    return block.timestamp / 60 * 60;
  }

  function latestRound() external override view returns (uint256) {
    return block.timestamp / 60;
  }

  function getAnswer(uint256 /*roundId*/) external override view returns (int256) {
    return int(_getPrice());
  }

  function getTimestamp(uint256 /*roundId*/) external override view returns (uint256) {
    return block.timestamp / 60 * 60;
  }

  // ---------------  UniswapV3 ----------------------------------------------------------

  /// @notice Calculates price in pool
  function _getPrice() internal view returns (uint) {
    address token0 = pool.token0();
    address token1 = pool.token1();

    uint tokenInDecimals = token == token0 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    uint tokenOutDecimals = token == token1 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    (uint160 sqrtPriceX96,,,,,,) = pool.slot0();

    uint divider = tokenOutDecimals < 18 ? _max(10 ** tokenOutDecimals / 10 ** tokenInDecimals, 1) : 1;

    uint priceDigits = _countDigits(uint(sqrtPriceX96));
    uint purePrice;
    uint precision;
    if (token == token0) {
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

    console.log('Aave3PriceSourceUniswapV3 price', price);
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

  function _max(uint a, uint b) internal pure returns (uint) {
    return a > b ? a : b;
  }
}