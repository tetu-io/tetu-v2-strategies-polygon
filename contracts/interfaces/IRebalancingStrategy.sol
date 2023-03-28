// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IRebalancingStrategy {
    function needRebalance() external view returns (bool);
    function rebalance() external;
}
