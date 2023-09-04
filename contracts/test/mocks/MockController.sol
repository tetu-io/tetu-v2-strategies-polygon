// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Mock of IController (only methods required for tests)
contract MockController {
  address private _forwarder;
  mapping(address => bool) internal operators;

  function setForwarder(address forwarder_) external {
    _forwarder = forwarder_;
  }
  function forwarder() external view returns (address) {
    return _forwarder;
  }


  function setOperator(address adr_, bool value) external {
    operators[adr_] = value;
  }
  function isOperator(address adr_) external view returns (bool) {
    return operators[adr_];
  }
}