// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface IComposableStablePool {
  function balanceOf(address account) external view returns (uint256);
  function getActualSupply() external view returns (uint256);
  function getPoolId() external view returns (bytes32);
  function getBptIndex() external view returns (uint256);

}