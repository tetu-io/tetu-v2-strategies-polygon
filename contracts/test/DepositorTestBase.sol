// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../strategies/depositors/DepositorBase.sol";

/// @title Abstract Depositor Test Base contract.
/// @author bogdoslav
abstract contract DepositorTestBase is DepositorBase {

  /// @dev Deposit given amount to the pool.
  /// @notice Depositor must care about tokens approval by itself.
  function depositorEnter(uint[] memory amountsDesired_) external
  returns (uint[] memory amountsConsumed, uint liquidityOut) {
    return _depositorEnter(amountsDesired_);
  }

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function depositorExit(uint liquidityAmount) external returns (uint[] memory amountsOut) {
    return _depositorExit(liquidityAmount);
  }

  /// @dev If pool supports emergency withdraw need to call it for emergencyExit()
  function depositorEmergencyExit() external returns (uint[] memory amountsOut) {
    return _depositorEmergencyExit();
  }

  /// @dev Claim all possible rewards.
  function depositorClaimRewards() external
  returns (address[] memory rewardTokens, uint[] memory rewardAmounts) {
    return _depositorClaimRewards();
  }

}
