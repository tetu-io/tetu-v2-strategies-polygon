// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";

/// @title Uniswap V3 liquidity amount and required math functions
/// @notice Provides functions for computing liquidity amounts from token amounts and prices
library UniswapV3Library {
  uint8 internal constant RESOLUTION = 96;
  uint internal constant Q96 = 0x1000000000000000000000000;
  uint private constant TWO_96 = 2 ** 96;
  uint160 private constant MIN_SQRT_RATIO = 4295128739 + 1;
  uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342 - 1;

  struct PoolPosition {
    address pool;
    int24 lowerTick;
    int24 upperTick;
    uint128 liquidity;
    address owner;
  }

  function getFees(PoolPosition memory position) public view returns (uint fee0, uint fee1) {
    bytes32 positionId = _getPositionId(position);
    IUniswapV3Pool pool = IUniswapV3Pool(position.pool);
    (, int24 tick, , , , ,) = pool.slot0();
    (, uint feeGrowthInside0Last, uint feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(positionId);
    fee0 = _computeFeesEarned(position, true, feeGrowthInside0Last, tick) + uint(tokensOwed0);
    fee1 = _computeFeesEarned(position, false, feeGrowthInside1Last, tick) + uint(tokensOwed1);
  }

  function _getPositionId(PoolPosition memory position) internal view returns(bytes32) {
    return keccak256(abi.encodePacked(position.owner, position.lowerTick, position.upperTick));
  }

  function _computeFeesEarned(
    PoolPosition memory position,
    bool isZero,
    uint feeGrowthInsideLast,
    int24 tick
  ) internal view returns (uint fee) {
    IUniswapV3Pool pool = IUniswapV3Pool(position.pool);
    uint feeGrowthOutsideLower;
    uint feeGrowthOutsideUpper;
    uint feeGrowthGlobal;
    if (isZero) {
      feeGrowthGlobal = pool.feeGrowthGlobal0X128();
      (,, feeGrowthOutsideLower,,,,,) = pool.ticks(position.lowerTick);
      (,, feeGrowthOutsideUpper,,,,,) = pool.ticks(position.upperTick);
    } else {
      feeGrowthGlobal = pool.feeGrowthGlobal1X128();
      (,,, feeGrowthOutsideLower,,,,) = pool.ticks(position.lowerTick);
      (,,, feeGrowthOutsideUpper,,,,) = pool.ticks(position.upperTick);
    }

  unchecked {
    // calculate fee growth below
    uint feeGrowthBelow;
    if (tick >= position.lowerTick) {
      feeGrowthBelow = feeGrowthOutsideLower;
    } else {
      feeGrowthBelow = feeGrowthGlobal - feeGrowthOutsideLower;
    }

    // calculate fee growth above
    uint feeGrowthAbove;
    if (tick < position.upperTick) {
      feeGrowthAbove = feeGrowthOutsideUpper;
    } else {
      feeGrowthAbove = feeGrowthGlobal - feeGrowthOutsideUpper;
    }

    uint feeGrowthInside =
    feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove;
    fee = mulDiv(
      position.liquidity,
      feeGrowthInside - feeGrowthInsideLast,
      0x100000000000000000000000000000000
    );
  }
  }

  function toUint128(uint x) private pure returns (uint128 y) {
    require((y = uint128(x)) == x);
  }

  /// @notice Computes the amount of liquidity received for a given amount of token0 and price range
  /// @dev Calculates amount0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower)).
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param amount0 The amount0 being sent in
  /// @return liquidity The amount of returned liquidity
  function getLiquidityForAmount0(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint amount0) internal pure returns (uint128 liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
    uint intermediate = mulDiv(sqrtRatioAX96, sqrtRatioBX96, Q96);
    return toUint128(mulDiv(amount0, intermediate, sqrtRatioBX96 - sqrtRatioAX96));
  }

  /// @notice Computes the amount of liquidity received for a given amount of token1 and price range
  /// @dev Calculates amount1 / (sqrt(upper) - sqrt(lower)).
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param amount1 The amount1 being sent in
  /// @return liquidity The amount of returned liquidity
  function getLiquidityForAmount1(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint amount1) internal pure returns (uint128 liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
    return toUint128(mulDiv(amount1, Q96, sqrtRatioBX96 - sqrtRatioAX96));
  }

  /// @notice Computes the maximum amount of liquidity received for a given amount of token0, token1, the current
  /// pool prices and the prices at the tick boundaries
  function getLiquidityForAmounts(
    uint160 sqrtRatioX96,
    uint160 sqrtRatioAX96,
    uint160 sqrtRatioBX96,
    uint amount0,
    uint amount1
  ) public pure returns (uint128 liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96)
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

    if (sqrtRatioX96 <= sqrtRatioAX96) {
      liquidity = getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      uint128 liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
      uint128 liquidity1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
      liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    } else {
      liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
    }
  }

  /// @notice Computes the amount of token0 for a given amount of liquidity and a price range
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param liquidity The liquidity being valued
  /// @return amount0 The amount0
  function getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) internal pure returns (uint amount0) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
