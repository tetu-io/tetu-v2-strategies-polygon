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

  /// @notice Version of this contract. Adjust manually on each code modification.
  string internal constant DEPOSITOR_BASE_VERSION = "1.0.0";

  /// @notice Returns pool assets
  function _depositorPoolAssets() internal virtual view returns (address[] memory assets);

  /// @notice Returns pool token proportions
  function _depositorPoolWeights() internal virtual view returns (uint[] memory weights, uint total);

  /// @notice Returns pool token reserves
  function _depositorPoolReserves() internal virtual view returns (uint[] memory reserves);

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() internal virtual view returns (uint);

  /// @notice Deposit given amount to the pool.
  /// @dev Depositor must care about tokens approval by itself.
  function _depositorEnter(uint[] memory amountsDesired_) internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  );

  /// @notice Withdraw given lp amount from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  /// @return amountsOut The order of amounts is the same as in {_depositorPoolAssets}
  function _depositorExit(uint liquidityAmount) internal virtual returns (uint[] memory amountsOut);

  /// @notice Quotes output for given lp amount from the pool.
  /// @return amountsOut The order of amounts is the same as in {_depositorPoolAssets}
  function _depositorQuoteExit(uint liquidityAmount) internal virtual view returns (uint[] memory amountsOut);

  /// @dev If pool supports emergency withdraw need to call it for emergencyExit()
  /// @return amountsOut The order of amounts is the same as in {_depositorPoolAssets}
  function _depositorEmergencyExit() internal virtual returns (uint[] memory amountsOut) {
    return _depositorExit(_depositorLiquidity());
  }

  /// @notice Claim all possible rewards.
  function _depositorClaimRewards() internal virtual returns (
    address[] memory rewardTokens,
    uint[] memory rewardAmounts
  );

  //// @notice Total amount of LP tokens in the depositor
  function _depositorTotalSupply() internal virtual returns (uint);
}
