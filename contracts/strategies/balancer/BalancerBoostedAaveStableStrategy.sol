// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./BalancerBoostedAaveStableDepositor.sol";

/// @title Converter Strategy with Quickswap for reward pool StakingDualRewards
/// @dev deprecated, we don't use it - no rewards...
contract BalancerBoostedAaveStableStrategy is ConverterStrategyBase, BalancerBoostedAaveStableDepositor {
  string public constant override NAME = "Balancer Boosted Aave USD Strategy";
  string public constant override PLATFORM = "Balancer";
  string public constant override STRATEGY_VERSION = "1.0.0";

  address[] public _rewardTokens;

  function init(
    address controller_,
    address splitter_,
    address converter_
  ) external initializer {
    __BalancerBoostedAaveUsdDepositor_init();
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    //todo _rewardTokens
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() external view returns (address[] memory tokens) {
    return _rewardTokens;
  }
}
