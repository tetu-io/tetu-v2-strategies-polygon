// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Mock of ITetuVaultV2 (only methods required for tests)
contract MockVaultInsurance {
  address private _insurance;

  function setInsurance(address vault_) external {
    _insurance = vault_;
  }
  function insurance() external view returns (address) {
    return _insurance;
  }
}