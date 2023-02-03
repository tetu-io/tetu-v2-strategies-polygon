// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../strategies/ConverterStrategyBase.sol";
import "./MockDepositor.sol";

/// @title Mock Converter Strategy with MockDepositor
/// @author bogdoslav
contract MockConverterStrategy is ConverterStrategyBase, MockDepositor {

  string public constant override NAME = "mock converter strategy";
  string public constant override PLATFORM = "test";
  string public constant override STRATEGY_VERSION = "1.0.0";

  function init(
    address controller_,
    address splitter_,
    address converter_,
    address[] memory depositorTokens_,
    uint[] memory depositorWeights_,
    uint[] memory depositorReserves_
  ) external initializer {

    __MockDepositor_init(
      depositorTokens_,
      depositorWeights_,
      depositorReserves_
    );

    __ConverterStrategyBase_init(
      controller_,
      splitter_,
      converter_
    );
  }

  //////////////////////////////////////////////////////////////////////
  ///    Provide direct access to internal functions for tests
  //////////////////////////////////////////////////////////////////////
  function getExpectedWithdrawnAmountUSDTestAccess(
    address[] memory tokens_,
    uint liquidityAmount_,
    uint totalSupply_,
    address priceOracle_
  ) external view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmountUSD(
      tokens_,
      _depositorPoolReserves(),
      asset,
      liquidityAmount_,
      totalSupply_,
      IPriceOracle(priceOracle_)
    );
  }

  function _updateBaseAmountsAccess(
    address[] memory tokens_,
    uint[] memory receivedAmounts_,
    uint[] memory spentAmounts_,
    uint indexAsset_,
    int amountAsset_
  ) external {
    return _updateBaseAmounts(tokens_, receivedAmounts_, spentAmounts_, indexAsset_, amountAsset_);
  }

  function _updateBaseAmountsForAssetAccesss(address asset_, uint amount_, bool increased_) external {
    return _updateBaseAmountsForAsset(asset_, amount_, increased_);
  }

  function _convertAfterWithdrawAccess(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_
  ) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    return _convertAfterWithdraw(tokens_, indexAsset_, amountsToConvert_);
  }

  function _convertAfterWithdrawAllAccess(
    address[] memory tokens_,
    uint indexAsset_
  ) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    return _convertAfterWithdrawAll(tokens_, indexAsset_);
  }

  function borrowPositionTestAccess(address collateralAsset, uint collateralAmount, address borrowAsset) external returns (
    uint borrowedAmount
  ) {
    return ConverterStrategyBaseLib.borrowPosition(tetuConverter, collateralAsset, collateralAmount, borrowAsset);
  }

  function closePositionTestAccess(address collateralAsset, address borrowAsset, uint amountToRepay) external returns (
    uint returnedAssetAmount,
    uint leftover
  ) {
    return ConverterStrategyBaseLib.closePosition(tetuConverter, collateralAsset, borrowAsset, amountToRepay);
  }

  function updateInvestedAssetsTestAccess() external {
    _updateInvestedAssets();
  }

  function withdrawFromPoolTestAccess(uint amount) external returns (uint investedAssetsUSD, uint assetPrice) {
    return _withdrawFromPool(amount);
  }

  function _withdrawAllFromPoolTestAccess() external returns (uint investedAssetsUSD, uint assetPrice) {
    return _withdrawAllFromPool();
  }

  function depositorLiquidityTestAccess() external view returns (uint) {
    return _depositorLiquidity();
  }

  function _doHardWorkAccess(bool reInvest) external returns (uint earned, uint lost) {
    return _doHardWork(reInvest);
  }

  function _handleRewardsAccess() external virtual returns (uint earned, uint lost) {
    return _handleRewards();
  }

  function _recycleAccess(address[] memory tokens, uint[] memory amounts) external virtual returns(
    uint[] memory receivedAmounts,
    uint[] memory spentAmounts,
    uint assetAmountOut
  ) {
    return _recycle(tokens, amounts);
  }

  function _beforeDepositAccess(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) external returns (
    uint[] memory tokenAmounts,
    uint[] memory borrowedAmounts,
    uint spentCollateral
  ) {
    return _beforeDeposit(tetuConverter_, amount_, tokens_, indexAsset_);
  }

  function setBaseAmountAccess(address token_, uint amount_) external {
    baseAmounts[token_] = amount_;
  }

  function _prepareRewardsListAccess(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) external returns(
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    return _prepareRewardsList(tetuConverter_, tokens_, amounts_);
  }
}
