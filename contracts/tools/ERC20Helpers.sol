// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";

/// @title Contract with helper functions.
/// @author bogdoslav
contract ERC20Helpers {
  using SafeERC20 for IERC20;

  function _balance(address token) internal view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  /// @notice Should be used for third-party pools
  function _safeApprove(address token, uint amount, address spender) internal {
    IERC20(token).safeApprove(spender, 0);
    IERC20(token).safeApprove(spender, amount);
  }

  /// @notice Should NOT be used for third-party pools
  function _approveIfNeeded(address token, uint amount, address spender) internal {
    if (IERC20(token).allowance(address(this), spender) < amount) {
      IERC20(token).safeApprove(spender, 0);
      IERC20(token).safeApprove(spender, type(uint).max);
    }
  }


}
