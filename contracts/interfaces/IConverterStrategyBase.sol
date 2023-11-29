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

    /// @notice Current debt to the insurance.
    ///         It's increased when insurance covers any losses related to swapping and borrow-debts-paying.
    ///         It's not changed when insurance covers losses/receives profit that appeared after price changing.
    ///         The strategy covers this debt on each hardwork using the profit (rewards, fees)
    int debtToInsurance;

    /// @notice reserve space for future needs
    uint[50-1] __gap;
  }
}