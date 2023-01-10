// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./AppDataTypes.sol";

/// @notice Adapter for lending platform attached to the given platform's pool.
interface IPlatformAdapter {

  /// @notice Get pool data required to select best lending pool
  /// @param collateralAmount_ Amount of collateral. We need it to calculate rewards and APRs correctly.
  /// @param healthFactor2_ Health factor (decimals 2) to be able to calculate max borrow amount
  /// @param countBlocks_ Estimated period of the borrow in blocks.
  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint16 healthFactor2_,
    uint countBlocks_
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  );

  /// @notice Full list of supported converters
  function converters() external view returns (address[] memory);

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external;

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view returns (uint);

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  function frozen() external view returns (bool);

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external;
}
