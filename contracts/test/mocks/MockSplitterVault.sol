// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Mock of ISplitter (only methods required for tests)
contract MockSplitterVault {
  address private _vault;

  function setVault(address vault_) external {
    _vault = vault_;
  }
  function vault() external view returns (address) {
    return _vault;
  }
}