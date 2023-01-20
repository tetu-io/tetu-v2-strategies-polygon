// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../interfaces/converter/IPriceOracle.sol";

library ConverterStrategyBaseLib {
  /// @notice Get amount of USD that we expect to receive after withdrawing, decimals of {asset}
  ///         ratio = amount-LP-tokens-to-withdraw / total-amount-LP-tokens-in-pool
  ///         investedAssetsUSD = reserve0 * ratio * price0 + reserve1 * ratio * price1 (+ set correct decimals)
  /// @param liquidityAmount_ Amount of LP tokens that we are going to withdraw
  /// @param totalSupply_ Total amount of LP tokens in the depositor
  /// @return investedAssetsUSD Amount of USD that we expect to receive after withdrawing, decimals of {asset}
  /// @return assetPrice Price of {asset}, decimals 18
  function getExpectedWithdrawnAmountUSD(
    address[] memory poolAssets_,
    uint[] memory reserves_,
    address asset_,
    uint liquidityAmount_,
    uint totalSupply_,
    IPriceOracle priceOracle_
  ) internal view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    //    console.log("_getExpectedWithdrawnAmountUSD.liquidityAmount_", liquidityAmount_);
    //    console.log("_getExpectedWithdrawnAmountUSD.totalSupply_", totalSupply_);
    uint ratio = totalSupply_ == 0
      ? 0
      : (liquidityAmount_ >= totalSupply_
        ? 1e18
        : 1e18 * liquidityAmount_ / totalSupply_
    ); // we need brackets here for npm.run.coverage

    uint index0 = poolAssets_[0] == asset_ ? 0 : 1;
    uint index1 = index0 == 0 ? 1 : 0;

    assetPrice = priceOracle_.getAssetPrice(poolAssets_[index0]);
    uint priceSecond = priceOracle_.getAssetPrice(poolAssets_[index1]);
    //    console.log("_getExpectedWithdrawnAmountUSD.assetPrice", assetPrice);
    //    console.log("_getExpectedWithdrawnAmountUSD.priceSecond", priceSecond);

    investedAssetsUSD = assetPrice == 0 || priceSecond == 0
      ? 0 // it's better to return zero here than a half of the amount
      : ratio * (
        reserves_[index0] * assetPrice
        + reserves_[index1] * priceSecond // todo support ANY(!) number of tokens
        * 10**IERC20Metadata(poolAssets_[index0]).decimals()
        / 10**IERC20Metadata(poolAssets_[index1]).decimals()
      ) / 1e18 / 1e18; // price, ratio
  }
}