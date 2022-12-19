// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../../tools/ERC20Helpers.sol";

/// @title Abstract base Depositor contract.
/// @notice Converter strategies should inherit xDepositor.
/// @notice All communication with external pools should be done at inherited contract
/// @author bogdoslav
abstract contract DepositorBase is ERC20Helpers {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string internal constant DEPOSITOR_BASE_VERSION = "1.0.0";

  /// @dev Returns pool assets
  function _depositorPoolAssets() internal virtual view returns (address[] memory assets);

  /// @dev Returns pool token proportions
  function _depositorPoolWeights() internal virtual view returns (uint[] memory weights, uint total);

  /// @dev Returns pool token reserves
  function _depositorPoolReserves() internal virtual view returns (uint[] memory reserves);

  /// @dev Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() internal virtual view returns (uint);

  /// @dev Deposit given amount to the pool.
  /// @notice Depositor must care about tokens approval by itself.
  function _depositorEnter(uint[] memory amountsDesired_) internal virtual
  returns (uint[] memory amountsConsumed, uint liquidityOut);

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount) internal virtual returns (uint[] memory amountsOut);

  /// @dev If pool supports emergency withdraw need to call it for emergencyExit()
  function _depositorEmergencyExit() internal virtual returns (uint[] memory amountsOut) {
    return _depositorExit(_depositorLiquidity());
  }

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() internal virtual
  returns (address[] memory rewardTokens, uint[] memory rewardAmounts);

}
