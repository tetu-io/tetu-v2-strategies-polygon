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
    WithdrawLocal memory v,
    address[] memory tokens,
    address asset,
    mapping(address => uint) storage liquidationThresholds,
    bytes memory planEntryData,
    address controller
  ) internal {
    v.controller = controller;
    StrategyLib2.onlyOperators(v.controller);

    v.planKind = IterationPlanLib.getEntryKind(planEntryData);
    v.propNotUnderlying18 = PairBasedStrategyLib._extractProp(v.planKind, planEntryData);

    if (tokens[1] == asset) {
      (tokens[0], tokens[1]) = (tokens[1], tokens[0]);
    }

    v.tokens = tokens;

    v.liquidationThresholds = new uint[](2);
    v.liquidationThresholds[0] = liquidationThresholds[tokens[0]];
    v.liquidationThresholds[1] = liquidationThresholds[tokens[1]];
  }
}