// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../tools/TokenAmountsLib.sol";

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

    /// @dev unites tokens2 and amounts2 in to tokens & amounts
    function unite(
        address[] memory tokens1,
        uint[] memory amounts1,
        address[] memory tokens2,
        uint[] memory amounts2
    ) external pure returns (
        address[] memory allTokens,
        uint[] memory allAmounts
    ) {
        return TokenAmountsLib.unite(tokens1, amounts1, tokens2, amounts2);
    }

    /// @dev prints tokens & amounts
    function print(
        address[] memory tokens,
        uint[] memory amounts
    ) external view {
        TokenAmountsLib.print(tokens, amounts);
    }

}
