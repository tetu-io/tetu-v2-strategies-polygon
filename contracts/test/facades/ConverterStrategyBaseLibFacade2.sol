// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;


import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../../strategies/ConverterStrategyBaseLib2.sol";

/// @notice Provide public access to internal functions of ConverterStrategyBaseLib2
contract ConverterStrategyBaseLibFacade2 {
  mapping(address => uint) private liquidationThresholds;
  IStrategyV3.BaseState private baseState;
  IConverterStrategyBase.ConverterStrategyBaseState private _csbs;

  function setLiquidationThreshold(address asset, uint values) external {
    liquidationThresholds[asset] = values;
  }

  function setCsbs(
    uint investedAssets,
    ITetuConverter converter,
    uint reinvestThresholdPercent,
    int debtToInsurance
  ) external {
    _csbs.investedAssets = investedAssets;
    _csbs.converter = converter;
    _csbs.reinvestThresholdPercent = reinvestThresholdPercent;
    _csbs.debtToInsurance = debtToInsurance;
  }

  function getCsb() external view returns (IConverterStrategyBase.ConverterStrategyBaseState memory) {
    return _csbs;
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
    uint[] memory assetsInPool,
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
      assetsInPool,
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
    ITetuConverter converter_,
    bool makeCheckout_
  ) external returns (
    uint amountOut,
    uint[] memory prices,
    uint[] memory decs
  ) {
    return ConverterStrategyBaseLib2.calcInvestedAssets(tokens, amountsOut, indexAsset, converter_, makeCheckout_);
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
    return ConverterStrategyBaseLib2.sendToInsurance(
      asset,
      amount,
      splitter,
      strategyBalance,
      IERC20(asset).balanceOf(address(this))
    );
  }

  function getSafeLossToCover(uint loss, uint totalAssets_) external pure returns (
    uint lossToCover,
    uint lossUncovered
  ) {
    return ConverterStrategyBaseLib2._getSafeLossToCover(loss, totalAssets_);
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

  function getOracleAssetsPrice(ITetuConverter converter, address tokenA, address tokenB) external view returns (
    uint price
  ) {
    return ConverterStrategyBaseLib2.getOracleAssetsPrice(converter, tokenA, tokenB);
  }

  function coverLossAfterPriceChanging(
    uint investedAssetsBefore,
    uint investedAssetsAfter,
    int increaseToDebt,
    address asset,
    address splitter
  ) external returns (uint earned) {
    baseState.asset = asset;
    baseState.splitter = splitter;
    return ConverterStrategyBaseLib2.coverLossAfterPriceChanging(
      _csbs,
      investedAssetsBefore,
      investedAssetsAfter,
      increaseToDebt,
      baseState
    );
  }

  function _coverLossAndCheckResults(address splitter, uint lossToCover, int debtToInsuranceInc) external {
    ConverterStrategyBaseLib2._coverLossAndCheckResults(_csbs, splitter, lossToCover, debtToInsuranceInc);
  }

  function sendProfitGetAssetBalance(
    address theAsset_,
    uint balanceTheAsset_,
    uint investedAssets_,
    uint earnedByPrices_
  ) external returns (
    uint balanceTheAssetOut
  ) {
    return ConverterStrategyBaseLib2.sendProfitGetAssetBalance(theAsset_, balanceTheAsset_, investedAssets_, earnedByPrices_, baseState);
  }
}
