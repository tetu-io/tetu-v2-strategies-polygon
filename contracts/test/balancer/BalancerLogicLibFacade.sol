// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../strategies/balancer/BalancerLogicLib.sol";

/// @notice Provide external access to all functions of BalancerLogicLib
contract BalancerLogicLibFacade {
  function getAmountsToDeposit(
    uint[] memory amountsDesiredABC_,
    IERC20[] memory tokens,
    uint[] memory balances,
    address bbAmUsdToken
  ) external view returns (
    uint[] memory amountsToDepositOut
  ) {
    return BalancerLogicLib.getAmountsToDeposit(amountsDesiredABC_, tokens, balances, bbAmUsdToken);
  }

  function getAssetIndex(
    uint startIndex0_,
    IERC20[] memory tokens_,
    address asset_,
    uint lengthTokens_
  ) external pure returns (uint) {
    return BalancerLogicLib.getAssetIndex(startIndex0_, tokens_, asset_, lengthTokens_);
  }
}