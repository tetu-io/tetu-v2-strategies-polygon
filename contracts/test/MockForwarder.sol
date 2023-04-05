// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "hardhat/console.sol";

contract MockForwarder {
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
    console.log("registerIncome", gasleft());
    lastRegisterIncomeTokens = tokens;
    lastRegisterIncomeAmounts = amounts;
    // move all tokens to the balance of the IForwarder
    for (uint i = 0; i < tokens.length; ++i) {
      IERC20(tokens[i]).transferFrom(msg.sender, address(this), amounts[i]);
    }
    vault;
    isDistribute;
    console.log("registerIncome.end", gasleft());
  }

  function getLastRegisterIncomeResults() external view returns (
    address[] memory tokens,
    uint[] memory amounts
  ) {
    return (lastRegisterIncomeTokens, lastRegisterIncomeAmounts);
  }

  function distributeAll(address destination) external pure {
    destination;
  }

  function distribute(address token) external pure {
    token;
  }

  function setInvestFundRatio(uint value) external pure {
    value;
  }

  function setGaugesRatio(uint value) external pure {
    value;
  }

  function supportsInterface(bytes4) public pure returns (bool) {
    return true;
  }
}
