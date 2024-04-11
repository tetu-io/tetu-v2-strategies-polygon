// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

contract Univ3TokenSeller {
  //region ---------------------- Members
  /// @notice Token to be sold
  address public immutable tokenA;
  /// @notice Token to be withdrawn
  address public immutable tokenB;
  address public immutable pool;

  // todo delay for refreshPool
  // todo list of operators

  //endregion ---------------------- Members

  //region ---------------------- Errors
  error AlreadyOpened();

  //endregion ---------------------- Errors

  //region ---------------------- Events

  //endregion ---------------------- Events

  //region ---------------------- Constructor
  constructor (
    address tokenA_,
    address tokenB_,
    address pool_
  ) {
    tokenA = tokenA_;
    tokenB = tokenB_;
    pool = pool_;
  }
  //endregion ---------------------- Constructor

  //region ---------------------- View
  function balanceOf(address token) external view returns (uint) {
    return 0; // todo
  }

  function needToRefresh() public view returns (bool) {
    return false; // todo
  }

  function isPositionOpened() public view returns (bool) {
    return false; // todo
  }

  //endregion ---------------------- View

  //region ---------------------- Actions
  function openPosition(uint amountA) external {
    // todo only allowed contracts
    if (isPositionOpened()) revert AlreadyOpened();

    // todo enter to the pool with given amount of token A
  }

  function closePosition() external {
    // todo only allowed contracts
    if (isPositionOpened()) {
      // todo exit from the pool
    }
  }

  function refreshPool() external {
    // todo only allowed contracts
    if (needToRefresh()) {
      // todo exit from the pool
      // todo enter to the pool
      // todo withdraw token B
    }
  }

  function withdraw(address token, address receiver) external {
    // todo only allowed contracts

  }
  //endregion ---------------------- Actions
}