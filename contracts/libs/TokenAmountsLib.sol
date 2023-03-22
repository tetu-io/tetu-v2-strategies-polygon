// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @title Library for clearing / joining token addresses & amounts arrays
/// @author bogdoslav
library TokenAmountsLib {

  function uncheckedInc(uint i) internal pure returns (uint) {
  unchecked {
    return i + 1;
  }
  }

  /// @notice Version of the contract
  /// @dev Should be incremented when contract changed
  string internal constant TOKEN_AMOUNTS_LIB_VERSION = "1.0.0";

  function filterZeroAmounts(
    address[] memory tokens,
    uint[] memory amounts
  ) internal pure returns (
    address[] memory t,
    uint[] memory a
  ) {
    require(tokens.length == amounts.length, 'TAL: Arrays mismatch');
    uint len2 = 0;
    uint len = tokens.length;
    for (uint i = 0; i < len; i++) {
      if (amounts[i] != 0) len2++;
    }

    t = new address[](len2);
    a = new uint[](len2);

    uint j = 0;
    for (uint i = 0; i < len; i++) {
      uint amount = amounts[i];
      if (amount != 0) {
        t[j] = tokens[i];
        a[j] = amount;
        j++;
      }
    }
  }

  /// @notice unites three arrays to single array without duplicates, amounts are sum, zero amounts are allowed
  function combineArrays(
    address[] memory tokens0,
    uint[] memory amounts0,
    address[] memory tokens1,
    uint[] memory amounts1,
    address[] memory tokens2,
    uint[] memory amounts2
  ) internal pure returns (
    address[] memory allTokens,
    uint[] memory allAmounts
  ) {
    uint[] memory lens = new uint[](3);
    lens[0] = tokens0.length;
    lens[1] = tokens1.length;
    lens[2] = tokens2.length;

    require(
      lens[0] == amounts0.length && lens[1] == amounts1.length && lens[2] == amounts2.length,
      'TAL: Arrays mismatch'
    );

    uint maxLength = lens[0] + lens[1] + lens[2];
    address[] memory tokensOut = new address[](maxLength);
    uint[] memory amountsOut = new uint[](maxLength);
    uint unitedLength;

    for (uint step; step < 3; ++step) {
      uint[] memory amounts = step == 0
        ? amounts0
        : step == 1
          ? amounts1
          : amounts2;
      address[] memory tokens = step == 0
        ? tokens0
        : step == 1
          ? tokens1
          : tokens2;
      for (uint i1 = 0; i1 < lens[step]; i1++) {
        uint amount1 = amounts[i1];
        address token1 = tokens[i1];
        bool united = false;

        for (uint i = 0; i < unitedLength; i++) {
          if (token1 == tokensOut[i]) {
            amountsOut[i] += amount1;
            united = true;
            break;
          }
        }

        if (!united) {
          tokensOut[unitedLength] = token1;
          amountsOut[unitedLength] = amount1;
          unitedLength++;
        }
      }
    }

    // copy united tokens to result array
    allTokens = new address[](unitedLength);
    allAmounts = new uint[](unitedLength);
    for (uint i; i < unitedLength; i++) {
      allTokens[i] = tokensOut[i];
      allAmounts[i] = amountsOut[i];
    }

  }
}
