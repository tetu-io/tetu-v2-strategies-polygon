// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

library PancakeStrategyErrors {

  string public constant NEED_REBALANCE = "PS-1 Need rebalance";
  string public constant WRONG_BALANCE = "PS-2 Wrong balance";
  string public constant INCORRECT_TICK_RANGE = "PS-3 Incorrect tickRange";
  string public constant INCORRECT_REBALANCE_TICK_RANGE = "PS-4 Incorrect rebalanceTickRange";
  string public constant INCORRECT_ASSET = "PS-5 Incorrect asset";
  string public constant WRONG_FEE = "PS-6 Wrong fee";
  string public constant WRONG_LIQUIDITY = "PS-7 Wrong liquidity";
  string public constant WRONG_FILLUP = "PS-8 Wrong fillup";
  string public constant NO_REBALANCE_NEEDED = "PS-9 No rebalance needed";
  string public constant BALANCE_LOWER_THAN_FEE = "PS-10 Balance lower than fee";
  string public constant NOT_CALLBACK_CALLER = "PS-11 Not callback caller";
  string public constant ZERO_PROFIT_HOLDER = "PS-13 Zero strategy profit holder";
  string public constant FUSE_IS_ACTIVE = "PS-14 Fuse is active";

}
