// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice List of all errors generated by the application
///         Each error should have unique code TS-XXX and descriptive comment
library AppErrors {
  /// @notice Provided address should be not zero
  string public constant ZERO_ADDRESS = "TS-1 zero address";

  /// @notice A pair of the tokens cannot be found in the factory of uniswap pairs
  string public constant UNISWAP_PAIR_NOT_FOUND = "TS-2 pair not found";

  /// @notice Lengths not matched
  string public constant WRONG_LENGTHS = "TS-4 wrong lengths";

  /// @notice Unexpected zero balance
  string public constant ZERO_BALANCE = "TS-5 zero balance";

  string public constant ITEM_NOT_FOUND = "TS-6 not found";

  string public constant NOT_ENOUGH_BALANCE = "TS-7 not enough balance";

  /// @notice Price oracle returns zero price
  string public constant ZERO_PRICE = "TS-8 zero price";

  string public constant WRONG_VALUE = "TS-9 wrong value";

  /// @notice TetuConvertor wasn't able to make borrow, i.e. borrow-strategy wasn't found
  string public constant ZERO_AMOUNT_BORROWED = "TS-10 zero borrowed amount";

  string public constant WITHDRAW_TOO_MUCH = "TS-11 try to withdraw too much";

  string public constant UNKNOWN_ENTRY_KIND = "TS-12 unknown entry kind";

  string public constant ONLY_TETU_CONVERTER = "TS-13 only TetuConverter";

  string public constant WRONG_ASSET = "TS-14 wrong asset";

  string public constant NO_LIQUIDATION_ROUTE = "TS-15 No liquidation route";

  string public constant PRICE_IMPACT = "TS-16 price impact";

  /// @notice tetuConverter_.repay makes swap internally. It's not efficient and not allowed
  string public constant REPAY_MAKES_SWAP = "TS-17 can not convert back";

  string public constant NO_INVESTMENTS = "TS-18 no investments";

  string public constant INCORRECT_LENGTHS = "TS-19 lengths";

  /// @notice We expect increasing of the balance, but it was decreased
  string public constant BALANCE_DECREASE = "TS-20 balance decrease";

  /// @notice Prices changed and invested assets amount was increased on S, value of S is too high
  string public constant EARNED_AMOUNT_TOO_HIGH = "TS-21 earned too high";

  string public constant GOVERNANCE_ONLY = "TS-22 governance only";

  /// @notice BorrowLib has recursive call, sub-calls are not allowed
  ///         This error can happen if allowed proportion is too small, i.e. 0.0004 : (1-0.0004)
  ///         Such situation can happen if amount to swap is almost equal to the amount of the token in the current tick,
  ///         so swap will move us close to the border between ticks.
  ///         It was decided, that it's ok to have revert in that case
  ///         We can change this behavior by changing BorrowLib.rebalanceRepayBorrow implementation:
  ///             if amount-to-repay passed to _repayDebt is too small to be used,
  ///             we should increase it min amount required to make repay successfully (amount must be > threshold)
  string public constant NOT_ALLOWED = "TS-23 not allowed";

  string public constant ZERO_VALUE = "TS-24 zero value";

  string public constant INCORRECT_SWAP_BY_AGG_PARAM = "TS-25 swap by agg";

  string public constant OVER_COLLATERAL_DETECTED = "TS-27 over-collateral";

  string public constant NOT_IMPLEMENTED = "TS-28 not implemented";

  /// @notice You are not allowed to make direct debt if a NOT-DUST reverse debt exists and visa verse.
  string public constant OPPOSITE_DEBT_EXISTS = "TS-29 opposite debt exists";

  string public constant INVALID_VALUE = "TS-30 invalid value";

  string public constant TOO_DEEP_RECURSION_SECOND_REPAY = "TS-31 recursion too deep";

  string public constant TOO_HIGH = "TS-32 too high value";
}
