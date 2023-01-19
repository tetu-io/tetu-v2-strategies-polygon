// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/balancer/IBVault.sol";
import "../../strategies/balancer/BalancerComposableStableDepositor.sol";

/// @notice Provide direct access to internal functions of {BalancerBoostedAaveStableDepositor}
contract BalancerComposableStableDepositorFacade is BalancerComposableStableDepositor {
  function init(bytes32 poolId) external initializer {
    __BalancerBoostedAaveUsdDepositor_init(poolId);
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

  uint public lastSwapAmountOut;
  function _swapAccess(
    bytes32 poolId_,
    address assetIn_,
    address assetOut_,
    uint amountIn_,
    IBVault.FundManagement memory funds_
  ) external returns (uint) {
    lastSwapAmountOut = _swap(poolId_, assetIn_, assetOut_, amountIn_, funds_);
    return lastSwapAmountOut;
  }


  uint[] public lastAmountsConsumedOut;
  uint public lastAmountsConsumedOutLength;
  uint public lastLiquidityOut;
  function _depositorEnterAccess(uint[] memory amountsDesired_) external virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    (amountsConsumedOut, liquidityOut) = _depositorEnter(amountsDesired_);
    // let's store results of _depositorEnter last call to public members
    (lastAmountsConsumedOut, lastLiquidityOut) = (amountsConsumedOut, liquidityOut);
    lastAmountsConsumedOutLength = lastAmountsConsumedOut.length;
  }

  uint[] public lastAmountsOut;
  uint public lastAmountsOutLength;
  function _depositorExitAccess(uint liquidityAmount_) external returns (uint[] memory amountsOut) {
    lastAmountsOut = _depositorExit(
      liquidityAmount_ == 0  // 0 means that we should withdraw all liquidity
        ? _depositorLiquidity()
        : liquidityAmount_
    );
    lastAmountsOutLength = lastAmountsOut.length;
    return lastAmountsOut;
  }

  uint[] public lastRewardsAmountsOut;
  address[] public lastRewardsTokensOut;
  uint public lastRewardsAmountsOutLength;
  uint public lastRewardsTokensOutLength;
  function _depositorClaimRewardsAccess() external virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    (tokensOut, amountsOut) = _depositorClaimRewards();
    lastRewardsAmountsOut = amountsOut;
    lastRewardsTokensOut = tokensOut;
    lastRewardsAmountsOutLength = amountsOut.length;
    lastRewardsTokensOutLength = tokensOut.length;
  }
}
