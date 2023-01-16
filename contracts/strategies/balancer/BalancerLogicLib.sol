// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../tools/AppErrors.sol";
import "hardhat/console.sol";

library BalancerLogicLib {
  /// @notice Calculate amounts of {tokens} to be deposited to POOL_ID in proportions according to the {balances}
  /// @param amountsDesiredABC_ Desired amounts of tokens A, B, C (i.e DAI, USDC, USDT)
  /// @param tokens_ All bb-am-* tokens (including bb-am-USD) received through getPoolTokens
  /// @param balances_ Balances of bb-am-* pools in terms of bb-am-USD tokens (received through getPoolTokens)
  /// @param bbAmUsdToken_ BB_AM_USD_TOKEN
  function getAmountsToDeposit(
    uint[] memory amountsDesiredABC_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    address bbAmUsdToken_
  ) internal view returns (uint[] memory) {
    // let's take first token, calculate three possible amounts and select min
    uint indexBbAmUsdToken;
    uint len = tokens_.length;
    require(len == balances_.length, AppErrors.WRONG_LENGTHS);
    for (uint i = 0; i < len; i = uncheckedInc(i)) {
      if (address(tokens_[i]) == bbAmUsdToken_) {
        indexBbAmUsdToken = i;
        console.log("getAmountsToDeposit.indexBbAmUsdToken", indexBbAmUsdToken);
      } else {
        require(balances_[i] != 0, AppErrors.ZERO_BALANCE);
      }
    }

    // let's store 10**token.decimals to array
    uint[] memory decimals = new uint[](len);
    for (uint i = 0; i < len; i = uncheckedInc(i)) {
      if (indexBbAmUsdToken != i) {
        decimals[i] = 10**IERC20Metadata(address(tokens_[i])).decimals();
        console.log("getAmountsToDeposit.decimals.i", i, decimals[i]);
      }
    }

    uint[] memory dest = new uint[](len);
    // the balances set proportions, i.e. 1 DAI, 2 USDC, 4 USDT => 1/7 - DAI, 2/7 - USDC, 4/7 - USDT
    // we have arbitrary desired amounts, i.e. DAI = X, USDC = Y, USDT = Z
    // for each token assume, that if it can be used in full. What amounts should have other tokens in this case?
    // i.e. DAI = X = 100.0 => USDC = 200.0, USDT = 400.0. We need: Y >= 200, Z >= 400
    // or   USDC = Y = 100.0 => DAI = 50.0, USDT = 200.0. We need: X >= 50, Z >= 200
    // let's try to find index of token that can be used in full.
    for (uint i = 0; i < len; i = uncheckedInc(i)) {
      if (indexBbAmUsdToken == i) continue;

      bool notPassed;
      for (uint j = 0; j < len; j = uncheckedInc(j)) {
        if (indexBbAmUsdToken == j) continue;

        console.log("getAmountsToDeposit.i,j", i, j);
        console.log("getAmountsToDeposit.amountsDesiredABC_[i]", amountsDesiredABC_[i]);
        console.log("getAmountsToDeposit.amountsDesiredABC_[j]", amountsDesiredABC_[j]);
        console.log("getAmountsToDeposit.balances_[i]", balances_[i]);
        console.log("getAmountsToDeposit.balances_[j]", balances_[j]);
        // amountDAI = amountUSDC * balancesDAI / balancesUSDC * decimalsDAI / decimalsUSDC
        dest[j] = amountsDesiredABC_[i] * balances_[j] * decimals[j] / balances_[i] / decimals[i];
        if (dest[j] > amountsDesiredABC_[j]) {
          console.log("dest[j] > amountsDesiredABC_[j]", dest[j], amountsDesiredABC_[j]);
          notPassed = true;
          break;
        }
      }

      if (! notPassed) break;
    }

    return dest;
  }

  function uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

}