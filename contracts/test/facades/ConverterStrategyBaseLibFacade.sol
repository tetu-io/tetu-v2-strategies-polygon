// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../interfaces/converter/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib
contract ConverterStrategyBaseLibFacade {
  function getExpectedWithdrawnAmounts(
    uint[] memory reserves_,
    uint liquidityAmount_,
    uint totalSupply_
  ) external view returns (
    uint[] memory withdrawnAmountsOut
  ) {
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmounts(reserves_, liquidityAmount_, totalSupply_);
  }

  mapping (address => uint) public baseAmounts;
  function setBaseAmounts(address asset, uint amount) external {
    baseAmounts[asset] = amount;
  }

  function getLiquidityAmountRatio(
    uint targetAmount_,
    address strategy_,
    ConverterStrategyBaseLib.LiquidityAmountRatioInputParams memory params_
  ) external returns (
    uint liquidityRatioOut,
    uint[] memory amountsToConvertOut
  ) {
    return ConverterStrategyBaseLib.getLiquidityAmountRatio(targetAmount_, baseAmounts, strategy_, params_);
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