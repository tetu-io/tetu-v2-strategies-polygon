// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../strategies/ConverterStrategyBase.sol";
import "./mocks/MockDepositor.sol";

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

  function init2(address controller_, address splitter_, address converter_) external {
    __ConverterStrategyBase_init(
      controller_,
      splitter_,
      converter_
    );
  }
  //////////////////////////////////////////////////////////////////////
  ///    Provide direct access to internal functions for tests
  //////////////////////////////////////////////////////////////////////
  function closePositionTestAccess(address collateralAsset, address borrowAsset, uint amountToRepay) external returns (
    uint returnedAssetAmount,
    uint leftover
  ) {
    return ConverterStrategyBaseLib.closePosition(converter, collateralAsset, borrowAsset, amountToRepay);
  }

  function updateInvestedAssetsTestAccess() external {
    _updateInvestedAssets();
  }

  function withdrawUniversalTestAccess(uint amount, bool all, uint earnedByPrices_, uint investedAssets_) external returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss,
    uint amountSentToInsurance
  ) {
    return _withdrawUniversal(all ? type(uint).max : amount, earnedByPrices_, investedAssets_);
  }

  function _doHardWorkAccess(bool reInvest) external returns (uint earned, uint lost) {
    return _doHardWork(reInvest);
  }

  /////////////////////////////////////////////////////////////////////////////////////
  /// _handleRewards, mocked version + accessor
  /////////////////////////////////////////////////////////////////////////////////////
  function _handleRewards() internal override returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    if (handleRewardsParams.initialized) {
      //      console.log("_handleRewards.mocked-version is called");
      if (handleRewardsParams.assetBalanceChange > 0) {
        IERC20(asset).transferFrom(
          handleRewardsParams.providerBalanceChange,
          address(this),
          uint(handleRewardsParams.assetBalanceChange)
        );
      } else if (handleRewardsParams.assetBalanceChange < 0) {
        IERC20(asset).transfer(
          handleRewardsParams.providerBalanceChange,
          uint(- handleRewardsParams.assetBalanceChange)
        );
      }
      return (handleRewardsParams.earned, handleRewardsParams.lost, AppLib.balance(asset));
    } else {
      return __handleRewards();
    }
  }

  function __handleRewards() internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    uint assetBalanceBefore = AppLib.balance(asset);
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    _rewardsLiquidation(rewardTokens, amounts);
    assetBalanceAfterClaim = AppLib.balance(asset);
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetBalanceBefore, assetBalanceAfterClaim, earned, lost);
    return (earned, lost, assetBalanceAfterClaim);
  }

  struct MockedHandleRewardsParams {
    bool initialized;
    uint earned;
    uint lost;
    int assetBalanceChange;
    address providerBalanceChange;
  }

  MockedHandleRewardsParams private handleRewardsParams;

  function setMockedHandleRewardsResults(
    uint earned,
    uint lost,
    int assetBalanceChange,
    address providerBalanceChange
  ) external {
    handleRewardsParams = MockedHandleRewardsParams({
      initialized: true,
      earned: earned,
      lost: lost,
      assetBalanceChange: assetBalanceChange,
      providerBalanceChange: providerBalanceChange
    });
  }

  /////////////////////////////////////////////////////////////////////////////////////
  /// _depositToPool mock
  /////////////////////////////////////////////////////////////////////////////////////
  struct MockedDepositToPoolParams {
    bool initialized;
    int balanceChange;
    address providerBalanceChange;
    uint loss;
  }

  MockedDepositToPoolParams internal depositToPoolParams;

  function _depositToPoolAccess(uint amount_, bool updateTotalAssetsBeforeInvest_) external returns (
    uint loss
  ) {
    return _depositToPool(amount_, updateTotalAssetsBeforeInvest_);
  }

  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    uint loss
  ){
    if (depositToPoolParams.initialized) {
      //      console.log("_depositToPool.mocked-version is called");
      if (depositToPoolParams.balanceChange > 0) {
        IERC20(asset).transferFrom(
          depositToPoolParams.providerBalanceChange,
          address(this),
          uint(depositToPoolParams.balanceChange)
        );
      } else if (depositToPoolParams.balanceChange < 0) {
        IERC20(asset).transfer(
          depositToPoolParams.providerBalanceChange,
          uint(- depositToPoolParams.balanceChange)
        );
      }
      loss = depositToPoolParams.loss;
    } else {
      loss = super._depositToPool(amount_, updateTotalAssetsBeforeInvest_);
    }
  }

  function setMockedDepositToPool(int balanceChange, address providerBalanceChange, uint loss) external {
    depositToPoolParams = MockedDepositToPoolParams({
      initialized: true,
      balanceChange: balanceChange,
      providerBalanceChange: providerBalanceChange,
      loss: loss
    });
  }

  /////////////////////////////////////////////////////////////////////////////////////
  /// Others
  /////////////////////////////////////////////////////////////////////////////////////

  function _beforeDepositAccess(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    return _beforeDeposit(
      tetuConverter_,
      amount_,
      tokens_,
      indexAsset_
    );
  }

  function _emergencyExitFromPoolAccess() external {
    _emergencyExitFromPool();
  }

  function _prepareRewardsListAccess(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    return ConverterStrategyBaseLib2.claimConverterRewards(tetuConverter_, tokens_, rewardTokens_, rewardAmounts_, new uint[](0));
  }

  function _recycleAccess(address[] memory tokens, uint[] memory amounts) external returns (
    uint[] memory amountsToForward
  ) {
    return _recycle(tokens, amounts);
  }

  function _makeRequestedAmountAccess(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_,
    ITetuConverter converter_,
    uint requestedAmount,
    uint[] memory expectedMainAssetAmounts
  ) external returns (
    uint expectedTotalAmountMainAsset
  ) {
    return _makeRequestedAmount(tokens_, indexAsset_, amountsToConvert_, converter_, requestedAmount, expectedMainAssetAmounts);
  }
}
