// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;


import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib
contract ConverterStrategyBaseLibFacade {
  mapping(address => uint) private liquidationThresholds;

  function setLiquidationThreshold(address asset, uint values) external {
    liquidationThresholds[asset] = values;
  }

  function getCollaterals(
    uint amount_,
    address[] memory tokens_,
    uint[] memory weights_,
    uint totalWeight_,
    uint indexAsset_,
    IPriceOracle priceOracle
  ) external view returns (uint[] memory tokenAmountsOut) {
    return ConverterStrategyBaseLib._getCollaterals(
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
    uint rewardLiquidationThresholdForTokenIn,
    bool skipValidation
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
      rewardLiquidationThresholdForTokenIn,
      skipValidation
    );
  }

  function sendPerformanceFee(address asset_, uint amount_, address splitter, address receiver_, uint ratio) external returns (
    uint toPerf,
    uint toInsurance
  ) {
    return ConverterStrategyBaseLib._sendPerformanceFee(asset_, amount_, splitter, receiver_, ratio);
  }

  function closePositionsToGetAmount(
    ITetuConverter tetuConverter,
    ITetuLiquidator liquidator,
    uint indexAsset,
    uint requestedAmount,
    address[] memory tokens
  ) external returns (
    uint expectedAmountMainAssetOut
  ) {
    return ConverterStrategyBaseLib.closePositionsToGetAmount(
      tetuConverter,
      liquidator,
      indexAsset,
      liquidationThresholds,
      requestedAmount,
      tokens
    );
  }

  function _getAmountToSell(
    uint remainingRequestedAmount,
    uint totalDebt,
    uint totalCollateral,
    uint[] memory prices,
    uint[] memory decs,
    uint indexCollateral,
    uint indexBorrowAsset,
    uint balanceBorrowAsset
  ) external pure returns (
    uint amountOut
  ) {
    return IterationPlanLib._getAmountToSell(
      remainingRequestedAmount,
      totalDebt,
      totalCollateral,
      prices,
      decs,
      indexCollateral,
      indexBorrowAsset,
      balanceBorrowAsset
    );
  }

  function sendTokensToForwarder(
    address controller_,
    address splitter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) external {
    return ConverterStrategyBaseLib._sendTokensToForwarder(controller_, splitter_, tokens_, amounts_);
  }

  function recycle(
    ITetuConverter converter_,
    address asset,
    uint compoundRatio,
    address[] memory tokens,
    ITetuLiquidator liquidator,
    address[] memory rewardTokens,
    uint[] memory rewardAmounts,
    uint performanceFee
  ) external returns (
    uint[] memory amountsToForward,
    uint amountToPerformanceAndInsurance
  ) {
    return ConverterStrategyBaseLib._recycle(
      converter_,
      asset,
      compoundRatio,
      tokens,
      liquidator,
      liquidationThresholds,
      rewardTokens,
      rewardAmounts,
      performanceFee
    );
  }

  function getTokenAmounts(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory collaterals_,
    uint thresholdMainAsset_
  ) external returns (
    uint[] memory tokenAmountsOut
  ) {
    return ConverterStrategyBaseLib._getTokenAmounts(
      tetuConverter_,
      tokens_,
      indexAsset_,
      collaterals_,
      thresholdMainAsset_
    );
  }

  function _closePositionExact(
    ITetuConverter converter_,
    address collateralAsset,
    address borrowAsset,
    uint amountRepay,
    uint balanceBorrowAsset
  ) external returns (
    uint collateralOut,
    uint repaidAmountOut
  ) {
    return ConverterStrategyBaseLib._closePositionExact(
      converter_,
      collateralAsset,
      borrowAsset,
      amountRepay,
      balanceBorrowAsset
    );
  }

  function _closePosition(
    ITetuConverter converter_,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) external returns (
    uint returnedAssetAmountOut,
    uint repaidAmountOut
  ) {
    return ConverterStrategyBaseLib._closePosition(converter_, collateralAsset, borrowAsset, amountToRepay);
  }


  function _makeRequestedAmountAccess(
    address[] memory tokens_,
    uint indexAsset_,
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    uint requestedAmount
  ) external returns (
    uint expectedTotalAmountMainAsset
  ) {
    return ConverterStrategyBaseLib.makeRequestedAmount(
      tokens_,
      indexAsset_,
      converter_,
      liquidator_,
      requestedAmount,
      liquidationThresholds
    );
  }
}
