// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface ILinearPoolRebalancer {
  function getPool() external view returns (address);
  function rebalance(address recipient) external returns (uint256);
  function rebalanceWithExtraMain(address recipient, uint256 extraMain) external returns (uint256);
}