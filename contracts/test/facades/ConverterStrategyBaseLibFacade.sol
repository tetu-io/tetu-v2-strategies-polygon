// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../interfaces/converter/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib
contract ConverterStrategyBaseLibFacade {
  function getExpectedWithdrawnAmountUSD(
    uint[] memory reserves_,
    uint liquidityAmount_,
    uint totalSupply_,
    uint[] memory prices_,
    uint[] memory decimals_,
    uint indexAsset_
  ) external view returns (
    uint investedAssetsUsdSecondary,
    uint investedAssetsUsdMain
  ) {
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmountUSD(
      reserves_,
      liquidityAmount_,
      totalSupply_,
      prices_,
      decimals_,
      indexAsset_
    );
  }

  function getExpectedInvestedAssetsUSD(
    uint expectedInvestedAssetsUsdSecondary_,
    uint expectedInvestedAssetsUsdMain_,
    uint[] memory prices_,
    uint[] memory decimals_,
    uint indexAsset_,
    uint[] memory withdrawnAmounts_,
    uint receivedCollateral_
  ) external view returns (
    uint investedAssetsUsdOut
  ){
    return ConverterStrategyBaseLib.getExpectedInvestedAssetsUSD(
      expectedInvestedAssetsUsdSecondary_,
      expectedInvestedAssetsUsdMain_,
      prices_,
      decimals_,
      indexAsset_,
      withdrawnAmounts_,
      receivedCollateral_
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

  function openPosition(
    ITetuConverter tetuConverter_,
    bytes memory entryData_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountIn_
  ) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    return ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData_,
      collateralAsset_,
      borrowAsset_,
      amountIn_
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
  ) external returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    return ConverterStrategyBaseLib.liquidate(
      liquidator_,
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      rewardLiquidationThresholdForTokenOut
    );
  }

  function getAssetIndex(address[] memory tokens_, address asset_) external pure returns (uint) {
    return ConverterStrategyBaseLib.getAssetIndex(tokens_, asset_);
  }
}