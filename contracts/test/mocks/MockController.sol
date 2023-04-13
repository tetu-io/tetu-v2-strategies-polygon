// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Mock of IController (only methods required for tests)
contract MockController {
  address private _forwarder;

  function setForwarder(address forwarder_) external {
    _forwarder = forwarder_;
  }
  function forwarder() external view returns (address) {
    return _forwarder;
  }
}