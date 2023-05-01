// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface ILinearPool {
  function getPoolId() external view returns (bytes32);

  function getMainIndex() external view returns (uint);

  function getMainToken() external view returns (address);

  function getWrappedIndex() external view returns (uint);

  function getWrappedToken() external view returns (address);

  function getWrappedTokenRate() external view returns (uint);

  function getRate() external view returns (uint);

  function getBptIndex() external pure returns (uint);

  function getVirtualSupply() external view returns (uint);

  function getSwapFeePercentage() external view returns (uint);

  function getTargets() external view returns (uint lowerTarget, uint upperTarget);

  function totalSupply() external view returns (uint);

  function getScalingFactors() external view returns (uint[] memory);
}