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
  uint public lastLiquidityAmountIn;
  function _depositorExitAccess(uint liquidityAmount_) external returns (uint[] memory) {
    lastLiquidityAmountIn = liquidityAmount_ == 0  // 0 means that we should withdraw all liquidity
      ? _depositorLiquidity()
      : liquidityAmount_;
    lastAmountsOut = _depositorExit(lastLiquidityAmountIn);
    lastAmountsOutLength = lastAmountsOut.length;
    return lastAmountsOut;
  }

  uint[] public lastQuoteExitAmountsOut;
  uint public lastQuoteExitAmountsOutLength;
  function _depositorQuoteExitAccess(uint liquidityAmount_) external returns (uint[] memory) {
    lastQuoteExitAmountsOut = _depositorQuoteExit(
      liquidityAmount_ == 0  // 0 means that we should withdraw all liquidity
        ? _depositorLiquidity()
        : liquidityAmount_
    );
    lastQuoteExitAmountsOutLength = lastQuoteExitAmountsOut.length;
    return lastQuoteExitAmountsOut;
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
