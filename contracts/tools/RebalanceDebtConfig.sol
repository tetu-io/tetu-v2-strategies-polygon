// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";

contract RebalanceDebtConfig {
    string public constant VERSION = "1.0.0";
    uint public constant PERCENT_DENOMINATOR = 100_00;

    struct Config {
        uint lockedPercentForDelayedRebalance;
        uint lockedPercentForForcedRebalance;
        uint rebalanceDebtDelay;
    }

    IController public controller;
    mapping(address => Config) public strategyConfig;
    mapping(address => bool) public operators;

    constructor(address controller_) {
        controller = IController(controller_);
    }

    function setConfig(
        address strategy,
        uint lockedPercentForDelayedRebalance,
        uint lockedPercentForForcedRebalance,
        uint rebalanceDebtDelay
    ) external {
        require(controller.isOperator(msg.sender), "RDC: denied");

        strategyConfig[strategy] = Config(
            lockedPercentForDelayedRebalance,
            lockedPercentForForcedRebalance,
            rebalanceDebtDelay
        );
    }
}