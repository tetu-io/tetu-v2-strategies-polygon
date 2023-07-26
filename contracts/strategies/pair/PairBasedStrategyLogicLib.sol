// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../ConverterStrategyBaseLib.sol";
import "./PairBasedStrategyLib.sol";

/// @notice Library for the UniV3-like strategies with two tokens in the pool
library PairBasedStrategyLogicLib {
  //region ------------------------------------------------------- Data types
  /// @notice Local variables required inside withdrawByAggStep and quoteWithdrawByAgg
  struct WithdrawLocal {
    /// [underlying, not-underlying]
    address[] tokens;
    address controller;
    /// liquidationThresholds for the {tokens}
    uint[] liquidationThresholds;
    uint planKind;
    uint propNotUnderlying18;
  }

  //endregion ------------------------------------------------------- Data types

  /// @notice Prepare array of amounts ready to deposit, borrow missed amounts
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address tokenA,
    address tokenB,
    bytes memory entryData,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    tokenAmounts = new uint[](2);
    uint spentCollateral;

    AppLib.approveIfNeeded(tokenA, amount_, address(tetuConverter_));
    (spentCollateral, tokenAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      tokenA,
      tokenB,
      amount_,
      liquidationThresholds[tokenA] // amount_ is set in terms of collateral asset
    );

    tokenAmounts[0] = amount_ - spentCollateral;
  }

  /// @param tokens Result of _depositorPoolAssets(). This array is changed in place and returned as {tokensOut}
  /// @param asset underlying
  function initWithdrawLocal(
    WithdrawLocal memory dest,
    address[2] memory tokens,
    address asset,
    mapping(address => uint) storage liquidationThresholds,
    bytes memory planEntryData,
    address controller
  ) internal view {
    dest.controller = controller;
    StrategyLib2.onlyOperators(dest.controller);

    dest.planKind = IterationPlanLib.getEntryKind(planEntryData);
    dest.propNotUnderlying18 = PairBasedStrategyLib._extractProp(dest.planKind, planEntryData);

    if (tokens[1] == asset) {
      (tokens[0], tokens[1]) = (tokens[1], tokens[0]);
    }

    dest.tokens = new address[](2);
    if (tokens[1] == asset) {
      (dest.tokens[0], dest.tokens[1]) = (tokens[1], tokens[0]);
    } else {
      (dest.tokens[0], dest.tokens[1]) = (tokens[0], tokens[1]);
    }

    dest.liquidationThresholds = new uint[](2);
    dest.liquidationThresholds[0] = liquidationThresholds[tokens[0]];
    dest.liquidationThresholds[1] = liquidationThresholds[tokens[1]];
  }

  /// @notice Determine if the pool needs to be rebalanced.
  /// @return A boolean indicating if the pool needs to be rebalanced.
  function _needPoolRebalance(
    int24 tick,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    int24 rebalanceTickRange
  ) internal pure returns (bool) {
    if (upperTick - lowerTick == tickSpacing) {
      return tick < lowerTick || tick >= upperTick;
    } else {
      int24 halfRange = (upperTick - lowerTick) / 2;
      int24 oldMedianTick = lowerTick + halfRange;
      return (tick > oldMedianTick)
        ? tick - oldMedianTick >= rebalanceTickRange
        : oldMedianTick - tick > rebalanceTickRange;
    }
  }
}