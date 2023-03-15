// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice TetuConverter sends callback notifications to its user via this interface
interface ITetuConverterCallback {
  /// @notice TetuConverter calls this function health factor is unhealthy and TetuConverter need more tokens to fix it.
  ///         The borrow must send either required collateral-asset amount OR required borrow-asset amount.
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param requiredAmountCollateralAsset_ What amount of collateral asset the Borrower should send to TetuConverter
  /// @param borrowAsset_ Borrow asset of the borrow to identify the borrow on the borrower's side
  /// @param requiredAmountBorrowAsset_ What amount of borrow asset the Borrower should send back to TetuConverter
  /// @return amountOut Exact amount that borrower has sent to balance of TetuConverter
  ///                   It should be equal to either to requiredAmountBorrowAsset_ or to requiredAmountCollateralAsset_
  /// @return isCollateral What is amountOut: true - collateral asset, false - borrow asset
  function requireAmountBack (
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address borrowAsset_,
    uint requiredAmountBorrowAsset_
  ) external returns (
    uint amountOut,
    bool isCollateral
  );

  /// @notice Converters calls this function if user should return some amount back.
  ///         f.e. when the health factor is unhealthy and the converter needs more tokens to fix it.
  ///         or when the full repay is required and converter needs to get full amount-to-repay.
  /// @param asset_ Required asset (either collateral or borrow)
  /// @param amount_ Required amount of the {asset_}
  /// @return amountOut Exact amount that borrower has sent to balance of TetuConverter
  function requirePayAmountBack(address asset_, uint amount_) external returns (uint amountOut);

  /// @notice TetuConverter calls this function when it makes additional borrow (using exist collateral).
  ///         The given amount has already be sent to balance of the user, the user just should use it.
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param borrowAsset_ Borrow asset of the borrow to identify the borrow on the borrower's side
  /// @param amountBorrowAssetSentToBorrower_ This amount has been sent to the borrower's balance
  function onTransferBorrowedAmount (
    address collateralAsset_,
    address borrowAsset_,
    uint amountBorrowAssetSentToBorrower_
  ) external;
}
