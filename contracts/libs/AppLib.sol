// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";

/// @notice Common internal utils
library AppLib {
  using SafeERC20 for IERC20;

  /// @notice 1% gap to cover possible liquidation inefficiency
  /// @dev We assume that: conversion-result-calculated-by-prices - liquidation-result <= the-gap
  uint internal constant GAP_CONVERSION = 1_000;
  /// @dev Absolute value for any token
  uint internal constant DEFAULT_LIQUIDATION_THRESHOLD = 100_000;
  uint internal constant DENOMINATOR = 100_000;

  /// @notice Any amount less than the following is dust
  uint public constant DUST_AMOUNT_TOKENS = 100;

  /// @notice Unchecked increment for for-cycles
  function uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

  /// @notice Make infinite approve of {token} to {spender} if the approved amount is less than {amount}
  /// @dev Should NOT be used for third-party pools
  function approveIfNeeded(address token, uint amount, address spender) internal {
    if (IERC20(token).allowance(address(this), spender) < amount) {
      // infinite approve, 2*255 is more gas efficient then type(uint).max
      IERC20(token).approve(spender, 2 ** 255);
    }
  }

  /// @notice Make approve of {token} to unsafe {spender} (like an aggregator) for fixed {amount}
  function approveForced(address token, uint amount, address spender) internal {
    IERC20(token).approve(spender, amount);
  }

  function balance(address token) internal view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  /// @return prices Asset prices in USD, decimals 18
  /// @return decs 10**decimals
  function _getPricesAndDecs(IPriceOracle priceOracle, address[] memory tokens_, uint len) internal view returns (
    uint[] memory prices,
    uint[] memory decs
  ) {
    prices = new uint[](len);
    decs = new uint[](len);
    {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        decs[i] = 10 ** IERC20Metadata(tokens_[i]).decimals();
        prices[i] = priceOracle.getAssetPrice(tokens_[i]);
      }
    }
  }

  /// @notice Find index of the given {asset_} in array {tokens_}, return type(uint).max if not found
  function getAssetIndex(address[] memory tokens_, address asset_) internal pure returns (uint) {
    uint len = tokens_.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (tokens_[i] == asset_) {
        return i;
      }
    }
    return type(uint).max;
  }

  function _getLiquidator(address controller_) internal view returns (ITetuLiquidator) {
    return ITetuLiquidator(IController(controller_).liquidator());
  }

  function _getPriceOracle(ITetuConverter converter_) internal view returns (IPriceOracle) {
    return IPriceOracle(IConverterController(converter_.controller()).priceOracle());
  }

  /// @notice Calculate liquidation threshold, use default value if the threshold is not set
  ///         It's allowed to set any not-zero threshold, it this case default value is not used
  /// @dev This function should be applied to the threshold at the moment of the reading its value from the storage.
  ///      So, if we pass {mapping(address => uint) storage liquidationThresholds}, the threshold can be zero
  ///      bug if we pass {uint liquidationThreshold} to a function, the threshold should be not zero
  function _getLiquidationThreshold(uint threshold) internal pure returns (uint) {
    return threshold == 0
      ? AppLib.DEFAULT_LIQUIDATION_THRESHOLD
      : threshold;
  }

  /// @notice Return a-b OR zero if a < b
  function sub0(uint a, uint b) internal pure returns (uint) {
    return a > b ? a - b : 0;
  }
}
