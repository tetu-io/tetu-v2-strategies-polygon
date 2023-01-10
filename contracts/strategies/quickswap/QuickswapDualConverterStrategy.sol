// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./QuickswapDepositor.sol";
import "../../integrations/quickswap/IStakingDualRewards.sol";

/// @title Converter Strategy with Quickswap for reward pool StakingDualRewards
contract QuickswapDualConverterStrategy is ConverterStrategyBase, QuickswapDepositor {

  string public constant override NAME = "Quickswap Converter Strategy";
  string public constant override PLATFORM = "Quickswap";
  string public constant override STRATEGY_VERSION = "1.0.0";

  /// @dev https://github.com/QuickSwap/quickswap-core
  address constant public _QUICKSWAP_ROUTER = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;

  address[] public _rewardTokens;

  /// @param rewardsPool_ Implementation of IStakingRewards
  function init(
    address controller_,
    address splitter_,
    address rewardsPool_,
    address converter_,
    address tokenA_,
    address tokenB_
  ) external initializer {
    __QuickswapDepositor_init(_QUICKSWAP_ROUTER, tokenA_, tokenB_, rewardsPool_);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    _rewardTokens = _getRewardTokens(rewardsPool_);
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() external view returns (address[] memory tokens) {
    return _rewardTokens;
  }

  /////////////////////////////////////////////////////////////////////
  ////   Implementation of claim-rewards-abstract-functions for IStakingRewards
  /////////////////////////////////////////////////////////////////////

  /// @notice List of rewards tokens
  function _getRewardTokens(address rewardsPool_) internal override view returns (address[] memory rewardTokensOut) {
    IStakingDualRewards rewardsPool = IStakingDualRewards(rewardsPool_);
    rewardTokensOut = new address[](2);
    rewardTokensOut[0] = address(rewardsPool.rewardsTokenA());
    rewardTokensOut[1] = address(rewardsPool.rewardsTokenB());
  }

  /// @notice True if any reward token can be claimed for the given address
  function _earned(address rewardsPool_, address user_) internal override view returns (bool) {
    IStakingDualRewards rewardsPool = IStakingDualRewards(rewardsPool_);
    return rewardsPool.earnedA(user_) != 0 || rewardsPool.earnedB(user_) != 0;
  }
}
