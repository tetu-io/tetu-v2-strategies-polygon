// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../libs/AppLib.sol";

/// @notice Provide public access to internal functions of AppLib
contract AppLibFacade {
  function getAssetIndex(address[] memory tokens_, address asset_) external pure returns (uint) {
    return AppLib.getAssetIndex(tokens_, asset_);
  }

  function _getLiquidationThreshold(uint threshold) external pure returns (uint) {
    return AppLib._getLiquidationThreshold(threshold);
  }

  function getDefaultLiquidationThresholdConstant() external pure returns (uint) {
    return AppLib.DEFAULT_LIQUIDATION_THRESHOLD;
  }

  function approveIfNeeded(address token, uint amount, address spender) external {
    AppLib.approveIfNeeded(token, amount, spender);
  }

  function approveForced(address token, uint amount, address spender) external {
    AppLib.approveForced(token, amount, spender);
  }
}
