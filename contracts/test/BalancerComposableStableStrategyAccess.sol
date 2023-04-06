// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../strategies/balancer/BalancerComposableStableStrategy.sol";

/// @notice Provide direct access to BalancerComposableStableStrategy internal functions
contract BalancerComposableStableStrategyAccess is BalancerComposableStableStrategy {

  //////////////////////////////////////////////////////////////////////////////////////////////////////
  ///  Set up
  //////////////////////////////////////////////////////////////////////////////////////////////////////

  function setBaseAmountAccess(address token_, uint amount_) external {
    baseAmounts[token_] = amount_;
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////
  ///  Access to internal functions
  //////////////////////////////////////////////////////////////////////////////////////////////////////

  function _depositToPoolAccess(uint amount_, bool updateTotalAssetsBeforeInvest_) external returns (
    uint loss
  ) {
    return _depositToPool(amount_, updateTotalAssetsBeforeInvest_);
  }

  function _withdrawFromPoolAccess(uint amount) external returns (
    uint investedAssetsUSD,
    uint assetPrice,
    uint loss
  ) {
    return _withdrawFromPool(amount);
  }

  function _withdrawAllFromPoolAccess() external returns (
    uint investedAssetsUSD,
    uint assetPrice,
    uint loss
  ) {
    return _withdrawAllFromPool();
  }
}