//    return mulDiv(uint(liquidity) << RESOLUTION, sqrtRatioBX96 - sqrtRatioAX96, sqrtRatioBX96) / sqrtRatioAX96;
//    return mulDivRoundingUp(uint(liquidity) << RESOLUTION, sqrtRatioBX96 - sqrtRatioAX96, sqrtRatioBX96) / sqrtRatioAX96;
    return mulDivRoundingUp(1, mulDivRoundingUp(uint(liquidity) << RESOLUTION, sqrtRatioBX96 - sqrtRatioAX96, sqrtRatioBX96), sqrtRatioAX96);
  }

  /// @notice Computes the amount of token1 for a given amount of liquidity and a price range
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param liquidity The liquidity being valued
  /// @return amount1 The amount1
  function getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) internal pure returns (uint amount1) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
//    return mulDiv(liquidity, sqrtRatioBX96 - sqrtRatioAX96, Q96);
    return mulDivRoundingUp(liquidity, sqrtRatioBX96 - sqrtRatioAX96, Q96);
  }

  /// @notice Computes the token0 and token1 value for a given amount of liquidity, the current
  /// pool prices and the prices at the tick boundaries
  function getAmountsForLiquidity(
    uint160 sqrtRatioX96,
    uint160 sqrtRatioAX96,
    uint160 sqrtRatioBX96,
    uint128 liquidity
  ) public pure returns (uint amount0, uint amount1) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }

    if (sqrtRatioX96 <= sqrtRatioAX96) {
      amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      amount0 = getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
      amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
    } else {
      amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
    }
  }

  /// @notice Calculates floor(a×b÷denominator) with full precision. Throws if result overflows a uint or denominator == 0
  /// @param a The multiplicand
  /// @param b The multiplier
  /// @param denominator The divisor
  /// @return result The 256-bit result
  /// @dev Credit to Remco Bloemen under MIT license https://xn--2-umb.com/21/muldiv
  function mulDiv(
    uint a,
    uint b,
    uint denominator
  ) public pure returns (uint result) {
  unchecked {
    // 512-bit multiply [prod1 prod0] = a * b
    // Compute the product mod 2**256 and mod 2**256 - 1
    // then use the Chinese Remainder Theorem to reconstruct
    // the 512 bit result. The result is stored in two 256
    // variables such that product = prod1 * 2**256 + prod0
    uint prod0;
    // Least significant 256 bits of the product
    uint prod1;
    // Most significant 256 bits of the product
    assembly {
      let mm := mulmod(a, b, not(0))
      prod0 := mul(a, b)
      prod1 := sub(sub(mm, prod0), lt(mm, prod0))
    }

    // Handle non-overflow cases, 256 by 256 division
    if (prod1 == 0) {
      require(denominator > 0);
      assembly {
        result := div(prod0, denominator)
      }
      return result;
    }

    // Make sure the result is less than 2**256.
    // Also prevents denominator == 0
    require(denominator > prod1);

    ///////////////////////////////////////////////
    // 512 by 256 division.
    ///////////////////////////////////////////////

    // Make division exact by subtracting the remainder from [prod1 prod0]
    // Compute remainder using mulmod
    uint remainder;
    assembly {
      remainder := mulmod(a, b, denominator)
    }
    // Subtract 256 bit number from 512 bit number
    assembly {
      prod1 := sub(prod1, gt(remainder, prod0))
      prod0 := sub(prod0, remainder)
    }

    // Factor powers of two out of denominator
    // Compute largest power of two divisor of denominator.
    // Always >= 1.
    // EDIT for 0.8 compatibility:
    // see: https://ethereum.stackexchange.com/questions/96642/unary-operator-cannot-be-applied-to-type-uint
    uint twos = denominator & (~denominator + 1);

    // Divide denominator by power of two
    assembly {
      denominator := div(denominator, twos)
    }

    // Divide [prod1 prod0] by the factors of two
    assembly {
      prod0 := div(prod0, twos)
    }
    // Shift in bits from prod1 into prod0. For this we need
    // to flip `twos` such that it is 2**256 / twos.
    // If twos is zero, then it becomes one
    assembly {
      twos := add(div(sub(0, twos), twos), 1)
    }
    prod0 |= prod1 * twos;

    // Invert denominator mod 2**256
    // Now that denominator is an odd number, it has an inverse
    // modulo 2**256 such that denominator * inv = 1 mod 2**256.
    // Compute the inverse by starting with a seed that is correct
    // correct for four bits. That is, denominator * inv = 1 mod 2**4
    uint inv = (3 * denominator) ^ 2;
    // Now use Newton-Raphson iteration to improve the precision.
    // Thanks to Hensel's lifting lemma, this also works in modular
    // arithmetic, doubling the correct bits in each step.
    inv *= 2 - denominator * inv;
    // inverse mod 2**8
    inv *= 2 - denominator * inv;
    // inverse mod 2**16
    inv *= 2 - denominator * inv;
    // inverse mod 2**32
    inv *= 2 - denominator * inv;
    // inverse mod 2**64
    inv *= 2 - denominator * inv;
    // inverse mod 2**128
    inv *= 2 - denominator * inv;
    // inverse mod 2**256

    // Because the division is now exact we can divide by multiplying
    // with the modular inverse of denominator. This will give us the
    // correct result modulo 2**256. Since the precoditions guarantee
    // that the outcome is less than 2**256, this is the final result.
    // We don't need to compute the high bits of the result and prod1
    // is no longer required.
    result = prod0 * inv;
    return result;
  }
  }

  /// @notice Calculates ceil(a×b÷denominator) with full precision. Throws if result overflows a uint or denominator == 0
  /// @param a The multiplicand
  /// @param b The multiplier
  /// @param denominator The divisor
  /// @return result The 256-bit result
  function mulDivRoundingUp(
    uint a,
    uint b,
    uint denominator
  ) internal pure returns (uint result) {
    result = mulDiv(a, b, denominator);
    if (mulmod(a, b, denominator) > 0) {
      require(result < type(uint).max);
      result++;
    }
  }

  /// @notice Calculates price in pool
  function getPrice(IUniswapV3Pool pool, address tokenIn) public view returns (uint) {
    address token0 = pool.token0();
    address token1 = pool.token1();

    uint tokenInDecimals = tokenIn == token0 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    uint tokenOutDecimals = tokenIn == token1 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    (uint160 sqrtPriceX96,,,,,,) = pool.slot0();

    uint divider = tokenOutDecimals < 18 ? _max(10 ** tokenOutDecimals / 10 ** tokenInDecimals, 1) : 1;

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
    return purePrice / divider / precision / (precision > 1e18 ? (precision / 1e18) : 1);
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

  function _min(uint a, uint b) internal pure returns (uint) {
    return a < b ? a : b;
  }

  function _max(uint a, uint b) internal pure returns (uint) {
    return a > b ? a : b;
  }

  function getTickSpacing(uint24 fee) external pure returns (int24) {
    if (fee == 10000) {
      return 200;
    }
    if (fee == 3000) {
      return 60;
    }
    if (fee == 500) {
      return 10;
    }
    return 1;
  }
}