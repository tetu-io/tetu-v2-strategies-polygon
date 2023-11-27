// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../strategies/DepositorBase.sol";


/// @title Abstract Depositor Test Base contract.
/// @author bogdoslav
abstract contract DepositorTestBase is DepositorBase {

  address[] private _claimedRewardTokens;
  uint[] private _claimedRewardAmounts;

  /// @dev Deposit given amount to the pool.
  /// @notice Depositor must care about tokens approval by itself.
  function depositorEnter(uint[] memory amountsDesired_)
  external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    return _depositorEnter(amountsDesired_);
  }

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function depositorExit(uint liquidityAmount) external returns (uint[] memory amountsOut) {
    return _depositorExit(liquidityAmount, false);
  }

  /// @dev Quotes output for given lp amount from the pool.
  function depositorQuoteExit(uint liquidityAmount) external returns (uint[] memory amountsOut) {
    return _depositorQuoteExit(liquidityAmount);
  }

  /// @dev If pool supports emergency withdraw need to call it for emergencyExit()
  function depositorEmergencyExit() external returns (uint[] memory amountsOut) {
    return _depositorEmergencyExit();
  }

  /// @dev Claim all possible rewards.
  function depositorClaimRewards()
  external returns (address[] memory rewardTokens, uint[] memory rewardAmounts, uint[] memory depositorBalancesBefore) {
    (rewardTokens, rewardAmounts, depositorBalancesBefore) = _depositorClaimRewards();
    _claimedRewardTokens = rewardTokens;
    _claimedRewardAmounts = rewardAmounts;
  }

  function claimedRewardTokens()
  external view returns (address[] memory) {
    return _claimedRewardTokens;
  }

  function claimedRewardAmounts()
  external view returns (uint[] memory) {
    return _claimedRewardAmounts;
  }

  /// @dev Returns depositor's pool shares / lp token amount
  function depositorLiquidity() external view returns (uint) {
    return _depositorLiquidity();

  }

  /// @dev Returns pool token reserves
  function depositorPoolReserves() external view returns (uint[] memory reserves) {
    return _depositorPoolReserves();
  }

  /// @dev Returns pool token assets
  function depositorPoolAssets() external view returns (address[] memory assets) {
    return _depositorPoolAssets();
  }

  /// @dev Returns pool token weights
  function depositorPoolWeights() external view returns (uint[] memory weights, uint total) {
    return _depositorPoolWeights();
  }


}
