// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuVaultV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "../../strategies/ConverterStrategyBase.sol";
import "./MockDepositor.sol";

/// @title Mock Converter Strategy with MockDepositor
/// @author bogdoslav
contract MockConverterStrategy is ConverterStrategyBase, MockDepositor {

  string public constant override NAME = "mock converter strategy";
  string public constant override PLATFORM = "test";
  string public constant override STRATEGY_VERSION = "1.0.0";

  //region ------------------------------------------------------- init

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

  function setInvestedAssets(uint investedAssets_) external {
    _csbs.investedAssets = investedAssets_;
  }
  //endregion ------------------------------------------------------- init

  //region ------------------------------------------------------- direct access to internal functions for tests
  function closePositionTestAccess(address collateralAsset, address borrowAsset, uint amountToRepay) external returns (
    uint returnedAssetAmount,
    uint leftover
  ) {
    return ConverterStrategyBaseLib.closePosition(_csbs.converter, collateralAsset, borrowAsset, amountToRepay);
  }

  function updateInvestedAssetsTestAccess() external {
    _updateInvestedAssets();
  }

  function _doHardWorkAccess(bool reInvest) external returns (uint earned, uint lost) {
    return _doHardWork(reInvest);
  }
  //endregion ------------------------------------------------------- direct access to internal functions for tests

  //region ------------------------------------------------------- Withdraw universal
  struct MockedWithdrawUniversalParams {
    // auxiliary params
    bool initialized;
    address assetProvider;
    uint assetAmountToGetFromProvider;

    // input params
    uint amount;
    uint earnedByPrices;
    uint investedAssets;

    // output params
    uint expectedWithdrewUSD;
    uint assetPrice;
    uint strategyLoss;
    uint amountSentToInsurance;
  }

  mapping(bytes32 => MockedWithdrawUniversalParams) internal _mockedWithdrawParams;

  function setUpMockedWithdrawUniversal(
  // auxiliary params
    address assetProvider_,
    uint assetAmountToGetFromProvider_,
  // input params
    uint amount,
    uint earnedByPrices_,
    uint investedAssets_,
  // output params
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss,
    uint amountSentToInsurance
  ) external {
    bytes32 key = keccak256(abi.encodePacked(amount, earnedByPrices_, investedAssets_));
    _mockedWithdrawParams[key] = MockedWithdrawUniversalParams({
      initialized: true,
      assetProvider: assetProvider_,
      assetAmountToGetFromProvider: assetAmountToGetFromProvider_,

      amount: amount,
      earnedByPrices: earnedByPrices_,
      investedAssets: investedAssets_,

      expectedWithdrewUSD: expectedWithdrewUSD,
      assetPrice: assetPrice,
      strategyLoss: strategyLoss,
      amountSentToInsurance: amountSentToInsurance
    });
  }

  /// @notice Direct access to internal _withdrawUniversal
  function withdrawUniversalTestAccess(uint amount, bool all, uint earnedByPrices_, uint investedAssets_) external returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss,
    uint amountSentToInsurance
  ) {
    return _withdrawUniversal(all ? type(uint).max : amount, earnedByPrices_, investedAssets_);
  }

  /// @notice Call original OR mocked version of _withdrawUniversal
  function _withdrawUniversal(uint amount, uint earnedByPrices_, uint investedAssets_) override internal returns (
    uint expectedWithdrewUSD,
    uint __assetPrice,
    uint strategyLoss,
    uint amountSentToInsurance
  ) {
    bytes32 key = keccak256(abi.encodePacked(amount, earnedByPrices_, investedAssets_));
    MockedWithdrawUniversalParams memory data = _mockedWithdrawParams[key];

    if (data.initialized) {
      if (data.assetProvider != address(0)) {
        // get asset from the asset provider to balance
        IERC20(baseState.asset).transferFrom(
          data.assetProvider,
          address(this),
          data.assetAmountToGetFromProvider
        );
      }
      if (data.amountSentToInsurance != 0) {
        address insurance = address(ITetuVaultV2(ISplitter(baseState.splitter).vault()).insurance());
        IERC20(baseState.asset).transfer(insurance, data.amountSentToInsurance);
      }

      return (
        data.expectedWithdrewUSD,
        data.assetPrice,
        data.strategyLoss,
        data.amountSentToInsurance
      );
    } else {
      return super._withdrawUniversal(amount, earnedByPrices_, investedAssets_);
    }
  }
  //endregion ------------------------------------------------------- Withdraw universal

  //region--------------------------------------- _handleRewards, mocked version + accessor
  function _handleRewards() internal override returns (uint earned, uint lost, uint assetBalanceAfterClaim, uint paidDebtToInsurance, uint amountPerf) {
    address asset = baseState.asset;
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
      return (handleRewardsParams.earned, handleRewardsParams.lost, AppLib.balance(asset), handleRewardsParams.paidDebtToInsurance, amountPerf);
    } else {
      return __handleRewardsImpl();
    }
  }

  function __handleRewardsImpl() internal returns (
    uint earned,
    uint lost,
    uint assetBalanceAfterClaim,
    uint paidDebtToInsurance,
    uint amountPerf
  ) {
    address asset = baseState.asset;
    uint assetBalanceBefore = AppLib.balance(asset);
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    (paidDebtToInsurance, amountPerf) = _rewardsLiquidation(rewardTokens, amounts);
    assetBalanceAfterClaim = AppLib.balance(asset);
    (uint earned2, uint lost2) = ConverterStrategyBaseLib2._registerIncome(assetBalanceBefore, assetBalanceAfterClaim);
    return (earned + earned2, lost + lost2, assetBalanceAfterClaim, paidDebtToInsurance, amountPerf);
  }

  struct MockedHandleRewardsParams {
    bool initialized;
    uint earned;
    uint lost;
    int assetBalanceChange;
    address providerBalanceChange;
    uint paidDebtToInsurance;
  }

  MockedHandleRewardsParams private handleRewardsParams;

  function setMockedHandleRewardsResults(
    uint earned,
    uint lost,
    int assetBalanceChange,
    address providerBalanceChange,
    uint paidDebtToInsurance
  ) external {
    handleRewardsParams = MockedHandleRewardsParams({
      initialized: true,
      earned: earned,
      lost: lost,
      assetBalanceChange: assetBalanceChange,
      providerBalanceChange: providerBalanceChange,
      paidDebtToInsurance: paidDebtToInsurance
    });
  }
  //endregion--------------------------------------- _handleRewards, mocked version + accessor

  //region -------------------------------------------- _depositToPoolUni mock
  struct MockedDepositToPoolUniParams {
    bool initialized;
    int balanceChange;
    address providerBalanceChange;
    uint loss;
    uint amountSentToInsurance;
  }

  MockedDepositToPoolUniParams internal depositToPoolParams;

  function _depositToPoolAccess(uint amount_, bool updateTotalAssetsBeforeInvest_) external returns (
    uint loss
  ) {
    return _depositToPool(amount_, updateTotalAssetsBeforeInvest_);
  }


  function depositToPoolUniAccess(
    uint amount_,
    uint earnedByPrices_,
    uint investedAssets_
  ) external returns (
    uint strategyLoss,
    uint amountSentToInsurance,
    uint investedAssetsAfter,
    uint balanceAfter
  ) {
    return _depositToPoolUniversal(amount_, earnedByPrices_, investedAssets_);
  }

  function _depositToPoolUniversal(
    uint amount_,
    uint earnedByPrices_,
    uint investedAssets_
  ) override internal virtual returns (
    uint strategyLoss,
    uint amountSentToInsurance,
    uint investedAssetsAfter,
    uint balanceAfter
  ) {
    address asset = baseState.asset;
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
      return (depositToPoolParams.loss, depositToPoolParams.amountSentToInsurance, _csbs.investedAssets, AppLib.balance(asset));
    } else {
      return super._depositToPoolUniversal(amount_, earnedByPrices_, investedAssets_);
    }
  }

  function setMockedDepositToPoolUni(
    int balanceChange,
    address providerBalanceChange,
    uint loss,
    uint amountSentToInsurance
  ) external {
    depositToPoolParams = MockedDepositToPoolUniParams({
      initialized: true,
      balanceChange: balanceChange,
      providerBalanceChange: providerBalanceChange,
      loss: loss,
      amountSentToInsurance: amountSentToInsurance
    });
  }
  //endregion -------------------------------------------- _depositToPoolUni mock

  //region ---------------------------------------- _beforeDeposit
  struct BeforeDepositParams {
    uint amount;
    uint indexAsset;
    uint[] tokenAmounts;
  }

  mapping(bytes32 => BeforeDepositParams) internal _beforeDepositParams;

  function setBeforeDeposit(uint amount_, uint indexAsset_, uint[] memory tokenAmounts) external {
    bytes32 key = keccak256(abi.encodePacked(amount_, indexAsset_));
    _beforeDepositParams[key] = BeforeDepositParams({
      amount: amount_,
      indexAsset: indexAsset_,
      tokenAmounts: tokenAmounts
    });
  }

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) internal override returns (
    uint[] memory tokenAmounts
  ) {
    bytes32 key = keccak256(abi.encodePacked(amount_, indexAsset_));
    if (_beforeDepositParams[key].amount == amount_) {
      return _beforeDepositParams[key].tokenAmounts;
    } else {
      return super._beforeDeposit(tetuConverter_, amount_, tokens_, indexAsset_);
    }
  }

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
  //endregion ---------------------------------------- _beforeDeposit

  //region ----------------------------------------------------- makeRequestedAmount

  struct MakeRequestedAmountParams {
    bool useMockedValues;
    address asset;
    address assetProvider;
    int amountToPutOnBalance;
    uint expectedTotalAssetAmountOut;
  }

  MakeRequestedAmountParams private _makeRequestedAmountParams;

  function setMakeRequestedAmountParams(
    address asset,
    address assetProvider,
    int amountToPutOnBalance,
    uint expectedTotalAssetAmountOut
  ) external {
    _makeRequestedAmountParams = MakeRequestedAmountParams({
      useMockedValues: true,
      asset: asset,
      assetProvider: assetProvider,
      amountToPutOnBalance: amountToPutOnBalance,
      expectedTotalAssetAmountOut: expectedTotalAssetAmountOut
    });
  }

  function _makeRequestedAmount(uint amount_, WithdrawUniversalLocal memory v) internal override returns (
    uint expectedTotalAssetAmount
  ) {
    if (_makeRequestedAmountParams.useMockedValues) {
      if (_makeRequestedAmountParams.amountToPutOnBalance >= 0) { // add amount on strategy balance
        IERC20(_makeRequestedAmountParams.asset).transferFrom(_makeRequestedAmountParams.assetProvider, address(this), uint(_makeRequestedAmountParams.amountToPutOnBalance));
      } else { // reduce strategy balance
        IERC20(_makeRequestedAmountParams.asset).transfer(_makeRequestedAmountParams.assetProvider, uint(-_makeRequestedAmountParams.amountToPutOnBalance));
      }
      return _makeRequestedAmountParams.expectedTotalAssetAmountOut;
    } else {
      return super._makeRequestedAmount(amount_, v);
    }
  }

  function _makeRequestedAmountAccess(uint amount_, WithdrawUniversalLocal memory v) external returns (
    uint expectedTotalAssetAmount
  ) {
    return _makeRequestedAmount(amount_, v);
  }
  //endregion ----------------------------------------------------- makeRequestedAmount

  //region ----------------------------------------------------- Others
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

  function recycleAccess(address[] memory tokens, uint[] memory amounts) external {
    ConverterStrategyBaseLib.recycle(
      baseState,
      _csbs,
      _depositorPoolAssets(),
      controller(),
      liquidationThresholds,
      tokens,
      amounts
    );
  }

  //endregion ----------------------------------------------------- Others

  function _getTokensAccess(address asset_) external view returns (address[] memory tokens, uint indexAsset) {
    return _getTokens(asset_);
  }

}
