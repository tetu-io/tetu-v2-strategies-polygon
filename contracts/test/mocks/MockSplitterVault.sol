// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "hardhat/console.sol";

/// @notice Mock of ISplitter (only methods required for tests)
contract MockSplitterVault {
  address private _vault;
  address private _asset;
  address private _insurance;
  bool private _coverFromInsurance;

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

  function setInsurance(address insurance_) external {
    _insurance = insurance_;
  }
  function insurance() external view returns (address) {
    return _insurance;
  }

  function setCoverFromInsurance(bool value) external {
    _coverFromInsurance = value;
  }

  /// @notice Emulate insurance. Cover possible amount of loss, leave leftovers uncovered
  function coverPossibleStrategyLoss(uint earned, uint lost) external {
    console.log("MockSplitterVault.coverPossibleStrategyLoss.lost", lost);
    console.log("MockSplitterVault.coverPossibleStrategyLoss.earned", earned);
    earned; // hide warning
    if (lost != 0) {
      require(_vault != address(0), "MockSplitterVault zero vault");
      require(_asset != address(0), "MockSplitterVault zero asset");
      if (_coverFromInsurance) {
        uint balance = IERC20(_asset).balanceOf(_insurance);
        console.log("MockSplitterVault.coverPossibleStrategyLoss.balance.2", balance);
        IERC20(_asset).transferFrom(_insurance, _vault, Math.min(lost, balance));
      } else {
        uint balance = IERC20(_asset).balanceOf(address(this));
        console.log("MockSplitterVault.coverPossibleStrategyLoss.balance.1", balance);
        IERC20(_asset).transfer(_vault, Math.min(lost, balance));
      }
    }
  }
}