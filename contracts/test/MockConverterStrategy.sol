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
  function _updateBaseAmountsAccess(
    address[] memory tokens_,
    uint[] memory receivedAmounts_,
    uint[] memory spentAmounts_,
    uint indexAsset_,
    int amountAsset_
  ) external {
    return _updateBaseAmounts(tokens_, receivedAmounts_, spentAmounts_, indexAsset_, amountAsset_);
  }

  function _convertAfterWithdrawAccess(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_
  ) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    return ConverterStrategyBaseLib.convertAfterWithdraw(
      converter,
      ITetuLiquidator(IController(controller()).liquidator()),
      liquidationThresholds[tokens_[indexAsset_]],
      tokens_,
      indexAsset_,
      amountsToConvert_
    );
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

  function closePositionTestAccess(address collateralAsset, address borrowAsset, uint amountToRepay) external returns (
    uint returnedAssetAmount,
    uint leftover
  ) {
    return ConverterStrategyBaseLib.closePosition(converter, collateralAsset, borrowAsset, amountToRepay);
  }

  function updateInvestedAssetsTestAccess() external {
    _updateInvestedAssets();
  }

  function withdrawUniversalTestAccess(uint amount, bool all, uint investedAssets_) external returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    return _withdrawUniversal(amount, all, investedAssets_);
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
      return (handleRewardsParams.earned, handleRewardsParams.lost, _balance(asset));
    } else {
      return super._handleRewards();
    }
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
    int totalAssetsDelta;
  }

  MockedDepositToPoolParams internal depositToPoolParams;

  function _depositToPoolAccess(uint amount_, bool updateTotalAssetsBeforeInvest_) external returns (
    int totalAssetsDelta
  ) {
    return _depositToPool(amount_, updateTotalAssetsBeforeInvest_);
  }

  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    int totalAssetsDelta
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
      totalAssetsDelta = depositToPoolParams.totalAssetsDelta;
    } else {
      totalAssetsDelta = super._depositToPool(amount_, updateTotalAssetsBeforeInvest_);
    }
  }

  function setMockedDepositToPool(int balanceChange, address providerBalanceChange, int totalAssetsDelta_) external {
    depositToPoolParams = MockedDepositToPoolParams({
    initialized : true,
    balanceChange : balanceChange,
    providerBalanceChange : providerBalanceChange,
    totalAssetsDelta : totalAssetsDelta_
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
    uint[] memory tokenAmounts,
    uint[] memory borrowedAmounts,
    uint spentCollateral
  ) {
    return _beforeDeposit(
      tetuConverter_,
      amount_,
      tokens_,
      indexAsset_
    );
  }

  function setBaseAmountAccess(address token_, uint amount_) external {
    baseAmounts[token_] = amount_;
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
    return ConverterStrategyBaseLib.prepareRewardsList(tetuConverter_, tokens_, rewardTokens_, rewardAmounts_, baseAmounts);
  }

  function _recycleAccess(address[] memory tokens, uint[] memory amounts) external returns (
    uint[] memory receivedAmounts,
    uint[] memory spentAmounts,
    uint[] memory amountsToForward
  ) {
    return _recycle(tokens, amounts);
  }
}
