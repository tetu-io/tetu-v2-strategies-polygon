// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./QuickswapDepositor.sol";
import "../../integrations/quickswap/IStakingRewards.sol";

///// @title Converter Strategy with Quickswap for reward pool StakingRewards
///// @dev deprecated, we don't use it - no rewards...
//contract QuickswapConverterStrategy is ConverterStrategyBase, QuickswapDepositor {
//
//  string public constant override NAME = "Quickswap Converter Strategy";
//  string public constant override PLATFORM = "Quickswap";
//  string public constant override STRATEGY_VERSION = "1.0.0";
//
//  /// @dev https://github.com/QuickSwap/quickswap-core
//  address constant public _QUICKSWAP_ROUTER = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;
//
//  address[] public _rewardTokens;
//
//  /// @param rewardsPool_ Implementation of IStakingRewards, see DownloadQuickPoolsPure.ts
//  /// @param converter_ An address of TetuConverter contract
//  function init(
//    address controller_,
//    address splitter_,
//    address rewardsPool_,
//    address converter_,
//    address tokenA_,
//    address tokenB_
//  ) external initializer {
//    __QuickswapDepositor_init(_QUICKSWAP_ROUTER, tokenA_, tokenB_, rewardsPool_);
//    __ConverterStrategyBase_init(controller_, splitter_, converter_);
//    _rewardTokens = _getRewardTokens(rewardsPool_);
//  }
//
//  /// @dev Returns reward token addresses array.
//  function rewardTokens() external view returns (address[] memory tokens) {
//    return _rewardTokens;
//  }
//
//  /////////////////////////////////////////////////////////////////////
//  ////   Implementation of claim-rewards-abstract-functions for IStakingRewards
//  /////////////////////////////////////////////////////////////////////
//
//  /// @notice List of rewards tokens
//  function _getRewardTokens(address rewardsPool_) internal override view returns (address[] memory rewardTokensOut) {
//    rewardTokensOut = new address[](1);
//    rewardTokensOut[0] = address(IStakingRewards(rewardsPool_).rewardsToken());
//  }
//
//  /// @notice True if any reward token can be claimed for the given address
//  function _hasAnyRewards(address rewardsPool_, address user_) internal override view returns (bool) {
//    return IStakingRewards(rewardsPool_).earned(user_) != 0;
//  }
//}
