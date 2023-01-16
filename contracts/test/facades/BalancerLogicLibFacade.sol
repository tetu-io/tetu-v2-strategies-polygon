// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../strategies/balancer/BalancerLogicLib.sol";

/// @notice Provide external access to all functions of BalancerLogicLib
contract BalancerLogicLibFacade {
  /// @notice Calculate amounts of {tokens} to be deposited to POOL_ID in proportions according to the {balances}
  /// @param amountsDesiredABC_ Desired amounts of tokens A, B, C (i.e DAI, USDC, USDT)
  /// @param tokens All bb-am-* tokens (including bb-am-USD) received through getPoolTokens
  /// @param balances Balances of bb-am-* pools in terms of bb-am-USD tokens (received through getPoolTokens)
  /// @param bbAmUsdToken BB_AM_USD_TOKEN
  function getAmountsToDeposit(
    uint[] memory amountsDesiredABC_,
    IERC20[] memory tokens,
    uint[] memory balances,
    address bbAmUsdToken
  ) public view returns (uint[] memory) {
    return BalancerLogicLib.getAmountsToDeposit(amountsDesiredABC_, tokens, balances, bbAmUsdToken);
  }
}