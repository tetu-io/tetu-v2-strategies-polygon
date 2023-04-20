// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../strategies/balancer/BalancerLogicLib.sol";

/// @notice Provide external access to all functions of BalancerLogicLib
contract BalancerLogicLibFacade {
  function getAmountsToDeposit(
    uint[] memory amountsDesired_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    uint[] memory totalUnderlying_,
    uint indexBpt_
  ) external view returns (
    uint[] memory amountsOut
  ) {
    return BalancerLogicLib.getAmountsToDeposit(amountsDesired_, tokens_, balances_, totalUnderlying_, indexBpt_);
  }

  function getTotalAssetAmounts(IBVault vault_, IERC20[] memory tokens_, uint indexBpt_) external view returns (
    uint[] memory amountsOut
  ) {
    return BalancerLogicLib.getTotalAssetAmounts(vault_, tokens_, indexBpt_);
  }

  function getBtpAmountsOut(
    uint liquidityAmount_,
    uint[] memory balances_,
    uint bptIndex_
  ) external pure returns (uint[] memory) {
    return BalancerLogicLib.getBtpAmountsOut(liquidityAmount_, balances_, bptIndex_);
  }
}
