// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./BalancerBoostedDepositor.sol";
import "../../libs/AppPlatforms.sol";

/// @title Delta-neutral converter strategy for Balancer boosted pools
/// @author a17, dvpublic
/// @notice Versions:
/// 1.0.2 Add setGauge, move to balancer gauges v2
contract BalancerBoostedStrategy is ConverterStrategyBase, BalancerBoostedDepositor {
  string public constant override NAME = "Balancer Boosted Strategy";
  string public constant override PLATFORM = AppPlatforms.BALANCER;
  string public constant override STRATEGY_VERSION = "1.0.2";

  function init(
    address controller_,
    address splitter_,
    address converter_,
    address pool_,
    address gauge_
  ) external initializer {
    __BalancerBoostedDepositor_init(pool_, gauge_);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);

    // setup specific name for UI
    StrategyLib2._changeStrategySpecificName(baseState, BalancerLogicLib.createSpecificName(pool_));
  }

  function _handleRewards() internal virtual override returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    address asset = baseState.asset;
    uint assetBalanceBefore = AppLib.balance(asset);
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    _rewardsLiquidation(rewardTokens, amounts);
    assetBalanceAfterClaim = AppLib.balance(asset);
    (uint earned2, uint lost2) = ConverterStrategyBaseLib2._registerIncome(assetBalanceBefore, assetBalanceAfterClaim);
    return (earned + earned2, lost + lost2, assetBalanceAfterClaim);
  }

  function setGauge(address gauge_) external {
    require(msg.sender == IController(controller()).governance(), AppErrors.GOVERNANCE_ONLY);

    IBalancerGauge gaugeOld = IBalancerGauge(gauge);
    uint balance = gaugeOld.balanceOf(address(this));
    if (balance != 0) {
      gaugeOld.withdraw(balance);
    }

    IBalancerGauge gaugeNew = IBalancerGauge(gauge_);
    gauge = gaugeNew;

    if (balance != 0) {
      gaugeNew.deposit(balance);
    }
  }
}
