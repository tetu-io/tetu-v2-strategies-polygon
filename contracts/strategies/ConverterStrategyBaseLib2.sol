// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyLib.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../libs/AppErrors.sol";
import "../libs/AppLib.sol";
import "../libs/TokenAmountsLib.sol";
import "../libs/ConverterEntryKinds.sol";

/// @notice Continuation of ConverterStrategyBaseLib (workaround for size limits)
library ConverterStrategyBaseLib2 {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        DATA TYPES
  /////////////////////////////////////////////////////////////////////

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  uint internal constant DENOMINATOR = 100_000;

  /////////////////////////////////////////////////////////////////////
  ///                        MAIN LOGIC
  /////////////////////////////////////////////////////////////////////

  /// @notice Get balances of the {tokens_} except balance of the token at {indexAsset} position
  function getAvailableBalances(
    address[] memory tokens_,
    uint indexAsset
  ) external view returns (uint[] memory) {
    uint len = tokens_.length;
    uint[] memory amountsToConvert = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) continue;
      amountsToConvert[i] = IERC20(tokens_[i]).balanceOf(address(this));
    }
    return amountsToConvert;
  }
  /// @notice Send {performanceFee_} of {rewardAmounts_} to {performanceReceiver}
  /// @param performanceFee_ Max is FEE_DENOMINATOR
  /// @return rewardAmounts = rewardAmounts_ - performanceAmounts
  /// @return performanceAmounts Theses amounts were sent to {performanceReceiver_}
  function sendPerformanceFee(
    uint performanceFee_,
    address performanceReceiver_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) external returns (
    uint[] memory rewardAmounts,
    uint[] memory performanceAmounts
  ) {
    // we assume that performanceFee_ <= FEE_DENOMINATOR and we don't need to check it here
    uint len = rewardAmounts_.length;
    rewardAmounts = new uint[](len);
    performanceAmounts = new uint[](len);

    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      performanceAmounts[i] = rewardAmounts_[i] * performanceFee_ / DENOMINATOR;
      rewardAmounts[i] = rewardAmounts_[i] - performanceAmounts[i];
      IERC20(rewardTokens_[i]).safeTransfer(performanceReceiver_, performanceAmounts[i]);
    }
  }

  function sendTokensToForwarder(
    address controller_,
    address splitter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) external {
    uint len = tokens_.length;
    IForwarder forwarder = IForwarder(IController(controller_).forwarder());
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      AppLib.approveIfNeeded(tokens_[i], amounts_[i], address(forwarder));
    }

    forwarder.registerIncome(tokens_, amounts_, ISplitter(splitter_).vault(), true);
  }
}

