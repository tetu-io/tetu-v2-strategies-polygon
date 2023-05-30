// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library AlgebraStrategyErrors {

    string public constant NEED_REBALANCE = "Q3S-1 Need rebalance";
    string public constant WRONG_BALANCE = "Q3S-2 Wrong balance";
    string public constant INCORRECT_TICK_RANGE = "Q3S-3 Incorrect tickRange";
    string public constant INCORRECT_REBALANCE_TICK_RANGE = "Q3S-4 Incorrect rebalanceTickRange";
    string public constant INCORRECT_ASSET = "Q3S-5 Incorrect asset";
    string public constant WRONG_FEE = "Q3S-6 Wrong fee";
    string public constant WRONG_LIQUIDITY = "Q3S-7 Wrong liquidity";
    string public constant WRONG_FILLUP = "Q3S-8 Wrong fillup";
    string public constant NO_REBALANCE_NEEDED = "Q3S-9 No rebalance needed";
    string public constant BALANCE_LOWER_THAN_FEE = "Q3S-10 Balance lower than fee";
    string public constant NOT_CALLBACK_CALLER = "Q3S-11 Not callback caller";
    string public constant UNKNOWN_SWAP_ROUTER = "Q3S-12 Unknown router";
    
}