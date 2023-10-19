// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

library KyberStrategyErrors {

  string public constant NEED_REBALANCE = "KS-1 Need rebalance";
  string public constant WRONG_BALANCE = "KS-2 Wrong balance";
  string public constant INCORRECT_TICK_RANGE = "KS-3 Incorrect tickRange";
  string public constant INCORRECT_REBALANCE_TICK_RANGE = "KS-4 Incorrect rebalanceTickRange";
  string public constant INCORRECT_ASSET = "KS-5 Incorrect asset";
  string public constant WRONG_FEE = "KS-6 Wrong fee";
  string public constant WRONG_LIQUIDITY = "KS-7 Wrong liquidity";
  string public constant NO_REBALANCE_NEEDED = "KS-9 No rebalance needed";
  string public constant BALANCE_LOWER_THAN_FEE = "KS-10 Balance lower than fee";
  string public constant NOT_CALLBACK_CALLER = "KS-11 Not callback caller";
  string public constant ZERO_PROFIT_HOLDER = "KS-13 Zero strategy profit holder";
  string public constant NOT_UNSTAKED = "KS-14 Liquidity must be unstaked";
  string public constant FUSE_IS_ACTIVE = "KS-14 Fuse is active";
}
