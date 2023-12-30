// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x19194261d8f0599Bd079C52623C80C5150f010cF, events were removed
interface IKeomPriceOracle {
  function api3() external view returns (address);

  function api3Server() external view returns (address);

  function feeds(address) external view returns (bytes32);

  function getUnderlyingPrice(address kToken) external view returns (uint256 price);

  function heartbeats(bytes32) external view returns (uint256);

  function isPriceOracle() external view returns (bool);

  function kNative() external view returns (address);

  function owner() external view returns (address);

  function renounceOwnership() external;

  function setHeartbeat(address kToken, uint256 heartbeat) external;

  function setKNative(address _kNative) external;

  function setTokenId(address _kToken, bytes32 _tokenId, uint256 _heartbeat) external;

  function transferOwnership(address newOwner) external;

  function updateUnderlyingPrices(bytes[] memory) external pure;
}
