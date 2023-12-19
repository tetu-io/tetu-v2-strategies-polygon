// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../../integrations/pancake/IPancakeV3Pool.sol";

/// @notice This oracle replaces original chainlink-oracle on moonwell protocol on base chain
///         to be able to sync prices in the oracle and in the given PancakeSwap pool
contract MoonwellPriceOracleAbovePancakePool {
  uint private constant TWO_96 = 2 ** 96;

  address public stableMToken;
  address public stableUnderlying;
  /// @notice decimals = [36 - decimals of the stableUnderlying]
  uint public priceStableToken;
  address public volatileMToken;
  address public volatileUnderlying;
  address public pancakePool;

  constructor(
    address stableMToken_,
    address stableUnderlying_,
    uint priceStableToken18_,
    address volatileMToken_,
    address volatileUnderlying_,
    address pancakePool_
  ) {
    stableMToken = stableMToken_;
    stableUnderlying = stableUnderlying_;
    priceStableToken = priceStableToken18_ * 10**18 / 10**IERC20Metadata(stableUnderlying).decimals();
    volatileUnderlying = volatileUnderlying_;
    volatileMToken = volatileMToken_;
    pancakePool = pancakePool_;
  }

  /// @return price of mToken, decimals = [36 - decimals of the underlying of the mToken]
  function getUnderlyingPrice(address mToken) public view returns (uint) {
    if (mToken == stableMToken) {
      return priceStableToken;
    } else if (mToken == volatileMToken) {
      uint price = getPrice(pancakePool, volatileUnderlying);
      return price * 10**36 / 10**IERC20Metadata(volatileUnderlying).decimals();
    } else {
      revert("MoonwellPriceOracleAbovePancakePool - unsupported mToken");
    }
  }

  function getPrice(address pool, address tokenIn) public view returns (uint) {
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