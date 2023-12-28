// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from implementation 0x73D8A3bF62aACa6690791E57EBaEE4e1d875d8Fe
/// of 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C
interface IMoonwellComptroller {
  event ActionPaused(string action, bool pauseState);
  event ActionPaused(address mToken, string action, bool pauseState);
  event Failure(uint256 error, uint256 info, uint256 detail);
  event MarketEntered(address mToken, address account);
  event MarketExited(address mToken, address account);
  event MarketListed(address mToken);
  event NewBorrowCap(address indexed mToken, uint256 newBorrowCap);
  event NewBorrowCapGuardian(
    address oldBorrowCapGuardian,
    address newBorrowCapGuardian
  );
  event NewCloseFactor(
    uint256 oldCloseFactorMantissa,
    uint256 newCloseFactorMantissa
  );
  event NewCollateralFactor(
    address mToken,
    uint256 oldCollateralFactorMantissa,
    uint256 newCollateralFactorMantissa
  );
  event NewLiquidationIncentive(
    uint256 oldLiquidationIncentiveMantissa,
    uint256 newLiquidationIncentiveMantissa
  );
  event NewPauseGuardian(address oldPauseGuardian, address newPauseGuardian);
  event NewPriceOracle(address oldPriceOracle, address newPriceOracle);
  event NewRewardDistributor(
    address oldRewardDistributor,
    address newRewardDistributor
  );
  event NewSupplyCap(address indexed mToken, uint256 newSupplyCap);
  event NewSupplyCapGuardian(
    address oldSupplyCapGuardian,
    address newSupplyCapGuardian
  );

  function _become(address unitroller) external;

  function _rescueFunds(address _tokenAddress, uint256 _amount) external;

  function _setBorrowCapGuardian(address newBorrowCapGuardian) external;

  function _setBorrowPaused(address mToken, bool state)
  external
  returns (bool);

  function _setCloseFactor(uint256 newCloseFactorMantissa)
  external
  returns (uint256);

  function _setCollateralFactor(
    address mToken,
    uint256 newCollateralFactorMantissa
  ) external returns (uint256);

  function _setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa)
  external
  returns (uint256);

  function _setMarketBorrowCaps(
    address[] memory mTokens,
    uint256[] memory newBorrowCaps
  ) external;

  function _setMarketSupplyCaps(
    address[] memory mTokens,
    uint256[] memory newSupplyCaps
  ) external;

  function _setMintPaused(address mToken, bool state) external returns (bool);

  function _setPauseGuardian(address newPauseGuardian)
  external
  returns (uint256);

  function _setPriceOracle(address newOracle) external returns (uint256);

  function _setRewardDistributor(address newRewardDistributor) external;

  function _setSeizePaused(bool state) external returns (bool);

  function _setSupplyCapGuardian(address newSupplyCapGuardian) external;

  function _setTransferPaused(bool state) external returns (bool);

  function _supportMarket(address mToken) external returns (uint256);

  function accountAssets(address, uint256) external view returns (address);

  function admin() external view returns (address);

  function allMarkets(uint256) external view returns (address);

  function borrowAllowed(
    address mToken,
    address borrower,
    uint256 borrowAmount
  ) external returns (uint256);

  function borrowCapGuardian() external view returns (address);

  function borrowCaps(address) external view returns (uint256);

  function borrowGuardianPaused(address) external view returns (bool);

  function checkMembership(address account, address mToken) external view returns (bool);

  function claimReward(address[] memory holders, address[] memory mTokens, bool borrowers, bool suppliers) external;

  /// @notice Claim all the WELL accrued by holder in the specified markets
  /// @param holder The address to claim WELL for
  /// @param mTokens The list of markets to claim WELL in
  function claimReward(address holder, address[] memory mTokens) external;

  function claimReward() external;

  function claimReward(address holder) external;

  function closeFactorMantissa() external view returns (uint256);

  function comptrollerImplementation() external view returns (address);

  /// @notice Add assets to be included in account liquidity calculation
  /// @param mTokens The list of addresses of the mToken markets to be enabled
  /// @return Success indicator for whether each corresponding market was entered
  function enterMarkets(address[] memory mTokens) external returns (uint256[] memory);

  /// @notice Removes asset from sender's account liquidity calculation
  /// @dev Sender must not have an outstanding borrow balance in the asset,
  /// or be providing necessary collateral for an outstanding borrow.
  /// @param mTokenAddress The address of the asset to be removed
  /// @return Whether or not the account successfully exited the market
  function exitMarket(address mTokenAddress) external returns (uint256);

  /// @notice Determine the current account liquidity wrt collateral requirements
  /// @return errorCode possible error code (semi-opaque)
  /// @return liquidity Account liquidity in excess of collateral requirements,
  /// @return shortfall Account shortfall below collateral requirements)
  function getAccountLiquidity(address account) external view returns (
    uint256 errorCode,
    uint256 liquidity,
    uint256 shortfall
  );

  function getAllMarkets() external view returns (address[] memory);

  function getAssetsIn(address account) external view returns (address[] memory);

  function getBlockTimestamp() external view returns (uint256);

  /// @notice Determine the current account liquidity wrt collateral requirements
  /// @return errorCode possible error code
  /// @return liquidity account liquidity in excess of collateral requirements
  /// @return shortfall account shortfall below collateral requirements
  function getHypotheticalAccountLiquidity(
    address account,
    address mTokenModify,
    uint256 redeemTokens,
    uint256 borrowAmount
  )
  external view returns (uint256 errorCode, uint256 liquidity, uint256 shortfall);

  function isComptroller() external view returns (bool);

  function liquidateBorrowAllowed(
    address mTokenBorrowed,
    address mTokenCollateral,
    address liquidator,
    address borrower,
    uint256 repayAmount
  ) external view returns (uint256);

  function liquidateCalculateSeizeTokens(
    address mTokenBorrowed,
    address mTokenCollateral,
    uint256 actualRepayAmount
  ) external view returns (uint256, uint256);

  function liquidationIncentiveMantissa() external view returns (uint256);

  function markets(address) external view returns (bool isListed, uint256 collateralFactorMantissa);

  function mintAllowed(address mToken, address minter,uint256 mintAmount) external returns (uint256);

  function mintGuardianPaused(address) external view returns (bool);

  function oracle() external view returns (address);

  function pauseGuardian() external view returns (address);

  function pendingAdmin() external view returns (address);

  function pendingComptrollerImplementation() external view returns (address);

  function redeemAllowed(address mToken, address redeemer, uint256 redeemTokens) external returns (uint256);

  function redeemVerify(
    address mToken,
    address redeemer,
    uint256 redeemAmount,
    uint256 redeemTokens
  ) external pure;

  function repayBorrowAllowed(
    address mToken,
    address payer,
    address borrower,
    uint256 repayAmount
  ) external returns (uint256);

  function rewardDistributor() external view returns (address);

  function seizeAllowed(
    address mTokenCollateral,
    address mTokenBorrowed,
    address liquidator,
    address borrower,
    uint256 seizeTokens
  ) external returns (uint256);

  function seizeGuardianPaused() external view returns (bool);

  function supplyCapGuardian() external view returns (address);

  function supplyCaps(address) external view returns (uint256);

  function transferAllowed(address mToken, address src, address dst, uint256 transferTokens) external returns (uint256);

  function transferGuardianPaused() external view returns (bool);
}

