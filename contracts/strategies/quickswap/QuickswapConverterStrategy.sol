// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./QuickswapDepositor.sol";

/// @title Converter Strategy with Quickswap for reward pool StakingRewards
contract QuickswapConverterStrategy is ConverterStrategyBase, QuickswapDepositor {

  string public constant override NAME = "Quickswap Converter Strategy";
  string public constant override PLATFORM = "Quickswap";
  string public constant override STRATEGY_VERSION = "1.0.0";

  /// @dev https://github.com/QuickSwap/quickswap-core
  address constant public _QUICKSWAP_ROUTER = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;

  /// @param rewardsPool_ Implementation of IStakingRewards
  function init(
    address controller_,
    address splitter_,
    address rewardsPool_,
    address rewardToken_,
    address converter_,
    address tokenA_,
    address tokenB_
  ) external initializer {
    address[] memory listRewardTokens = new address[](1);
    listRewardTokens[0] = rewardToken_;

    __QuickswapDepositor_init(_QUICKSWAP_ROUTER, tokenA_, tokenB_, rewardsPool_, listRewardTokens);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() external view returns (address[] memory tokens) {
    return _rewardTokens;
  }

}
