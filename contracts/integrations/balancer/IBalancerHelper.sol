// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./IBVault.sol";

interface IBalancerHelper {
  function queryExit(
    bytes32 poolId,
    address sender,
    address recipient,
    IBVault.ExitPoolRequest memory request
  ) external returns (uint256 bptIn, uint256[] memory amountsOut);

  function queryJoin(
    bytes32 poolId,
    address sender,
    address recipient,
    IBVault.JoinPoolRequest memory request
  ) external returns (uint256 bptOut, uint256[] memory amountsIn);

  function vault() external view returns (address);
}
