// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./BalancerComposableStableDepositor.sol";

/// @title Converter Strategy with Quickswap for reward pool StakingDualRewards
/// @dev deprecated, we don't use it - no rewards...
contract BalancerComposableStablePoolStrategy is ConverterStrategyBase, BalancerComposableStableDepositor {
  string public constant override NAME = "Balancer Boosted Aave USD Strategy";
  string public constant override PLATFORM = "Balancer";
  string public constant override STRATEGY_VERSION = "1.0.0";
  bytes32 public constant POOL_ID = 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b;

  address[] public _rewardTokens;

  function init(
    address controller_,
    address splitter_,
    address converter_
  ) external initializer {
    __BalancerBoostedAaveUsdDepositor_init(POOL_ID);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    //todo _rewardTokens
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() external view returns (address[] memory tokens) {
    return _rewardTokens;
  }
}
