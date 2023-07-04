// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IRebalancingV2Strategy {
    function needRebalance() external view returns (bool);
    function rebalanceNoSwaps(bool checkNeedRebalance) external returns (bool);
}
