// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Mock of ISplitter (only methods required for tests)
contract MockSplitterVault {
  address private _vault;
  address private _asset;

  function setVault(address vault_) external {
    _vault = vault_;
  }
  function vault() external view returns (address) {
    return _vault;
  }

  function setAsset(address asset_) external {
    _asset = asset_;
  }
  function asset() external view returns (address) {
    return _asset;
  }
}