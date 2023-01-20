// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

/// @notice ChildChainLiquidityGaugeFactory, restored for 0x3b8cA519122CdD8efb272b0D3085453404B25bD0
/// @dev See https://dev.balancer.fi/resources/vebal-and-gauges/gauges
interface IChildChainLiquidityGaugeFactory {
  event RewardsOnlyGaugeCreated(
    address indexed gauge,
    address indexed pool,
    address streamer
  );

  function create(address pool) external returns (address);

  function getChildChainStreamerImplementation() external view returns (address);
  function getGaugeImplementation() external view returns (address);
  function getGaugePool(address gauge) external view returns (address);
  function getGaugeStreamer(address gauge) external view returns (address);
  function getPoolGauge(address pool) external view returns (address);
  function getPoolStreamer(address pool) external view returns (address);
  function isGaugeFromFactory(address gauge) external view returns (bool);
  function isStreamerFromFactory(address streamer) external view returns (bool);
}

