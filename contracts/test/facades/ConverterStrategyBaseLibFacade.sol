// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;


import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib.sol";
import "../../strategies/ConverterStrategyBaseLib2.sol";
import "../../integrations/tetu-v1/ITetuV1Controller.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib and ConverterStrategyBaseLib2
contract ConverterStrategyBaseLibFacade {
  mapping(address => uint) public liquidationThresholds;

  function setLiquidationThreshold(address asset, uint values) external {
    liquidationThresholds[asset] = values;
  }

  function getExpectedWithdrawnAmounts(
    uint[] memory reserves_,
    uint liquidityAmount_,
    uint totalSupply_
  ) external pure returns (
    uint[] memory withdrawnAmountsOut
  ) {
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmounts(reserves_, liquidityAmount_, totalSupply_);
  }

  function getLiquidityAmount(
    uint targetAmount_,
    address strategy_,
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint investedAssets,
    uint depositorLiquidity
  ) external returns (
    uint resultAmount,
    uint[] memory amountsToConvertOut
  ) {
    return ConverterStrategyBaseLib2.getLiquidityAmount(
      targetAmount_,
      strategy_,
      tokens,
      indexAsset,
      converter,
      investedAssets,
      depositorLiquidity
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

  function sendPerformanceFee(address asset_, uint amount_, address splitter, address receiver_, uint ratio) external returns (
    uint toPerf,
    uint toInsurance
  ) {
    return ConverterStrategyBaseLib2.sendPerformanceFee(asset_, amount_, splitter, receiver_, ratio);
  }

  function swapToGivenAmountAccess(
    uint targetAmount_,
    address[] memory tokens_,
    uint indexTargetAsset_,
    address underlying_,
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    uint[] memory liquidationThresholds_,
    uint overswap_
  ) external returns (
    uint[] memory spentAmounts,
    uint[] memory receivedAmounts
  ) {
    return ConverterStrategyBaseLib.swapToGivenAmount(
      targetAmount_,
      tokens_,
      indexTargetAsset_,
      underlying_,
      converter_,
      liquidator_,
      liquidationThresholds_,
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
    uint[] memory liquidationThresholds_,
    address[] memory tokens,
    uint[] memory amountsToConvert
  ) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    return ConverterStrategyBaseLib._convertAfterWithdraw(
      ConverterStrategyBaseLib.DataSetLocal({
        len: tokens.length,
        converter: tetuConverter,
        tokens: tokens,
        indexAsset: indexAsset,
        liquidator: liquidator
      }),
      liquidationThresholds_,
      amountsToConvert
    );
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
  ) external view returns (
    uint amountOut
  ) {
    return ConverterStrategyBaseLib._getAmountToSell(
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

  function registerIncome(uint assetBefore, uint assetAfter) external pure returns (uint earned, uint lost) {
    return ConverterStrategyBaseLib.registerIncome(assetBefore, assetAfter);
  }

  function sendTokensToForwarder(
    address controller_,
    address splitter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) external {
    return ConverterStrategyBaseLib2.sendTokensToForwarder(controller_, splitter_, tokens_, amounts_);
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
    return ConverterStrategyBaseLib.recycle(
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

  function claimConverterRewards(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_,
    uint[] memory balancesBefore
  ) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    return ConverterStrategyBaseLib2.claimConverterRewards(
      tetuConverter_,
      tokens_,
      rewardTokens_,
      rewardAmounts_,
      balancesBefore
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
    return ConverterStrategyBaseLib.getTokenAmounts(
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

  function postWithdrawActions(
    ITetuConverter converter,
    address[] memory tokens,
    uint indexAsset,

    uint[] memory reservesBeforeWithdraw,
    uint liquidityAmountWithdrew,
    uint totalSupplyBeforeWithdraw,

    uint[] memory amountsToConvert,
    uint[] memory withdrawnAmounts
  ) external returns (
    uint[] memory expectedMainAssetAmounts,
    uint[] memory _amountsToConvert
  ) {
    return ConverterStrategyBaseLib.postWithdrawActions(
      converter,
      tokens,
      indexAsset,
      reservesBeforeWithdraw,
      liquidityAmountWithdrew,
      totalSupplyBeforeWithdraw,
      amountsToConvert,
      withdrawnAmounts
    );
  }

  function postWithdrawActionsEmpty(
    ITetuConverter converter,
    address[] memory tokens,
    uint indexAsset,
    uint[] memory amountsToConvert_
  ) external returns (
    uint[] memory expectedAmountsMainAsset
  ) {
    return ConverterStrategyBaseLib.postWithdrawActionsEmpty(converter, tokens, indexAsset, amountsToConvert_);
  }
}
