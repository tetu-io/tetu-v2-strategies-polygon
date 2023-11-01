// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV2.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../interfaces/IPairBasedStrategyReaderAccess.sol";
import "../../libs/AppLib.sol";
import "../ConverterStrategyBaseLib.sol";
import "./PairBasedStrategyLib.sol";

/// @notice Read raw values and calculate complex values related to UniswapV3ConverterStrategy
contract PairBasedStrategyReader {

  /// @notice Possible results of isWithdrawByAggCallRequired:
  ///         full withdraw is required (with propNotUnderlying = 0)
  uint constant public FULL_WITHDRAW_IS_REQUIRED = 1;
  /// @notice Possible results of isWithdrawByAggCallRequired:
  ///         rebalance of the debts is required with pool proportions (propNotUnderlying = type(uint).max)
  uint constant public DEBTS_REBALANCE_IS_REQUIRED = 2;

  //region -------------------------------------------------- Data types
  struct GetLockedUnderlyingAmountLocal {
    ITetuConverter converter;
    address[] tokens;
    uint[] prices;
    uint[] decs;
    uint directDebt;
    uint directCollateral;
    uint reverseDebt;
    uint reverseCollateral;
    uint directDebtCost;
    uint reverseCollateralCost;
  }

  struct GetAmountToReduceDebtLocal {
    address[] tokens;
    ITetuConverter converter;
    uint[] prices;
    uint[] decs;
    address[] addr;
    IPriceOracle priceOracle;
    uint debtAmountB;
    uint collateralAmountA;
    uint debtAmountA;
    uint collateralAmountB;
  }
  //endregion -------------------------------------------------- Data types

  //region -------------------------------------------------- Locked underlying amount logic
  /// @notice Estimate amount of underlying locked in the strategy by TetuConverter
  /// @dev We cannot call strategy.getState() because of stack too deep problem
  /// @param strategy_ Instance of UniswapV3ConverterStrategy
  /// @return estimatedUnderlyingAmount Total locked amount recalculated to the underlying
  /// @return totalAssets strategy.totalAssets() - in terms of underlying
  function getLockedUnderlyingAmount(address strategy_) public view returns (
    uint estimatedUnderlyingAmount,
    uint totalAssets
  ) {
    GetLockedUnderlyingAmountLocal memory v;
    IPairBasedStrategyReaderAccess strategy = IPairBasedStrategyReaderAccess(strategy_);

    (address[] memory addr, , , ) = strategy.getDefaultState();
    address tokenA = addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_A];
    address tokenB = addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_B];

    v.converter = ITetuConverter(strategy.converter());

    v.tokens = new address[](2);
    v.tokens[0] = ISplitter(strategy.splitter()).asset(); // underlying
    v.tokens[1] = tokenA == v.tokens[0] ? tokenB : tokenA; // not underlying

    IPriceOracle priceOracle = AppLib._getPriceOracle(v.converter);
    (v.prices, v.decs) =  AppLib._getPricesAndDecs(priceOracle, v.tokens, 2);

    // direct borrow: underlying is collateral
    (v.directDebt, v.directCollateral) = v.converter.getDebtAmountStored(strategy_, v.tokens[0], v.tokens[1], true);

    // reverse borrow: underlying is borrowed asset
    (v.reverseDebt, v.reverseCollateral) = v.converter.getDebtAmountStored(strategy_, v.tokens[1], v.tokens[0], true);

    v.directDebtCost = v.directDebt * v.prices[1] * v.decs[0] / v.decs[1] / v.prices[0];
    v.reverseCollateralCost = v.reverseCollateral * v.prices[1] * v.decs[0] / v.decs[1] / v.prices[0];

    return (
      v.directCollateral + v.reverseCollateralCost > (v.directDebtCost + v.reverseDebt)
        ? v.directCollateral + v.reverseCollateralCost - v.directDebtCost - v.reverseDebt
        : 0,
      strategy.totalAssets()
    );
  }

  /// @notice Check if a call of withdrawByAgg is required
  /// @param strategy_ instance of IPairBasedStrategyReaderAccess
  /// @param allowedLockedAmountPercent [0...100]
  /// @return 0: it's not necessary to call withdrawByAgg
  ///         1: full withdraw is required (with propNotUnderlying = 0)
  ///         2: rebalance of the debts is required with pool proportions (propNotUnderlying = type(uint).max)
  function isWithdrawByAggCallRequired(address strategy_, uint allowedLockedAmountPercent) external view returns (
    uint
  ) {
    IPairBasedStrategyReaderAccess strategy = IPairBasedStrategyReaderAccess(strategy_);

    (, , uint[] memory nums, ) = strategy.getDefaultState();

    if (
      PairBasedStrategyLib.isFuseTriggeredOn(
        PairBasedStrategyLib.FuseStatus(nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_FUSE_STATUS])
      )
    ) {
      // fuse is enabled: full withdraw to underlying is required
      if (nums[PairBasedStrategyLib.IDX_NUMS_DEFAULT_STATE_WITHDRAW_DONE] == 0) {
        return FULL_WITHDRAW_IS_REQUIRED;
      }
    } else {
      // locked amount is too high: partial withdraw  (with pool proportions) is required
      (uint estimatedUnderlyingAmount, uint totalAssets) = getLockedUnderlyingAmount(strategy_);
      uint percent = estimatedUnderlyingAmount * 100 / totalAssets;

      if (percent > allowedLockedAmountPercent) {
        return DEBTS_REBALANCE_IS_REQUIRED;
      }
    }

    return 0;
  }
  //endregion -------------------------------------------------- Locked underlying amount logic

  //region -------------------------------------------------- Calculate amount to reduce debt
  /// @notice Calculate the amount by which the debt should be reduced to reduce locked-amount-percent below given value
  /// @param requiredLockedAmountPercent  Required value of locked amount percent [0..100]
  /// @param requiredAmountToReduceDebt If not zero: we are going to make repay-swap-repay to reduce total
  ///        debt on the given amount. So, if possible it worth to make swap in such a way as to reduce
  ///        the amount of debt by the given amount.
  ///        This amount is set in terms of the token B if there is direct debt, or in terms of the token A otherwise.
  function getAmountToReduceDebtForStrategy(address strategy_, uint requiredLockedAmountPercent) external view returns (
    uint requiredAmountToReduceDebt
  ) {
    GetAmountToReduceDebtLocal memory v;
    IPairBasedStrategyReaderAccess strategy = IPairBasedStrategyReaderAccess(strategy_);

    (v.addr, , , ) = strategy.getDefaultState();

    v.tokens = new address[](2);
    v.tokens[0] = v.addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_A];
    v.tokens[1] = v.addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_B];

    v.converter = ITetuConverter(strategy.converter());

    v.priceOracle = AppLib._getPriceOracle(v.converter);
    (v.prices, v.decs) =  AppLib._getPricesAndDecs(v.priceOracle, v.tokens, 2);

    (v.debtAmountB, v.collateralAmountA) = v.converter.getDebtAmountStored(strategy_, v.tokens[0], v.tokens[1], false);
    (v.debtAmountA, v.collateralAmountB) = v.converter.getDebtAmountStored(strategy_, v.tokens[1], v.tokens[0], false);

    // the app should have debt in one direction only - either direct or reverse
    // but dust debts in contrary direction are still possible
    if (v.debtAmountB > v.collateralAmountB) {
      if (v.debtAmountB > AppLib.DUST_AMOUNT_TOKENS) {
        // there is direct debt
        requiredAmountToReduceDebt = getAmountToReduceDebt(
          strategy.totalAssets(),
          strategy.asset() == v.tokens[0],
          v.collateralAmountA,
          v.debtAmountB,
          [v.prices[0], v.prices[1]],
          [v.decs[0], v.decs[1]],
          requiredLockedAmountPercent
        );
      }
    } else {
      if (v.debtAmountA > AppLib.DUST_AMOUNT_TOKENS) {
        // there is reverse debt
        requiredAmountToReduceDebt = getAmountToReduceDebt(
          strategy.totalAssets(),
          strategy.asset() == v.tokens[1],
          v.collateralAmountB,
          v.debtAmountA,
          [v.prices[1], v.prices[0]],
          [v.decs[1], v.decs[0]],
          requiredLockedAmountPercent
        );
      }
    }
    return requiredAmountToReduceDebt;
  }

  /// @notice Calculate the amount by which the debt should be reduced to reduce locked-amount-percent below given value
  /// @param totalAssets Total assets of the strategy, in underlying
  /// @param isUnderlyingA True if A is underlying
  /// @param collateralAmountA Total collateral amount in asset A
  /// @param debtAmountB Total debt amount in asset B
  /// @param pricesAB Prices of A and B, decimals 18
  /// @param decsAB 10**decimals for A and B
  /// @param requiredLockedAmountPercent  Required value of locked amount percent [0..100]
  /// @return deltaDebtAmountB The amount by which the debt should be reduced, asset B
  function getAmountToReduceDebt(
    uint totalAssets,
    bool isUnderlyingA,
    uint collateralAmountA,
    uint debtAmountB,
    uint[2] memory pricesAB,
    uint[2] memory decsAB,
    uint requiredLockedAmountPercent
  ) public view returns (uint deltaDebtAmountB) {
    if (debtAmountB != 0 && totalAssets != 0) {
      uint alpha18 = 1e18 * collateralAmountA * decsAB[1] / decsAB[0] / debtAmountB;

      uint indexUnderlying = isUnderlyingA ? 0 : 1;
      uint lockedPercent18 = 1e18
        * AppLib.sub0(collateralAmountA * pricesAB[0] / decsAB[0], debtAmountB * pricesAB[1] / decsAB[1])
        / (totalAssets * pricesAB[indexUnderlying] / decsAB[indexUnderlying]);
      uint delta = AppLib.sub0(alpha18 * pricesAB[0] / 1e18, pricesAB[1]);

      deltaDebtAmountB = delta == 0
        ? 0 // weird case
        : AppLib.sub0(lockedPercent18, requiredLockedAmountPercent * 1e16)
          * totalAssets
          * pricesAB[indexUnderlying]
          / decsAB[indexUnderlying]
          / delta;
    }

    return deltaDebtAmountB * decsAB[1] / 1e18;
  }
  //endregion -------------------------------------------------- Calculate amount to reduce debt
}
