// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";

/// @notice Allow to share declaration of ConverterStrategyBaseState with libraries
interface IConverterStrategyBase {
  struct ConverterStrategyBaseState {
    /// @dev Amount of underlying assets invested to the pool.
    uint investedAssets;

    /// @dev Linked Tetu Converter
    ITetuConverter converter;

    /// @notice Percent of asset amount that can be not invested, it's allowed to just keep it on balance
    ///         decimals = {DENOMINATOR}
    /// @dev We need this threshold to avoid numerous conversions of small amounts
    uint reinvestThresholdPercent;

    /// @notice reserve space for future needs
    uint[50] __gap;
  }
}