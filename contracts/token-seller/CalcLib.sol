// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

library CalcLib {
  error TooLowX(uint x);

  function sqrt(uint x) internal pure returns (uint z) {
    assembly {
    // Start off with z at 1.
      z := 1

    // Used below to help find a nearby power of 2.
      let y := x

    // Find the lowest power of 2 that is at least sqrt(x).
      if iszero(lt(y, 0x100000000000000000000000000000000)) {
        y := shr(128, y) // Like dividing by 2 ** 128.
        z := shl(64, z) // Like multiplying by 2 ** 64.
      }
      if iszero(lt(y, 0x10000000000000000)) {
        y := shr(64, y) // Like dividing by 2 ** 64.
        z := shl(32, z) // Like multiplying by 2 ** 32.
      }
      if iszero(lt(y, 0x100000000)) {
        y := shr(32, y) // Like dividing by 2 ** 32.
        z := shl(16, z) // Like multiplying by 2 ** 16.
      }
      if iszero(lt(y, 0x10000)) {
        y := shr(16, y) // Like dividing by 2 ** 16.
        z := shl(8, z) // Like multiplying by 2 ** 8.
      }
      if iszero(lt(y, 0x100)) {
        y := shr(8, y) // Like dividing by 2 ** 8.
        z := shl(4, z) // Like multiplying by 2 ** 4.
      }
      if iszero(lt(y, 0x10)) {
        y := shr(4, y) // Like dividing by 2 ** 4.
        z := shl(2, z) // Like multiplying by 2 ** 2.
      }
      if iszero(lt(y, 0x8)) {
      // Equivalent to 2 ** z.
        z := shl(1, z)
      }

    // Shifting right by 1 is like dividing by 2.
      z := shr(1, add(z, div(x, z)))
      z := shr(1, add(z, div(x, z)))
      z := shr(1, add(z, div(x, z)))
      z := shr(1, add(z, div(x, z)))
      z := shr(1, add(z, div(x, z)))
      z := shr(1, add(z, div(x, z)))
      z := shr(1, add(z, div(x, z)))

    // Compute a rounded down version of z.
      let zRoundDown := div(x, z)

    // If zRoundDown is smaller, use it.
      if lt(zRoundDown, z) {
        z := zRoundDown
      }
    }
  }

  /*********************************************
 *              PRB-MATH                      *
 *   https://github.com/hifi-finance/prb-math *
 **********************************************/

  /// @notice Calculates the binary logarithm of x.
  ///
  /// @dev Based on the iterative approximation algorithm.
  /// https://en.wikipedia.org/wiki/Binary_logarithm#Iterative_approximation
  ///
  /// Requirements:
  /// - x must be greater than or equal to SCALE, otherwise the result would be negative.
  ///
  /// Caveats:
  /// - The results are nor perfectly accurate to the last decimal,
  ///   due to the lossy precision of the iterative approximation.
  ///
  /// @param x The unsigned 60.18-decimal fixed-point number for which
  ///           to calculate the binary logarithm.
  /// @return result The binary logarithm as an unsigned 60.18-decimal fixed-point number.
    function log2(uint256 x) internal pure returns (uint256 result) {
      if (x < 1e18) revert TooLowX(x);

      // Calculate the integer part of the logarithm
      // and add it to the result and finally calculate y = x * 2^(-n).
      uint256 n = mostSignificantBit(x / 1e18);

      // The integer part of the logarithm as an unsigned 60.18-decimal fixed-point number.
      // The operation can't overflow because n is maximum 255 and SCALE is 1e18.
      uint256 rValue = n * 1e18;

      // This is y = x * 2^(-n).
      uint256 y = x >> n;

      // If y = 1, the fractional part is zero.
      if (y == 1e18) {
        return rValue;
      }

      // Calculate the fractional part via the iterative approximation.
      // The "delta >>= 1" part is equivalent to "delta /= 2", but shifting bits is faster.
      for (uint256 delta = 5e17; delta > 0; delta >>= 1) {
        y = (y * y) / 1e18;

        // Is y^2 > 2 and so in the range [2,4)?
        if (y >= 2 * 1e18) {
          // Add the 2^(-m) factor to the logarithm.
          rValue += delta;

          // Corresponds to z/2 on Wikipedia.
          y >>= 1;
        }
      }
      return rValue;
    }

  /// @notice Finds the zero-based index of the first one in the binary representation of x.
  /// @dev See the note on msb in the "Find First Set"
  ///      Wikipedia article https://en.wikipedia.org/wiki/Find_first_set
  /// @param x The uint256 number for which to find the index of the most significant bit.
  /// @return msb The index of the most significant bit as an uint256.
  //noinspection NoReturn
    function mostSignificantBit(uint256 x) internal pure returns (uint256 msb) {
      if (x >= 2 ** 128) {
        x >>= 128;
        msb += 128;
      }
      if (x >= 2 ** 64) {
        x >>= 64;
        msb += 64;
      }
      if (x >= 2 ** 32) {
        x >>= 32;
        msb += 32;
      }
      if (x >= 2 ** 16) {
        x >>= 16;
        msb += 16;
      }
      if (x >= 2 ** 8) {
        x >>= 8;
        msb += 8;
      }
      if (x >= 2 ** 4) {
        x >>= 4;
        msb += 4;
      }
      if (x >= 2 ** 2) {
        x >>= 2;
        msb += 2;
      }
      if (x >= 2 ** 1) {
        // No need to shift x any more.
        msb += 1;
      }
    }
}