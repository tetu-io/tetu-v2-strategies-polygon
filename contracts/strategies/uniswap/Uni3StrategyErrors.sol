// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library Uni3StrategyErrors {

  string public constant NEED_REBALANCE = "U3S-1 Need rebalance";
  string public constant WRONG_BALANCE = "U3S-2 Wrong balance";
  string public constant INCORRECT_TICK_RANGE = "U3S-3 Incorrect tickRange";
  string public constant INCORRECT_REBALANCE_TICK_RANGE = "U3S-4 Incorrect rebalanceTickRange";
  string public constant INCORRECT_ASSET = "U3S-5 Incorrect asset";
  string public constant WRONG_FEE = "U3S-6 Wrong fee";
  string public constant WRONG_LIQUIDITY = "U3S-7 Wrong liquidity";
  string public constant WRONG_FILLUP = "U3S-8 Wrong fillup";
  string public constant NO_REBALANCE_NEEDED = "U3S-9 No rebalance needed";
  string public constant BALANCE_LOWER_THAN_FEE = "U3S-10 Balance lower than fee";
  string public constant NOT_CALLBACK_CALLER = "U3S-11 Not callback caller";
  string public constant ZERO_PROFIT_HOLDER = "U3S-13 Zero strategy profit holder";

}
