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

  /// @notice Emulate insurance. Cover possible amount of loss, leave leftovers uncovered
  function coverPossibleStrategyLoss(uint earned, uint lost) external {
    console.log("coverPossibleStrategyLoss.lost", lost);
    console.log("coverPossibleStrategyLoss.earned", earned);
    earned; // hide warning
    if (lost != 0) {
      require(_vault != address(0), "MockSplitterVault zero vault");
      require(_asset != address(0), "MockSplitterVault zero asset");
      uint balance = IERC20(_asset).balanceOf(address(this));
      console.log("coverPossibleStrategyLoss.balance", balance);
      IERC20(_asset).transfer(_vault, Math.min(lost, balance));
    }
  }
}