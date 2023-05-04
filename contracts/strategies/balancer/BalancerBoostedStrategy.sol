// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./BalancerBoostedDepositor.sol";
import "../../libs/AppPlatforms.sol";

/// @title Delta-neutral converter strategy for Balancer boosted pools
/// @author a17, dvpublic
contract BalancerBoostedStrategy is ConverterStrategyBase, BalancerBoostedDepositor {
  string public constant override NAME = "Balancer Boosted Strategy";
  string public constant override PLATFORM = AppPlatforms.BALANCER;
  string public constant override STRATEGY_VERSION = "1.0.0";

  function init(
    address controller_,
    address splitter_,
    address converter_,
    address pool_
  ) external initializer {
    __BalancerBoostedDepositor_init(pool_);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
  }

  function _handleRewards() internal virtual override returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    uint assetBalanceBefore = AppLib.balance(asset);
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    _rewardsLiquidation(rewardTokens, amounts);
    assetBalanceAfterClaim = AppLib.balance(asset);
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetBalanceBefore, assetBalanceAfterClaim, earned, lost);
    return (earned, lost, assetBalanceAfterClaim);
  }
}
