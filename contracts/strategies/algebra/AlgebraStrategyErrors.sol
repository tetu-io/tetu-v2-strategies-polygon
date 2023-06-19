// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library AlgebraStrategyErrors {

    string public constant NEED_REBALANCE = "AS-1 Need rebalance";
    string public constant WRONG_BALANCE = "AS-2 Wrong balance";
    string public constant INCORRECT_TICK_RANGE = "AS-3 Incorrect tickRange";
    string public constant INCORRECT_REBALANCE_TICK_RANGE = "AS-4 Incorrect rebalanceTickRange";
    string public constant INCORRECT_ASSET = "AS-5 Incorrect asset";
    string public constant WRONG_FEE = "AS-6 Wrong fee";
    string public constant WRONG_LIQUIDITY = "AS-7 Wrong liquidity";
    string public constant NO_REBALANCE_NEEDED = "AS-9 No rebalance needed";
    string public constant BALANCE_LOWER_THAN_FEE = "AS-10 Balance lower than fee";
    string public constant NOT_CALLBACK_CALLER = "AS-11 Not callback caller";
    string public constant UNKNOWN_SWAP_ROUTER = "AS-12 Unknown router";
    string public constant ZERO_PROFIT_HOLDER = "AS-13 Zero strategy profit holder";
}