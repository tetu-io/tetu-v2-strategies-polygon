// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface ILinearPool {
  function getPoolId() external view returns (bytes32);

  function getMainIndex() external view returns (uint256);

  function getMainToken() external view returns (address);

  function getWrappedIndex() external view returns (uint256);

  function getWrappedToken() external view returns (address);

  function getWrappedTokenRate() external view returns (uint256);
}