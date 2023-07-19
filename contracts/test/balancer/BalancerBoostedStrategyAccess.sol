// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/balancer/BalancerBoostedStrategy.sol";

/// @notice Provide direct access to BalancerBoostedStrategy internal functions
contract BalancerBoostedStrategyAccess is BalancerBoostedStrategy {

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
