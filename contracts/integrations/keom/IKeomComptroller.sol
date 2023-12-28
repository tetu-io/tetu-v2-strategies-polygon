// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0xc145700AC0d8A59B1f64DcE35687dD7CA2BEB26A, events were removed
interface IKeomComptroller {
  function _become(address unitroller) external;
  function _borrowGuardianPaused() external view returns (bool);
  function _grantReward(address recipient, uint256 amount) external;
  function _mintGuardianPaused() external view returns (bool);
  function _setBorrowPaused(address kToken, bool state) external returns (bool);

  function _setCloseFactor(uint256 newCloseFactorMantissa) external  returns (uint256);

  function _setCollateralFactor(address kToken, uint256 newCollateralFactorMantissa) external returns (uint256);

  function _setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa) external returns (uint256);

  function _setMarketBorrowCaps(address[] memory kTokens, uint256[] memory newBorrowCaps) external;

  function _setMarketSupplyCaps(address[] memory kTokens, uint256[] memory newSupplyCaps) external;

  function _setMintPaused(address kToken, bool state) external returns (bool);

  function _setPauseGuardian(address newPauseGuardian) external returns (uint256);

  function _setPriceOracle(address newOracle) external returns (uint256);

  function _setRedeemPaused(address kToken, bool state) external returns (bool);

  function _setRepayPaused(address kToken, bool state) external returns (bool);

  function _setRewardSpeeds(address[] memory kTokens, uint256[] memory supplySpeeds, uint256[] memory borrowSpeeds) external;

  function _setSeizePaused(bool state) external returns (bool);

  function _setTransferPaused(bool state) external returns (bool);

  function _supportMarket(address kToken, bool _autoCollaterize) external returns (uint256);

  function accountAssets(address, uint256) external view returns (address);

  function accountMembership(address, address) external view returns (bool);

  function admin() external view returns (address);

  function allMarkets(uint256) external view returns (address);

  function boostManager() external view returns (address);

  function borrowAllowed(address kToken, address borrower, uint256 borrowAmount) external returns (uint256);

  function borrowCaps(address) external view returns (uint256);

  function borrowState(address) external view returns (uint224 index, uint32 timestamp);

  function capGuardian() external view returns (address);

  function checkMembership(address account, address kToken) external view returns (bool);

  function closeFactorMantissa() external view returns (uint256);

  function compRate() external view returns (uint256);

  function comptrollerImplementation() external view returns (address);

  function enterMarkets(address[] memory kTokens) external returns (uint256[] memory);

  function exitMarket(address kTokenAddress) external returns (uint256);

  function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);

  function getAllMarkets() external view returns (address[] memory);

  function getAssetsIn(address account) external view returns (address[] memory);

  function getBoostManager() external view returns (address);

  function getHypotheticalAccountLiquidity(address account, address kTokenModify, uint256 redeemTokens, uint256 borrowAmount)
  external view returns (uint256, uint256, uint256, uint256);

  function getKeomAddress() external view returns (address);

  function getTimestamp() external view returns (uint256);

  function guardianPaused(address) external view returns (bool mint, bool borrow, bool redeem, bool repay);

  function isComptroller() external view returns (bool);

  function isDeprecated(address kToken) external view returns (bool);

  function isMarket(address kToken) external view returns (bool);

  function keom() external view returns (address);

  function lastContributorTimestamp(address) external view returns (uint256);

  function liquidateBorrowAllowed(address kTokenBorrowed, address kTokenCollateral, address liquidator, address borrower, uint256 repayAmount) external view returns (uint256, uint256);

  function liquidateCalculateSeizeTokens(address kTokenBorrowed, address kTokenCollateral, uint256 actualRepayAmount, uint256 dynamicLiquidationIncentive) external view returns (uint256, uint256);

  function liquidationIncentiveMantissa() external view returns (uint256);

  function marketInitialIndex() external view returns (uint224);

  function markets(address) external view returns (bool isListed, bool autoCollaterize, uint256 collateralFactorMantissa);

  function maxAssets() external view returns (uint256);

  function mintAllowed(address kToken, address minter, uint256 mintAmount) external returns (uint256);

  function oracle() external view returns (address);

  function pauseGuardian() external view returns (address);

  function pendingAdmin() external view returns (address);

  function pendingComptrollerImplementation() external view returns (address);

  function redeemAllowed(address kToken, address redeemer, uint256 redeemTokens) external returns (uint256);

  function redeemVerify(address kToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens) external pure;

  function repayBorrowAllowed(address kToken, address payer, address borrower, uint256 repayAmount) external returns (uint256);

  function rewardAccrued(address) external view returns (uint256);

  function rewardBorrowSpeeds(address) external view returns (uint256);

  function rewardBorrowerIndex(address, address) external view returns (uint256);

  function rewardContributorSpeeds(address) external view returns (uint256);

  function rewardManager() external view returns (address);

  function rewardReceivable(address) external view returns (uint256);

  function rewardSpeeds(address) external view returns (uint256);

  function rewardSupplierIndex(address, address) external view returns (uint256);

  function rewardSupplySpeeds(address) external view returns (uint256);

  function rewardUpdater() external view returns (address);

  function seizeAllowed(address kTokenCollateral, address kTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) external returns (uint256);

  function seizeGuardianPaused() external view returns (bool);

  function setAutoCollaterize(address market, bool flag) external;

  function setBoostManager(address newBoostManager) external;

  function setKeomAddress(address newKeomAddress) external;

  function setProtocolPaused(bool _paused) external;

  function setRewardUpdater(address _rewardUpdater) external;

  function supplyCaps(address) external view returns (uint256);

  function supplyState(address) external view returns (uint224 index, uint32 timestamp);

  function transferAllowed(address kToken, address src, address dst, uint256 transferTokens) external returns (uint256);

  function transferGuardianPaused() external view returns (bool);

  function updateAndDistributeBorrowerRewardsForToken(address kToken, address borrower) external;

  function updateAndDistributeSupplierRewardsForToken(address kToken, address account) external;

  function updateContributorRewards(address contributor) external;

  receive() external payable;
}