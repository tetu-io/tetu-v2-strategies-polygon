// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Provides access to getDefaultState() of a pair-based strategy
interface IPairBasedDefaultStateProvider {
  /// @notice Returns the current state of the contract
  /// @return addr [tokenA, tokenB, pool, profitHolder]
  /// @return tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  /// @return nums [totalLiquidity, fuse-status-tokenA, fuse-status-tokenB, withdrawDone, 4 thresholds of token A, 4 thresholds of token B]
  /// @return boolValues [isStablePool, depositorSwapTokens]
  function getDefaultState() external view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  );
}