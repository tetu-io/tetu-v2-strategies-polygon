// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IFarmingStrategy {
  function canFarm() external view returns (bool);
}
