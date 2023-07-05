// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Utils and constants related to entryKind param of ConverterStrategyBaseLib.SwapRepayPlanParams
library IterationPlanKinds {

  /// @notice Swap collateral asset to get required amount-to-repay, then repay and get more collateral back.
  ///         It tries to minimizes count of repay-operations.
  ///         If there are no debts, swap leftovers to get required proportions of the asset.
  ///         (uint256, uint256) - (entry kind, propNotUnderlying18)
  /// propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                     The assets should be swapped to get following result proportions:
  ///                     not-underlying : underlying === propNotUnderlying18 : (1e18 - propNotUnderlying18)
  uint constant public PLAN_SWAP_REPAY = 0;

  /// @notice Repay available amount-to-repay, swap all or part of collateral to borrowed-asset, make one repay if needed.
  ///         Swap + second repay tries to make asset balances to proportions required by the pool.
  ///         (uint256) - (entry kind)
  uint constant public PLAN_REPAY_SWAP_REPAY = 1;

  /// @notice Swap letfovers to required proportions, don't repay any debts
  ///         (uint256, uint256) - (entry kind, propNotUnderlying18)
  uint constant public PLAN_SWAP_ONLY = 2;

  /// @notice Decode entryData, extract first uint - entry kind
  ///         Valid values of entry kinds are given by ENTRY_KIND_XXX constants above
  function getEntryKind(bytes memory entryData_) internal pure returns (uint) {
    if (entryData_.length == 0) {
      return PLAN_SWAP_REPAY;
    }
    return abi.decode(entryData_, (uint));
  }
}
