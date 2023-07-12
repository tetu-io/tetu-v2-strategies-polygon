// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IPoolProportionsProvider {
  /// @notice Calculate proportions of [underlying, not-underlying] required by the internal pool of the strategy
  /// @return Proportion of the not-underlying [0...1e18]
  function getPropNotUnderlying18() external view returns (uint);
}
