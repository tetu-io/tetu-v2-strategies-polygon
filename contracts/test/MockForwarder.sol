// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";

contract MockForwarder is IForwarder {
  address[] private lastRegisterIncomeTokens;
  uint[] private lastRegisterIncomeAmounts;

  function tokenPerDestinationLength(address destination) external pure returns (uint) {
    destination;
    return 0;
  }

  function tokenPerDestinationAt(address destination, uint i) external pure returns (address) {
    destination;
    i;

    return address(0);
  }

  function registerIncome(
    address[] memory tokens,
    uint[] memory amounts,
    address vault,
    bool isDistribute
  ) external {
    lastRegisterIncomeTokens = tokens;
    lastRegisterIncomeAmounts = amounts;
    vault;
    isDistribute;
  }

  function getLastRegisterIncomeResults() external view returns (
    address[] memory tokens,
    uint[] memory amounts
  ) {
    return (lastRegisterIncomeTokens, lastRegisterIncomeAmounts);
  }

  function distributeAll(address destination) external {
    destination;
  }

  function distribute(address token) external {
    token;
  }

  function setInvestFundRatio(uint value) external {
    value;
  }

  function setGaugesRatio(uint value) external {
    value;
  }

  function supportsInterface(bytes4) public pure returns (bool) {
    return true;
  }
}