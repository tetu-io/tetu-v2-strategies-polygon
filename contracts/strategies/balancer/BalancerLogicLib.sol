// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../tools/AppErrors.sol";
import "hardhat/console.sol";

library BalancerLogicLib {
  /// @dev local vars in getAmountsToDeposit to avoid stack too deep
  struct LocalGetAmountsToDeposit {
    uint indexBbAmUsdToken1;
    uint[] decimals;
    uint len;
  }

  /// @notice Calculate amounts of {tokens} to be deposited to POOL_ID in proportions according to the {balances}
  ///         It returns 2 same arrays: {amountsToDepositOut} with BB-AM-USD and {userDataAmountsOut} without BB-AM-USD
  /// @dev It takes into account the case when getPoolTokens doesn't return BB-AM-USD in results.
  /// @param amountsDesiredABC_ Desired amounts of tokens. The order of the tokens is exactly the same as in {tokens}.
  ///                           But the array has length 3, not 4, because there is no amount for bb-am-USD here.
  /// @param tokens_ All bb-am-* tokens (including bb-am-USD) received through getPoolTokens
  ///                           The order of the tokens is exactly the same as in getPoolTokens-results
  /// @param balances_ Balances of bb-am-* pools in terms of bb-am-USD tokens (received through getPoolTokens)
  ///                           The order of the tokens is exactly the same as in {tokens}
  /// @param bbAmUsdToken_ BB_AM_USD_TOKEN
  /// @return amountsToDepositOut Desired amounts, including zero for BB-AM-USD
  ///         The order of the tokens is exactly the same as in results of getPoolTokens:
  ///         BB-AM-DAI, BB-AM-USD, BB-AM-USDC, BB-AM-USDT
  /// @return userDataAmountsOut Same array as amountsToDepositOut but there is no amount for BB-AM-USD here.
  ///         BB-AM-DAI,            BB-AM-USDC, BB-AM-USDT
  function getAmountsToDeposit(
    uint[] memory amountsDesiredABC_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    address bbAmUsdToken_
  ) internal view returns (
    uint[] memory amountsToDepositOut,
    uint[] memory userDataAmountsOut
  ) {
    LocalGetAmountsToDeposit memory p;
    // check not zero balances, cache index of bbAmUSD, save 10**decimals to array
    p.len = tokens_.length;
    require(p.len == balances_.length, AppErrors.WRONG_LENGTHS);
    require(p.len == amountsDesiredABC_.length || p.len - 1 == amountsDesiredABC_.length, AppErrors.WRONG_LENGTHS);

    p.decimals = new uint[](p.len);
    for (uint i = 0; i < p.len; i = uncheckedInc(i)) {
      if (address(tokens_[i]) == bbAmUsdToken_) {
        p.indexBbAmUsdToken1 = i + 1;
      } else {
        require(balances_[i] != 0, AppErrors.ZERO_BALANCE);
        p.decimals[i] = 10**IERC20Metadata(address(tokens_[i])).decimals();
      }
    }

    amountsToDepositOut = new uint[](p.len);
    userDataAmountsOut = new uint[](p.len - (p.indexBbAmUsdToken1 == 0 ? 0 : 1));

    // the balances set proportions, i.e. 1 DAI, 2 USDC, 4 USDT => 1/7 - DAI, 2/7 - USDC, 4/7 - USDT
    // we have arbitrary desired amounts, i.e. DAI = X, USDC = Y, USDT = Z
    // for each token: assume that it can be used in full.
    // If so, what amounts will have other tokens in this case according to the given proportions?
    // i.e. DAI = X = 100.0 => USDC = 200.0, USDT = 400.0. We need: Y >= 200, Z >= 400
    // or   USDC = Y = 100.0 => DAI = 50.0, USDT = 200.0. We need: X >= 50, Z >= 200
    // If any amount is less then expected, the token cannot be used in full.
    // A token with min amount can be used in full, let's try to find its index.
    uint i3;
    for (uint i; i < p.len; i = uncheckedInc(i)) {
      if (p.indexBbAmUsdToken1 == i + 1) continue;

      uint j;
      uint j3;
      for (; j < p.len; j = uncheckedInc(j)) {
        if (p.indexBbAmUsdToken1 == j + 1) continue;

        // amountDAI = amountUSDC * balancesDAI / balancesUSDC * decimalsDAI / decimalsUSDC
        amountsToDepositOut[j] = amountsDesiredABC_[i3] * balances_[j] * p.decimals[j] / balances_[i] / p.decimals[i];
        if (amountsToDepositOut[j] > amountsDesiredABC_[j3]) break;
        userDataAmountsOut[j3] = amountsToDepositOut[j];
        j3++;
      }

      if (j == p.len) break;
      i3++;
    }

    return (amountsToDepositOut, userDataAmountsOut);
  }

  /// @notice Find 0-based index of the {asset_} in {tokens_}, revert if the asset is not found
  /// @param startIndex0_ A position from which the search should be started
  function getAssetIndex(
    uint startIndex0_,
    IERC20[] memory tokens_,
    address asset_,
    uint lengthTokens_
  ) internal pure returns (uint) {

    for (uint i = startIndex0_; i < lengthTokens_; ++i) {
      if (address(tokens_[i]) == asset_) {
        return i;
      }
    }
    for (uint i = 0; i < startIndex0_; ++i) {
      if (address(tokens_[i]) == asset_) {
        return i;
      }
    }

    revert(AppErrors.ITEM_NOT_FOUND);
  }

  function uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

}