// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;


import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib2.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib2
contract ConverterStrategyBaseLibFacade2 {
  mapping(address => uint) private liquidationThresholds;
  IStrategyV3.BaseState private baseState;

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
    return ConverterStrategyBaseLib2.getExpectedWithdrawnAmounts(reserves_, liquidityAmount_, totalSupply_);
  }

  function getLiquidityAmount(
    uint targetAmount_,
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint investedAssets,
    uint depositorLiquidity,
    uint indexUnderlying
  ) external view returns (
    uint resultAmount
  ) {
    return ConverterStrategyBaseLib2.getLiquidityAmount(
      targetAmount_,
      tokens,
      indexAsset,
      converter,
      investedAssets,
      depositorLiquidity,
      indexUnderlying
    );
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
    return ConverterStrategyBaseLib2.calcInvestedAssets(tokens, amountsOut, indexAsset, converter_);
  }

  function registerIncome(uint assetBefore, uint assetAfter) external pure returns (uint earned, uint lost) {
    return ConverterStrategyBaseLib2._registerIncome(assetBefore, assetAfter);
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
    return ConverterStrategyBaseLib2.postWithdrawActions(
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
    return ConverterStrategyBaseLib2.postWithdrawActionsEmpty(converter, tokens, indexAsset, amountsToConvert_);
  }

  function sendToInsurance(address asset, uint amount, address splitter, uint strategyBalance) external returns (
    uint sentAmount,
    uint unsentAmount
  ) {
    return ConverterStrategyBaseLib2.sendToInsurance(asset, amount, splitter, strategyBalance);
  }

  function getSafeLossToCover(uint loss, uint totalAssets_) external pure returns (
    uint lossToCover,
    uint lossUncovered
  ) {
    return ConverterStrategyBaseLib2.getSafeLossToCover(loss, totalAssets_);
  }

  function setBaseState(
    address asset,
    address splitter,
    address performanceReceiver,
    uint performanceFee,
    uint performanceFeeRatio,
    uint compoundRatio,
    string memory strategySpecificName
  ) external {
    baseState.asset = asset;
    baseState.splitter = splitter;
    baseState.performanceFee = performanceFee;
    baseState.performanceReceiver = performanceReceiver;
    baseState.performanceFeeRatio = performanceFeeRatio;
    baseState.compoundRatio = compoundRatio;
    baseState.strategySpecificName = strategySpecificName;
  }

  function getHardworkLossToleranceValue() external pure returns (uint) {
    return ConverterStrategyBaseLib2.HARDWORK_LOSS_TOLERANCE;
  }

  function findZeroAmount(uint[] memory amounts_) external pure returns (bool) {
    return ConverterStrategyBaseLib2.findZeroAmount(amounts_);
  }

  function getTokenAmountsPair(
    ITetuConverter converter,
    uint totalAssets,
    address tokenA,
    address tokenB,
    uint[2] calldata liquidationThresholdsAB
  ) external returns (
    uint loss,
    uint[] memory tokenAmounts
  ) {
    return ConverterStrategyBaseLib2.getTokenAmountsPair(converter, totalAssets, tokenA, tokenB, liquidationThresholdsAB);
  }

  function getOracleAssetsPrices(ITetuConverter converter, address tokenA, address tokenB) external view returns (
    uint priceA,
    uint priceB
  ) {
    return ConverterStrategyBaseLib2.getOracleAssetsPrices(converter, tokenA, tokenB);
  }

  function coverLossAfterPriceChanging(
    uint investedAssetsBefore,
    uint investedAssetsAfter,
    address asset,
    address splitter
  ) external returns (uint earned) {
    baseState.asset = asset;
    baseState.splitter = splitter;
    return ConverterStrategyBaseLib2.coverLossAfterPriceChanging(
      investedAssetsBefore,
      investedAssetsAfter,
      baseState
    );
  }

  function _coverLossAndCheckResults(address splitter, uint earned, uint lossToCover) external {
    ConverterStrategyBaseLib2._coverLossAndCheckResults(splitter, earned, lossToCover);
  }
}
