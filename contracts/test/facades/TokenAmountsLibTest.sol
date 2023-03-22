// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/TokenAmountsLib.sol";

/// @author bogdoslav
contract TokenAmountsLibTest {

  function filterZeroAmounts(
    address[] memory tokens,
    uint[] memory amounts
  ) external pure returns (
    address[] memory t,
    uint[] memory a
  ) {
    return TokenAmountsLib.filterZeroAmounts(tokens, amounts);
  }

  function combineArrays(
    address[] memory tokens0,
    uint[] memory amounts0,
    address[] memory tokens1,
    uint[] memory amounts1,
    address[] memory tokens2,
    uint[] memory amounts2
  ) external pure returns (
    address[] memory allTokens,
    uint[] memory allAmounts
  ) {
    return TokenAmountsLib.combineArrays(
      tokens0, amounts0,
      tokens1, amounts1,
      tokens2, amounts2
    );
  }
}
