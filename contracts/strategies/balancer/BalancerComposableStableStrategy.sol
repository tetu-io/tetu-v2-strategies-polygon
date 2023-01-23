// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./BalancerComposableStableDepositor.sol";

/// @title Converter Strategy with Quickswap for reward pool StakingDualRewards
/// @dev deprecated, we don't use it - no rewards...
contract BalancerComposableStableStrategy is ConverterStrategyBase, BalancerComposableStableDepositor {
  string public constant override NAME = "Balancer Boosted Aave USD Strategy";
  string public constant override PLATFORM = "Balancer";
  string public constant override STRATEGY_VERSION = "1.0.0";
  bytes32 public constant POOL_ID = 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b;

  function init(
    address controller_,
    address splitter_,
    address converter_
  ) external initializer {
    // we can take address of the reward tokens using gauge and gauge.reward_contract
    // it worth to encode these array to avoid calculation in init
    address[] memory rewardTokens = new address[](1);
    rewardTokens[0] = 0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3;

    __BalancerBoostedAaveUsdDepositor_init(POOL_ID, rewardTokens);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
  }
}
