// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";

/// @title Uniswap V3 liquidity management helper
/// @notice Provides functions for computing liquidity amounts from token amounts and prices
library UniswapV3Lib {
  uint8 internal constant RESOLUTION = 96;
  uint internal constant Q96 = 0x1000000000000000000000000;
  uint private constant TWO_96 = 2 ** 96;
  /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
  uint160 private constant MIN_SQRT_RATIO = 4295128739 + 1;
  /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
  uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342 - 1;
  /// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128
  int24 internal constant MIN_TICK = - 887272;
  /// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128
  int24 internal constant MAX_TICK = - MIN_TICK;

  struct PoolPosition {
    address pool;
    int24 lowerTick;
    int24 upperTick;
    uint128 liquidity;
    address owner;
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

  function getFees(PoolPosition memory position) public view returns (uint fee0, uint fee1) {
    bytes32 positionId = _getPositionId(position);
    IUniswapV3Pool pool = IUniswapV3Pool(position.pool);
    (, int24 tick, , , , ,) = pool.slot0();
    (, uint feeGrowthInside0Last, uint feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(positionId);
    fee0 = _computeFeesEarned(position, true, feeGrowthInside0Last, tick) + uint(tokensOwed0);
    fee1 = _computeFeesEarned(position, false, feeGrowthInside1Last, tick) + uint(tokensOwed1);
  }

  function addLiquidityPreview(address pool_, int24 lowerTick_, int24 upperTick_, uint amount0Desired_, uint amount1Desired_) external view returns (uint amount0Consumed, uint amount1Consumed, uint128 liquidityOut) {
    IUniswapV3Pool pool = IUniswapV3Pool(pool_);
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();
    liquidityOut = getLiquidityForAmounts(sqrtRatioX96, lowerTick_, upperTick_, amount0Desired_, amount1Desired_);
    (amount0Consumed, amount1Consumed) = getAmountsForLiquidity(sqrtRatioX96, lowerTick_, upperTick_, liquidityOut);
  }

  /// @notice Computes the maximum amount of liquidity received for a given amount of token0, token1, the current
  /// pool prices and the prices at the tick boundaries
  function getLiquidityForAmounts(
    uint160 sqrtRatioX96,
    int24 lowerTick,
    int24 upperTick,
    uint amount0,
    uint amount1
  ) public pure returns (uint128 liquidity) {
    uint160 sqrtRatioAX96 = _getSqrtRatioAtTick(lowerTick);
    uint160 sqrtRatioBX96 = _getSqrtRatioAtTick(upperTick);
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }

    if (sqrtRatioX96 <= sqrtRatioAX96) {
      liquidity = _getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      uint128 liquidity0 = _getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
      uint128 liquidity1 = _getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
      liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    } else {
      liquidity = _getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
    }
  }

  /// @notice Computes the token0 and token1 value for a given amount of liquidity, the current
  /// pool prices and the prices at the tick boundaries
  function getAmountsForLiquidity(
    uint160 sqrtRatioX96,
    int24 lowerTick,
    int24 upperTick,
    uint128 liquidity
  ) public pure returns (uint amount0, uint amount1) {
    uint160 sqrtRatioAX96 = _getSqrtRatioAtTick(lowerTick);
    uint160 sqrtRatioBX96 = _getSqrtRatioAtTick(upperTick);

    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }

    if (sqrtRatioX96 <= sqrtRatioAX96) {
      amount0 = _getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      amount0 = _getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
      amount1 = _getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
    } else {
      amount1 = _getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
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
  function getPrice(address pool_, address tokenIn) public view returns (uint) {
    IUniswapV3Pool pool = IUniswapV3Pool(pool_);
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

  /// @notice Computes the amount of liquidity received for a given amount of token0 and price range
  /// @dev Calculates amount0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower)).
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param amount0 The amount0 being sent in
  /// @return liquidity The amount of returned liquidity
  function _getLiquidityForAmount0(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint amount0) internal pure returns (uint128 liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
    uint intermediate = mulDiv(sqrtRatioAX96, sqrtRatioBX96, Q96);
    return _toUint128(mulDiv(amount0, intermediate, sqrtRatioBX96 - sqrtRatioAX96));
  }

  /// @notice Computes the amount of liquidity received for a given amount of token1 and price range
  /// @dev Calculates amount1 / (sqrt(upper) - sqrt(lower)).
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param amount1 The amount1 being sent in
  /// @return liquidity The amount of returned liquidity
  function _getLiquidityForAmount1(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint amount1) internal pure returns (uint128 liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
    return _toUint128(mulDiv(amount1, Q96, sqrtRatioBX96 - sqrtRatioAX96));
  }

  /// @notice Computes the amount of token0 for a given amount of liquidity and a price range
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param liquidity The liquidity being valued
  /// @return amount0 The amount0
  function _getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) internal pure returns (uint amount0) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
    return mulDivRoundingUp(1, mulDivRoundingUp(uint(liquidity) << RESOLUTION, sqrtRatioBX96 - sqrtRatioAX96, sqrtRatioBX96), sqrtRatioAX96);
  }

  /// @notice Computes the amount of token1 for a given amount of liquidity and a price range
  /// @param sqrtRatioAX96 A sqrt price
  /// @param sqrtRatioBX96 Another sqrt price
  /// @param liquidity The liquidity being valued
  /// @return amount1 The amount1
  function _getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) internal pure returns (uint amount1) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
    }
    return mulDivRoundingUp(liquidity, sqrtRatioBX96 - sqrtRatioAX96, Q96);
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

  /// @notice Calculates sqrt(1.0001^tick) * 2^96
  /// @dev Throws if |tick| > max tick
  /// @param tick The input tick for the above formula
  /// @return sqrtPriceX96 A Fixed point Q64.96 number representing the sqrt of the ratio of the two assets (token1/token0)
  /// at the given tick
  function _getSqrtRatioAtTick(int24 tick)
  internal
  pure
  returns (uint160 sqrtPriceX96)
  {
    uint256 absTick =
    tick < 0 ? uint256(- int256(tick)) : uint256(int256(tick));

    // EDIT: 0.8 compatibility
    require(absTick <= uint256(int256(MAX_TICK)), "T");

    uint256 ratio =
    absTick & 0x1 != 0
    ? 0xfffcb933bd6fad37aa2d162d1a594001
    : 0x100000000000000000000000000000000;
    if (absTick & 0x2 != 0)
      ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
    if (absTick & 0x4 != 0)
      ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
    if (absTick & 0x8 != 0)
      ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
    if (absTick & 0x10 != 0)
      ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
    if (absTick & 0x20 != 0)
      ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
    if (absTick & 0x40 != 0)
      ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
    if (absTick & 0x80 != 0)
      ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
    if (absTick & 0x100 != 0)
      ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
    if (absTick & 0x200 != 0)
      ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
    if (absTick & 0x400 != 0)
      ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
    if (absTick & 0x800 != 0)
      ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
    if (absTick & 0x1000 != 0)
      ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
    if (absTick & 0x2000 != 0)
      ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
    if (absTick & 0x4000 != 0)
      ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
    if (absTick & 0x8000 != 0)
      ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
    if (absTick & 0x10000 != 0)
      ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
    if (absTick & 0x20000 != 0)
      ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
    if (absTick & 0x40000 != 0)
      ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
    if (absTick & 0x80000 != 0)
      ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

    if (tick > 0) ratio = type(uint256).max / ratio;

    // this divides by 1<<32 rounding up to go from a Q128.128 to a Q128.96.
    // we then downcast because we know the result always fits within 160 bits due to our tick input constraint
    // we round up in the division so getTickAtSqrtRatio of the output price is always consistent
    sqrtPriceX96 = uint160(
      (ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1)
    );
  }

  /// @notice Calculates the greatest tick value such that getRatioAtTick(tick) <= ratio
  /// @dev Throws in case sqrtPriceX96 < MIN_SQRT_RATIO, as MIN_SQRT_RATIO is the lowest value getRatioAtTick may
  /// ever return.
  /// @param sqrtPriceX96 The sqrt ratio for which to compute the tick as a Q64.96
  /// @return tick The greatest tick for which the ratio is less than or equal to the input ratio
  function _getTickAtSqrtRatio(uint160 sqrtPriceX96) internal pure returns (int24 tick) {
    // second inequality must be < because the price can never reach the price at the max tick
    require(
      sqrtPriceX96 >= MIN_SQRT_RATIO && sqrtPriceX96 < MAX_SQRT_RATIO,
      "R"
    );
    uint256 ratio = uint256(sqrtPriceX96) << 32;

    uint256 r = ratio;
    uint256 msb = 0;

    assembly {
      let f := shl(7, gt(r, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := shl(6, gt(r, 0xFFFFFFFFFFFFFFFF))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := shl(5, gt(r, 0xFFFFFFFF))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := shl(4, gt(r, 0xFFFF))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := shl(3, gt(r, 0xFF))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := shl(2, gt(r, 0xF))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := shl(1, gt(r, 0x3))
      msb := or(msb, f)
      r := shr(f, r)
    }
    assembly {
      let f := gt(r, 0x1)
      msb := or(msb, f)
    }

    if (msb >= 128) r = ratio >> (msb - 127);
    else r = ratio << (127 - msb);

    int256 log_2 = (int256(msb) - 128) << 64;

    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(63, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(62, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(61, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(60, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(59, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(58, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(57, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(56, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(55, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(54, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(53, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(52, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(51, f))
      r := shr(f, r)
    }
    assembly {
      r := shr(127, mul(r, r))
      let f := shr(128, r)
      log_2 := or(log_2, shl(50, f))
    }

    tick = _getFinalTick(log_2, sqrtPriceX96);
  }

  function _getFinalTick(int256 log_2, uint160 sqrtPriceX96) internal pure returns (int24 tick) {
    // 128.128 number
    int256 log_sqrt10001 = log_2 * 255738958999603826347141;

    int24 tickLow =
    int24(
      (log_sqrt10001 - 3402992956809132418596140100660247210) >> 128
    );
    int24 tickHi =
    int24(
      (log_sqrt10001 + 291339464771989622907027621153398088495) >> 128
    );

    tick = (tickLow == tickHi)
    ? tickLow
    : (_getSqrtRatioAtTick(tickHi) <= sqrtPriceX96
    ? tickHi
    : tickLow);
  }

  function _getPositionId(PoolPosition memory position) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(position.owner, position.lowerTick, position.upperTick));
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

  function _toUint128(uint x) private pure returns (uint128 y) {
    require((y = uint128(x)) == x);
  }
}
