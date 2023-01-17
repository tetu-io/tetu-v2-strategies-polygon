// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/balancer/IBVault.sol";
import "../../strategies/balancer/BalancerBoostedAaveStableDepositor.sol";

/// @notice Provide direct access to internal functions of {BalancerBoostedAaveStableDepositor}
contract BalancerBoostedAaveStableDepositorFacade is BalancerBoostedAaveStableDepositor {
  function init() external initializer {
    __BalancerBoostedAaveUsdDepositor_init();
  }

  function _depositorPoolAssetsAccess() external virtual view returns (address[] memory poolAssets) {
    return _depositorPoolAssets();
  }

  function _depositorPoolWeightsAccess() external virtual view returns (uint[] memory weights, uint totalWeight) {
    return _depositorPoolWeights();
  }

  function _depositorPoolReservesAccess() external virtual view returns (uint[] memory reserves) {
    return _depositorPoolReserves();
  }

  function _depositorLiquidityAccess() external virtual view returns (uint) {
    return _depositorLiquidity();
  }

  function _depositorTotalSupplyAccess() external view returns (uint) {
    return _depositorTotalSupply();
  }

  function _swapAccess(
    bytes32 poolId_,
    address assetIn_,
    address assetOut_,
    uint amountIn_,
    IBVault.FundManagement memory funds_
  ) external returns (uint) {
    return _swap(poolId_, assetIn_, assetOut_, amountIn_, funds_);
  }

  function _depositorEnterAccess(uint[] memory amountsDesired_) external virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    return _depositorEnter(amountsDesired_);
  }
}
