// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface ILinearPoolSimple{
  function getMainToken() external view returns (address);
  function getWrappedToken() external view returns (address);
  function getPoolId() external view returns (bytes32);
  function getVault() external view returns (address);
  function getTargets() external view returns (uint256 lowerTarget, uint256 upperTarget);
  function getMainIndex() external view returns (uint256);
  function getWrappedIndex() external view returns (uint256);

}