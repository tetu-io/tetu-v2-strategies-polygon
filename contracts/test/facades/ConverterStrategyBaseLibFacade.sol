// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;


import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib.sol";
import "../../strategies/ConverterStrategyBaseLib2.sol";
import "../../integrations/tetu-v1/ITetuV1Controller.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib
contract ConverterStrategyBaseLibFacade {
  function getExpectedWithdrawnAmounts(
    uint[] memory reserves_,
    uint liquidityAmount_,
    uint totalSupply_
  ) external pure returns (
    uint[] memory withdrawnAmountsOut
  ) {
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmounts(reserves_, liquidityAmount_, totalSupply_);
  }

  function getLiquidityAmountRatio(
    uint targetAmount_,
    address strategy_,
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint investedAssets
  ) external returns (
    uint liquidityRatioOut,
    uint[] memory amountsToConvertOut
  ) {
    return ConverterStrategyBaseLib2.getLiquidityAmount(
      targetAmount_,
      strategy_,
      tokens,
      indexAsset,
      converter,
      investedAssets,
      1e18
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
    return ConverterStrategyBaseLib2.getCollaterals(
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
    uint amountIn_,
    uint thresholdMainAsset_
  ) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    return ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData_,
      collateralAsset_,
      borrowAsset_,
      amountIn_,
      thresholdMainAsset_
    );
  }

  function openPositionEntryKind1(
    ITetuConverter tetuConverter_,
    bytes memory entryData_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountIn_,
    uint collateralThreshold_
  ) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    return ConverterStrategyBaseLib.openPositionEntryKind1(
      tetuConverter_,
      entryData_,
      collateralAsset_,
      borrowAsset_,
      amountIn_,
      collateralThreshold_
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
    ITetuConverter converter_,
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
      converter_,
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

  function getAvailableBalances(
    address[] memory tokens_,
    uint indexAsset
  ) external view returns (uint[] memory) {
    return ConverterStrategyBaseLib2.getAvailableBalances(tokens_, indexAsset);
  }

  function calcInvestedAssets(
    address[] memory tokens,
    uint[] memory amountsOut,
    uint indexAsset,
    ITetuConverter converter_
  ) external returns (
    uint amountOut
  ) {
    return ConverterStrategyBaseLib.calcInvestedAssets(
      tokens,
      amountsOut,
      indexAsset,
      converter_
    );
  }

  function sendPerformanceFee(
    uint performanceFee_,
    address performanceReceiver_,
    address splitter,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) external returns (
    uint[] memory rewardAmounts,
    uint[] memory performanceAmounts
  ) {
    return ConverterStrategyBaseLib2.sendPerformanceFee(
      performanceFee_,
      performanceReceiver_,
      splitter,
      rewardTokens_,
      rewardAmounts_
    );
  }

  function swapToGivenAmountAccess(
    uint targetAmount_,
    address[] memory tokens_,
    uint indexTargetAsset_,
    address underlying_,
    uint[] memory withdrawnAmounts_,
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    uint liquidationThresholdForTargetAsset_,
    uint overswap_
  ) external returns (
    uint[] memory spentAmounts,
    uint[] memory withdrawnAmountsOut
  ) {
    return ConverterStrategyBaseLib.swapToGivenAmount(
      targetAmount_,
      tokens_,
      indexTargetAsset_,
      underlying_,
      withdrawnAmounts_,
      converter_,
      liquidator_,
      liquidationThresholdForTargetAsset_,
      overswap_
    );
  }

  function _swapToGivenAmountAccess(ConverterStrategyBaseLib.SwapToGivenAmountInputParams memory p) external returns (
    uint[] memory spentAmounts,
    uint[] memory receivedAmounts
  ) {
    return ConverterStrategyBaseLib._swapToGivenAmount(p);
  }

  function swapToGetAmountAccess(
    uint receivedTargetAmount,
    ConverterStrategyBaseLib.SwapToGivenAmountInputParams memory p,
    ConverterStrategyBaseLib.CalcInvestedAssetsLocal memory v,
    uint indexTokenIn
  ) external returns (
    uint amountSpent,
    uint amountReceived
  ) {
    return ConverterStrategyBaseLib._swapToGetAmount(receivedTargetAmount, p, v, indexTokenIn);
  }

  function convertAfterWithdraw(
    ITetuConverter tetuConverter,
    ITetuLiquidator liquidator,
    uint indexAsset,
    uint liquidationThreshold,
    address[] memory tokens,
    uint[] memory amountsToConvert
  ) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    return ConverterStrategyBaseLib.convertAfterWithdraw(
      tetuConverter,
      liquidator,
      indexAsset,
      liquidationThreshold,
      tokens,
      amountsToConvert
    );
  }

  function closePositionsToGetRequestedAmount(
    ITetuConverter tetuConverter,
    ITetuLiquidator liquidator,
    uint indexAsset,
    uint liquidationThreshold,
    uint requestedAmount,
    address[] memory tokens,
    uint[] memory repaidAmounts_
  ) external returns (
    uint expectedAmountMainAssetOut
  ) {
    return ConverterStrategyBaseLib.closePositionsToGetRequestedAmount(
      tetuConverter,
      liquidator,
      indexAsset,
      liquidationThreshold,
      requestedAmount,
      tokens,
      repaidAmounts_
    );
  }

  function _closePositionUsingMainAsset(
    ITetuConverter tetuConverter,
    ITetuLiquidator liquidator_,
    address asset,
    address token,
    uint toSell,
    uint liquidationThreshold
  ) external returns (
    uint expectedAmountOut
  ) {
    return ConverterStrategyBaseLib._closePositionUsingMainAsset(
      tetuConverter,
      liquidator_,
      asset,
      token,
      toSell,
      liquidationThreshold
    );
  }

  function _getAmountToSell(
    uint remainingRequestedAmount,
    uint totalDebt,
    uint totalCollateral,
    uint[] memory prices,
    uint[] memory decs,
    uint indexCollateral,
    uint indexBorrowAsset
  ) external pure returns (
    uint amountOut
  ) {
    return ConverterStrategyBaseLib._getAmountToSell(
      remainingRequestedAmount,
      totalDebt,
      totalCollateral,
      prices,
      decs,
      indexCollateral,
      indexBorrowAsset
    );
  }
}
