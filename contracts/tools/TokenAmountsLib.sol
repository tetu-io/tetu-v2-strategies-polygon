// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @title Library for clearing / joining token addresses & amounts arrays
/// @author bogdoslav
library TokenAmountsLib {

    /// @notice Version of the contract
    /// @dev Should be incremented when contract changed
    string public constant TOKEN_AMOUNTS_LIB_VERSION = "1.0.0";

    function filterZeroAmounts(
        address[] memory tokens,
        uint[] memory amounts
    ) internal pure returns (
        address[] memory t,
        uint[] memory a
    ) {
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
    function unite(
        address[] memory tokens1,
        uint[] memory amounts1,
        address[] memory tokens2,
        uint[] memory amounts2
    ) internal pure returns (
        address[] memory allTokens,
        uint[] memory allAmounts
    ) {

        require (tokens1.length == amounts1.length && tokens2.length == amounts2.length, 'Arrays mismatch');

        uint tokensLength = tokens1.length + tokens2.length;
        address[] memory tokens = new address[](tokensLength);
        uint[] memory amounts = new uint[](tokensLength);

        // copy tokens1 to tokens (& amounts)
        for (uint i; i < tokens1.length; i++) {
            tokens[i] = tokens1[i];
            amounts[i] = amounts1[i];
        }

        // join tokens2
        tokensLength = tokens1.length;
        for (uint t2; t2 < tokens2.length; t2++) {

            address token2 = tokens2[t2];
            uint amount2 = amounts2[t2];
            bool united = false;

            for (uint i; i < tokensLength; i++) {
                if (token2 == tokens1[i]) {
                    amounts[i] += amount2;
                    united = true;
                    break;
                }
            }

            if (!united) {
                tokens[tokensLength] = token2;
                amounts[tokensLength] = amount2;
                tokensLength++;
            }

        }

        // copy united tokens to result array
        allTokens = new address[](tokensLength);
        allAmounts = new uint[](tokensLength);
        for (uint i; i < tokensLength; i++) {
            allTokens[i] = tokens[i];
            allAmounts[i] = amounts[i];
        }

    }

}
