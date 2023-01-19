// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../tools/AppErrors.sol";
import "../../integrations/balancer/IBalancerBoostedAavePool.sol";
import "../../integrations/balancer/IBalancerBoostedAaveStablePool.sol";
import "../../integrations/balancer/IBVault.sol";
import "hardhat/console.sol";

library BalancerLogicLib {

  /// @dev local vars in getAmountsToDeposit to avoid stack too deep
  struct LocalGetAmountsToDeposit {
    /// @notice Decimals of {tokens_}, 0 for BPT
    uint[] decimals;
    /// @notice Length of {tokens_} array
    uint len;
    /// @notice amountBPT / underlyingAmount, decimals 18, 0 for BPT
    uint[] rates;
  }

  /// @notice Calculate amounts of {tokens} to be deposited to POOL_ID in proportions according to the {balances}
  /// @param amountsDesired_ Desired amounts of tokens. The order of the tokens is exactly the same as in {tokens}.
  ///                        But the array has length 3, not 4, because there is no amount for bb-am-USD here.
  /// @param tokens_ All bb-am-* tokens (including bb-am-USD) received through getPoolTokens
  ///                           The order of the tokens is exactly the same as in getPoolTokens-results
  /// @param balances_ Balances of bb-am-* pools in terms of bb-am-USD tokens (received through getPoolTokens)
  ///                           The order of the tokens is exactly the same as in {tokens}
  /// @param totalUnderlying_ Total amounts of underlying assets (DAI, USDC, etc) in embedded linear pools.
  ///                         The array should have same order of tokens as {tokens_}, value for BPT token is not used
  /// @param indexBpt_ Index of BPT token inside {balances_}, {tokens_} and {totalUnderlying_} arrays
  /// @return amountsOut Desired amounts in proper proportions for depositing.
  ///         The order of the tokens is exactly the same as in results of getPoolTokens, 0 for BPT
  ///         i.e. DAI, BB-AM-USD, USDC, USDT
  function getAmountsToDeposit(
    uint[] memory amountsDesired_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    uint[] memory totalUnderlying_,
    uint indexBpt_
  ) internal view returns (
    uint[] memory amountsOut
  ) {
    LocalGetAmountsToDeposit memory p;
    // check not zero balances, cache index of bbAmUSD, save 10**decimals to array
    p.len = tokens_.length;
    require(p.len == balances_.length, AppErrors.WRONG_LENGTHS);
    require(p.len == amountsDesired_.length || p.len - 1 == amountsDesired_.length, AppErrors.WRONG_LENGTHS);

    p.decimals = new uint[](p.len);
    p.rates = new uint[](p.len);
    for (uint i = 0; i < p.len; i = uncheckedInc(i)) {
      if (i != indexBpt_) {
        require(balances_[i] != 0, AppErrors.ZERO_BALANCE);
        p.decimals[i] = 10**IERC20Metadata(address(tokens_[i])).decimals();

        // Let's calculate a rate: amountBPT / underlyingAmount, decimals 18
        p.rates[i] = balances_[i] * 1e18 / totalUnderlying_[i];
      }
    }

    amountsOut = new uint[](p.len - 1);

    // The balances set proportions of underlying-bpt, i.e. bb-am-DAI : bb-am-USDC : bb-am-USDT
    // Our task is find amounts of DAI : USDC : USDT that won't change that proportions after deposit.
    // We have arbitrary desired amounts, i.e. DAI = X, USDC = Y, USDT = Z
    // For each token: assume that it can be used in full.
    // If so, what amounts will have other tokens in this case according to the given proportions?
    // i.e. DAI = X = 100.0 => USDC = 200.0, USDT = 400.0. We need: Y >= 200, Z >= 400
    // or   USDC = Y = 100.0 => DAI = 50.0, USDT = 200.0. We need: X >= 50, Z >= 200
    // If any amount is less then expected, the token cannot be used in full.
    // A token with min amount can be used in full, let's try to find its index.
    uint i3; // [0 : len - 1]
    for (uint i; i < p.len; i = uncheckedInc(i)) {
      if (indexBpt_ == i) continue;

      uint amountInBpt18 = amountsDesired_[i3] * p.rates[i];
      console.log("amountInBpt18, i", amountInBpt18, i);

      uint j; // [0 : len]
      uint j3; // [0 : len - 1]
      for (; j < p.len; j = uncheckedInc(j)) {
        if (indexBpt_ == j) continue;

        // alpha = balancesDAI / balancesUSDC * decimalsDAI / decimalsUSDC
        // amountDAI = amountUSDC * alpha * rateUSDC / rateDAI
        amountsOut[j3] = amountInBpt18 * balances_[j] / p.rates[j] * p.decimals[j] / balances_[i] / p.decimals[i];
        if (amountsOut[j3] > amountsDesired_[j3]) break;
        j3++;
      }

      if (j == p.len) break;
      i3++;
    }
  }


  /// @notice Calculate total amount of underlying asset for each token except BPT
  /// @dev Amount is calculated as MainTokenAmount + WrappedTokenAmount * WrappedTokenRate, see AaveLinearPool src
  function getTotalAssetAmounts(IBVault vault_, IERC20[] memory tokens_, uint indexBpt_) internal view returns (
    uint[] memory amountsOut
  ) {
    uint len = tokens_.length;
    amountsOut = new uint[](len);
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i != indexBpt_) {
        IBalancerBoostedAavePool linearPool = IBalancerBoostedAavePool(address(tokens_[i]));
        (, uint[] memory balances, ) = vault_.getPoolTokens(linearPool.getPoolId());

        amountsOut[i] =
          balances[linearPool.getMainIndex()]
          + balances[linearPool.getWrappedIndex()] * linearPool.getWrappedTokenRate() / 1e18;
      }
    }
  }

  /// @notice Split {liquidityAmount_} by assets according to proportions of their total balances
  /// @param liquidityAmount_ Amount to withdraw in bpt
  /// @param balances_ Balances received from getPoolTokens
  /// @param bptIndex_ Index of pool-pbt inside {balances_}
  /// @return bptAmountsOut Amounts of underlying-BPT. The array doesn't include an amount for pool-bpt
  ///         Total amount of {bptAmountsOut}-items is equal to {liquidityAmount_}
  function getBtpAmountsOut(
    uint liquidityAmount_,
    uint[] memory balances_,
    uint bptIndex_
  ) internal pure returns (uint[] memory bptAmountsOut) {
    // we assume here, that len >= 2
    // we don't check it because StableMath.sol in balancer has _MIN_TOKENS = 2;
    uint len = balances_.length;
    bptAmountsOut = new uint[](len - 1);

    // compute total balance, skip pool-bpt
    uint totalBalances;
    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex_) continue;
      totalBalances += balances_[i];
      // temporary save incomplete amounts to bptAmountsOut
      bptAmountsOut[k] = liquidityAmount_ * balances_[i];
      ++k;
    }

    // finalize computation of bptAmountsOut using known totalBalances
    uint total;
    for (uint i; i < len - 1; i = uncheckedInc(i)) {
      if (i == len - 2) {
        // leftovers => last item
        bptAmountsOut[i] = total > liquidityAmount_
          ? 0
          : liquidityAmount_ - total;
      } else {
        bptAmountsOut[i] /= totalBalances;
        total += bptAmountsOut[i];
      }
    }
  }

  /// @notice Find 0-based index of the {asset_} in {tokens_}, revert if the asset is not found
  /// @param startIndex0_ A position from which the search should be started
  function getAssetIndex(
    uint startIndex0_,
    IERC20[] memory tokens_,
    address asset_,
    uint lengthTokens_
  ) internal pure returns (uint) {

    for (uint i = startIndex0_; i < lengthTokens_; i = uncheckedInc(i)) {
      if (address(tokens_[i]) == asset_) {
        return i;
      }
    }
    for (uint i = 0; i < startIndex0_; i = uncheckedInc(i)) {
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