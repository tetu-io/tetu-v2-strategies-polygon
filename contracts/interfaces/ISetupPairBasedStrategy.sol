// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Functions to initialize pair-based strategies
interface ISetupPairBasedStrategy {

  /// @notice Manually set status of the fuse
  /// @param status See PairBasedStrategyLib.FuseStatus enum for possile values
  /// @param index01 0 - token A, 1 - token B
  function setFuseStatus(uint index01, uint status) external;

  /// @notice Set thresholds for the fuse: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  ///         Example: [0.9, 0.92, 1.08, 1.1]
  ///         Price falls below 0.9 - fuse is ON. Price rises back up to 0.92 - fuse is OFF.
  ///         Price raises more and reaches 1.1 - fuse is ON again. Price falls back and reaches 1.08 - fuse OFF again.
  /// @param values Price thresholds: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  /// @param index01 0 - token A, 1 - token B
  function setFuseThresholds(uint index01, uint[4] memory values) external;
  function setStrategyProfitHolder(address strategyProfitHolder) external;
}
