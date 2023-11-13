// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IAccountant.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV3.sol";
import "../strategies/ConverterStrategyBaseLib2.sol";
import "../strategies/pair/PairBasedStrategyLogicLib.sol";


library BookkeeperLib {
  //region ------------------------------------------------------- Events
  /// @notice Increase to debts between new and previous checkout
  /// @param tokens List of possible collateral/borrow assets. One of the is unerlying.
  /// @param deltaGains Amounts by which the debt has reduced (supply profit) [sync with {tokens}]
  /// @param deltaLosses Amounts by which the debt has increased (increase of amount-to-pay) [sync with {tokens}]
  /// @param prices Prices of the {tokens}
  event IncreaseToDebt(
    address[] tokens,
    uint[] deltaGains,
    uint[] deltaLosses,
    uint[] prices
  );

  event FixPriceChanges(
    uint investedAssetsBefore,
    uint investedAssetsOut,
    int increaseToDebt
  );

  event CoverLoss(uint loss);

  /// @notice Compensation of losses is not carried out completely because loss amount exceeds allowed max
  event UncoveredLoss(uint lossCovered, uint lossUncovered, uint investedAssetsBefore, uint investedAssetsAfter);

  /// @notice Insurance balance were not enough to cover the loss, {lossUncovered} was uncovered
  event NotEnoughInsurance(uint lossUncovered);
  //endregion ------------------------------------------------------- Events

  //region ------------------------------------------------------- Bookkeeper logic
  /// @param tokens Full list of tokens that can be used as collateral/borrow asset by the current strategy
  /// @param indexAsset Index of the underlying in {tokens}
  /// @return increaseToDebt Total increase-to-debt since previous checkpoint [in underlying]
  function getIncreaseToDebt(
    address[] memory tokens,
    uint indexAsset,
    uint[] memory prices,
    uint[] memory decs,
    ITetuConverter converter
  ) internal returns (
    int increaseToDebt
  ) {
    IAccountant a = IAccountant(IConverterController(converter.controller()).accountant());
    (uint[] memory deltaGains, uint[] memory deltaLosses) = a.checkpoint(tokens);

    uint len = tokens.length;
    for (uint i; i < len; ++i) {
      if (i == indexAsset) {
        increaseToDebt -= int(deltaGains[i]);
        increaseToDebt += int(deltaLosses[i]);
      } else {
        increaseToDebt += (int(deltaLosses[i]) - int(deltaGains[i]))
          * int(prices[i]) * int(decs[indexAsset]) / int(prices[indexAsset]) / int(decs[i]);
      }
    }
    emit IncreaseToDebt(tokens, deltaGains, deltaLosses, prices);

    return increaseToDebt;
  }

  /// @notice Register income and cover possible loss after price changing, emit FixPriceChanges
  /// @param investedAssetsBefore Currently stored value of _csbs.investedAssets
  /// @param investedAssetsAfter Actual value of invested assets calculated at the current moment
  /// @param increaseToDebt The amount by which the total loan debts increased for the selected period
  /// @return earned Amount earned because of price changing
  function coverLossAfterPriceChanging(
    IConverterStrategyBase.ConverterStrategyBaseState storage csbs,
    uint investedAssetsBefore,
    uint investedAssetsAfter,
    int increaseToDebt,
    IStrategyV3.BaseState storage baseState
  ) internal returns (uint earned) {

    uint lost;
    if (investedAssetsAfter > investedAssetsBefore) {
      earned = investedAssetsAfter - investedAssetsBefore;
    } else {
      lost = investedAssetsBefore - investedAssetsAfter;
    }

    int earnedByPrice = int(investedAssetsAfter) - int(investedAssetsBefore) - increaseToDebt;
    int debtToInsuranceInc = 0; // todo

    if (lost != 0) {
      (uint lossToCover, uint lossUncovered) = getSafeLossToCover(
        lost,
        investedAssetsAfter + IERC20(baseState.asset).balanceOf(address(this)) // totalAssets
      );
      _coverLossAndCheckResults(csbs, baseState.splitter, lossToCover, debtToInsuranceInc);

      if (lossUncovered != 0) {
        emit UncoveredLoss(lossToCover, lossUncovered, investedAssetsBefore, investedAssetsAfter);
      }
    }

    emit FixPriceChanges(investedAssetsBefore, investedAssetsAfter, increaseToDebt);
    return earned;
  }


  /// @notice Call coverPossibleStrategyLoss, covered loss will be sent to vault.
  ///         If the loss were covered only partially, emit {NotEnoughInsurance}
  function coverLossAndCheckResults(
    IConverterStrategyBase.ConverterStrategyBaseState storage csbs,
    address splitter,
    uint lossToCover
  ) internal {
    _coverLossAndCheckResults(csbs, splitter, lossToCover, lossToCover);
  }

  /// @notice Call coverPossibleStrategyLoss, covered loss will be sent to vault.
  ///         If the loss were covered only partially, emit {NotEnoughInsurance}
  function _coverLossAndCheckResults(
    IConverterStrategyBase.ConverterStrategyBaseState storage csbs,
    address splitter,
    uint lossToCover,
    int debtToInsuranceInc
  ) internal {
    address asset = ISplitter(splitter).asset();
    address vault = ISplitter(splitter).vault();

    uint balanceBefore = IERC20(asset).balanceOf(vault);
    ISplitter(splitter).coverPossibleStrategyLoss(0, lossToCover);
    uint balanceAfter = IERC20(asset).balanceOf(vault);

    csbs.debtToInsurance += debtToInsuranceInc;

    uint delta = balanceAfter > balanceBefore
      ? balanceAfter - balanceBefore
      : 0;

    if (delta < lossToCover) {
      emit NotEnoughInsurance(lossToCover - delta);
    }
  }
  //endregion ------------------------------------------------------- Bookkeeper logic

  //region ------------------------------------------------------- Internal utils
  /// @notice Cut loss-value to safe value that doesn't produce revert inside splitter
  function getSafeLossToCover(uint loss, uint totalAssets_) internal pure returns (
    uint lossToCover,
    uint lossUncovered
  ) {
    // see StrategySplitterV2._declareStrategyIncomeAndCoverLoss, _coverLoss implementations
    lossToCover = Math.min(loss, ConverterStrategyBaseLib2.HARDWORK_LOSS_TOLERANCE * totalAssets_ / 100_000);
    lossUncovered = loss > lossToCover
      ? loss - lossToCover
      : 0;
  }
  //endregion ------------------------------------------------------- Internal utils

}