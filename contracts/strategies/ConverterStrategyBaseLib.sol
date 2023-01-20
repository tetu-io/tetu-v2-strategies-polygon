// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../interfaces/converter/IPriceOracle.sol";
import "../tools/AppErrors.sol";

library ConverterStrategyBaseLib {
  /// @notice Get amount of USD that we expect to receive after withdrawing, decimals of {asset_}
  ///         ratio = amount-LP-tokens-to-withdraw / total-amount-LP-tokens-in-pool
  ///         investedAssetsUSD = reserve0 * ratio * price0 + reserve1 * ratio * price1 (+ set correct decimals)
  /// @param poolAssets_ Any number of assets, one of them should be {asset_}
  /// @param reserves_ Reserves of the {poolAssets_}, same order, same length (we don't check it)
  /// @param liquidityAmount_ Amount of LP tokens that we are going to withdraw
  /// @param totalSupply_ Total amount of LP tokens in the depositor
  /// @return investedAssetsUSD Amount of USD that we expect to receive after withdrawing, decimals of {asset_}
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
    uint ratio = totalSupply_ == 0
      ? 0
      : (liquidityAmount_ >= totalSupply_
        ? 1e18
        : 1e18 * liquidityAmount_ / totalSupply_
    ); // we need brackets here for npm.run.coverage

    uint degreeTargetDecimals = 10**IERC20Metadata(asset_).decimals();

    uint len = poolAssets_.length;
    for (uint i = 0; i < len; ++i) {
      uint price = priceOracle_.getAssetPrice(poolAssets_[i]);
      require(price != 0, AppErrors.ZERO_PRICE);

      if (asset_ == poolAssets_[i]) {
        investedAssetsUSD += reserves_[i] * price / 1e18;
        assetPrice = price;
      } else {
        investedAssetsUSD += reserves_[i] * price
          * degreeTargetDecimals / 10**IERC20Metadata(poolAssets_[i]).decimals()
          / 1e18;
      }
    }

    return (investedAssetsUSD * ratio / 1e18, assetPrice);
  }
}