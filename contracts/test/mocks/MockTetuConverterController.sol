// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract MockTetuConverterController {
  address public priceOracle;
  address public accountant;

  constructor(address priceOracle_) {
    priceOracle = priceOracle_;
  }

  function setAccountant(address accountant_) external {
    accountant = accountant_;
  }
}
