// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
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

  /// @notice Calculate the amount by which the debt should be reduced to reduce locked-amount-percent below given value
  /// @param totalAssets Total assets of the strategy, in underlying
  /// @param isUnderlyingA True if A is underlying
  /// @param collateralAmountA Total collateral amount in asset A
  /// @param debtAmountB Total debt amount in asset B
  /// @param pricesAB Prices of A and B, decimals 18
  /// @param requiredLockedAmountPercent18  Required value of locked amount percent, decimals 18; 0.03 means 3%
  /// @return deltaDebtAmountB The amount by which the debt should be reduced, asset B
  function getAmountToReduceDebt(
    uint totalAssets,
    bool isUnderlyingA,
    uint collateralAmountA,
    uint debtAmountB,
    uint[2] memory pricesAB,
    uint8[2] memory decimalsAB,
    uint requiredLockedAmountPercent18
  ) external view returns (uint deltaDebtAmountB) {
    if (debtAmountB != 0) {
      uint alpha18 = 1e18 * collateralAmountA * 10**decimalsAB[1] / 10**decimalsAB[0] / debtAmountB;
      uint indexUnderlying = isUnderlyingA ? 0 : 1;
      uint lockedPercent18 = 1e18
        * AppLib.sub0(collateralAmountA * pricesAB[0] / 10**decimalsAB[0], debtAmountB * pricesAB[1] / 10**decimalsAB[1])
        / (totalAssets * pricesAB[indexUnderlying] / 10**decimalsAB[indexUnderlying]);
      deltaDebtAmountB = AppLib.sub0(lockedPercent18, requiredLockedAmountPercent18)
        * totalAssets
        * pricesAB[indexUnderlying]
        / 10**decimalsAB[indexUnderlying]
        / AppLib.sub0(alpha18 * pricesAB[0] / 1e18, pricesAB[1]);
    }

    return deltaDebtAmountB * 10**decimalsAB[1] / 1e18;
  }
}