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

  function getCollaterals(
    uint amount_,
    address[] memory tokens_,
    uint[] memory weights_,
    uint totalWeight_,
    uint indexAsset_,
    IPriceOracle priceOracle
  ) external view returns (uint[] memory tokenAmountsOut) {
    return ConverterStrategyBaseLib.getCollaterals(
      amount_,
      tokens_,
      weights_,
      totalWeight_,
      indexAsset_,
      priceOracle
    );
  }

  function borrowPosition(
    ITetuConverter tetuConverter_,
    address collateralAsset,
    uint collateralAmount,
    address borrowAsset
  ) external returns (uint borrowedAmountOut) {
    return ConverterStrategyBaseLib.borrowPosition(
      tetuConverter_,
      collateralAsset,
      collateralAmount,
      borrowAsset
    );
  }

  function closePosition(
    ITetuConverter tetuConverter_,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) external returns (
    uint returnedAssetAmountOut,
    uint leftoverOut
  ) {
    return ConverterStrategyBaseLib.closePosition(
      tetuConverter_,
      collateralAsset,
      borrowAsset,
      amountToRepay
    );
  }

  function liquidate(
    ITetuLiquidator liquidator_,
    address tokenIn,
    address tokenOut,
    uint amountIn,
    uint slippage,
    uint rewardLiquidationThresholdForTokenOut
  ) external {
    return ConverterStrategyBaseLib.liquidate(
      liquidator_,
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      rewardLiquidationThresholdForTokenOut
    );
  }
}