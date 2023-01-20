// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../interfaces/converter/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib
contract ConverterStrategyBaseFacade {
  function getExpectedWithdrawnAmountUSD(
    address[] memory poolAssets_,
    uint[] memory reserves_,
    address asset_,
    uint liquidityAmount_,
    uint totalSupply_,
    IPriceOracle priceOracle_
  ) external view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmountUSD(
      poolAssets_,
      reserves_,
      asset_,
      liquidityAmount_,
      totalSupply_,
      priceOracle_
    );
  }
}