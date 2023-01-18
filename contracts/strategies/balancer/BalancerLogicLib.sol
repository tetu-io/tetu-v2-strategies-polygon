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
    uint indexBbAmUsdToken1;
    uint[] decimals;
    uint len;
    uint[] rates;
  }

  /// @notice Calculate amounts of {tokens} to be deposited to POOL_ID in proportions according to the {balances}
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
  ///             DAI, BB-AM-USD, USDC, USDT
  function getAmountsToDeposit(
    uint[] memory amountsDesiredABC_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    address bbAmUsdToken_
  ) internal view returns (
    uint[] memory amountsToDepositOut
  ) {
    LocalGetAmountsToDeposit memory p;
    // check not zero balances, cache index of bbAmUSD, save 10**decimals to array
    p.len = tokens_.length;
    require(p.len == balances_.length, AppErrors.WRONG_LENGTHS);
    require(p.len == amountsDesiredABC_.length || p.len - 1 == amountsDesiredABC_.length, AppErrors.WRONG_LENGTHS);
    IBalancerBoostedAaveStablePool pool = IBalancerBoostedAaveStablePool(0x48e6B98ef6329f8f0A30eBB8c7C960330d648085);
    IBVault vault = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    p.decimals = new uint[](p.len);
    p.rates = new uint[](p.len);
    for (uint i = 0; i < p.len; i = uncheckedInc(i)) {
      if (address(tokens_[i]) == bbAmUsdToken_) {
        p.indexBbAmUsdToken1 = i + 1;
      } else {
        require(balances_[i] != 0, AppErrors.ZERO_BALANCE);
        p.decimals[i] = 10**IERC20Metadata(address(tokens_[i])).decimals();
        IBalancerBoostedAavePool linearPool = IBalancerBoostedAavePool(address(tokens_[i]));
        (,uint[] memory subBalances,) = vault.getPoolTokens(linearPool.getPoolId());
        uint assetAmount = subBalances[linearPool.getMainIndex()]
          + subBalances[linearPool.getWrappedIndex()] * linearPool.getWrappedTokenRate() / 1e18;
        p.rates[i] = balances_[i] * 1e18 / assetAmount; // bpt/asset
        console.log("getAmountsToDeposit, i, assetAmount", i, assetAmount);
        console.log("getAmountsToDeposit, rate", p.rates[i]);
        console.log("getAmountsToDeposit, subBalances[linearPool.getMainIndex()]", subBalances[linearPool.getMainIndex()]);
        console.log("getAmountsToDeposit, subBalances[linearPool.getWrappedIndex()]", subBalances[linearPool.getWrappedIndex()]);
        console.log("getAmountsToDeposit, linearPool.getWrappedTokenRate()", linearPool.getWrappedTokenRate());
        //balances_[i] *= pool.getTokenRate(address(tokens_[i])) / 1e18;
      }
    }

    amountsToDepositOut = new uint[](p.len - (p.indexBbAmUsdToken1 == 0 ? 0 : 1));

    // the balances set proportions, i.e. 1 DAI, 2 USDC, 4 USDT => 1/7 - DAI, 2/7 - USDC, 4/7 - USDT
    // we have arbitrary desired amounts, i.e. DAI = X, USDC = Y, USDT = Z
    // for each token: assume that it can be used in full.
    // If so, what amounts will have other tokens in this case according to the given proportions?
    // i.e. DAI = X = 100.0 => USDC = 200.0, USDT = 400.0. We need: Y >= 200, Z >= 400
    // or   USDC = Y = 100.0 => DAI = 50.0, USDT = 200.0. We need: X >= 50, Z >= 200
    // If any amount is less then expected, the token cannot be used in full.
    // A token with min amount can be used in full, let's try to find its index.
    uint i3; // [0-2]
    for (uint i; i < p.len; i = uncheckedInc(i)) {
      if (p.indexBbAmUsdToken1 == i + 1) continue;

      uint amountInBpt18 = amountsDesiredABC_[i3] * p.rates[i];
      console.log("amountInBpt18, i", amountInBpt18, i);

      uint j; // [0-3]
      uint j3; // [0-2]
      for (; j < p.len; j = uncheckedInc(j)) {
        if (p.indexBbAmUsdToken1 == j + 1) continue;

        // amountDAI = amountUSDC * balancesDAI / balancesUSDC * decimalsDAI / decimalsUSDC
        console.log("amountsDesiredABC_[i3]", amountsDesiredABC_[i3]);
        console.log("p.rates[i3]", p.rates[i]);
        console.log("amountInBpt18", amountInBpt18);
        console.log("balances_[j]", balances_[j]);
        console.log("p.decimals[j]", p.decimals[j]);
        console.log("balances_[i]", balances_[i]);
        console.log("p.decimals[i]", p.decimals[i]);
        console.log("p.rates[j3]", p.rates[j]);
        amountsToDepositOut[j3] = amountInBpt18 * balances_[j] / p.rates[j] * p.decimals[j] / balances_[i] / p.decimals[i];
        console.log(" amountsToDepositOut[j3], j3",  amountsToDepositOut[j3], j3);
        if (amountsToDepositOut[j3] > amountsDesiredABC_[j3]) break;
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