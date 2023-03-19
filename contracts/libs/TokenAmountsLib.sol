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

  /// @dev unites tokens2 and amounts2 in to tokens & amounts
  /// @notice zero amount tokens will be filtered!
  function unite(
    address[] memory tokens1,
    uint[] memory amounts1,
    address[] memory tokens2,
    uint[] memory amounts2
  ) internal pure returns (
    address[] memory allTokens,
    uint[] memory allAmounts
  ) {
    uint tokens1Length = tokens1.length;
    uint tokens2Length = tokens2.length;

    require(tokens1Length == amounts1.length && tokens2Length == amounts2.length, 'TAL: Arrays mismatch');

    uint maxLength = tokens1Length + tokens2Length;
    address[] memory tokens = new address[](maxLength);
    uint[] memory amounts = new uint[](maxLength);

    uint unitedLength = 0;

    // join tokens1
    for (uint i1 = 0; i1 < tokens1Length; i1++) {

      uint amount1 = amounts1[i1];
      if (amount1 == 0) continue;
      address token1 = tokens1[i1];
      bool united = false;

      for (uint i = 0; i < unitedLength; i++) {
        if (token1 == tokens[i]) {
          amounts[i] += amount1;
          united = true;
          break;
        }
      }
      if (!united) {
        tokens[unitedLength] = token1;
        amounts[unitedLength] = amount1;
        unitedLength++;
      }
    }

    // join tokens2
    for (uint i2 = 0; i2 < tokens2Length; i2++) {

      uint amount2 = amounts2[i2];
      if (amount2 == 0) continue;
      address token2 = tokens2[i2];
      bool united = false;

      for (uint i = 0; i < unitedLength; i++) {
        if (token2 == tokens[i]) {
          amounts[i] += amount2;
          united = true;
          break;
        }
      }
      if (!united) {
        tokens[unitedLength] = token2;
        amounts[unitedLength] = amount2;
        unitedLength++;
      }
    }

    // copy united tokens to result array
    allTokens = new address[](unitedLength);
    allAmounts = new uint[](unitedLength);
    for (uint i; i < unitedLength; i++) {
      allTokens[i] = tokens[i];
      allAmounts[i] = amounts[i];
    }

  }
}
