// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract MockTetuConverterController {
  address public priceOracle;
  address public bookkeeper;

  constructor(address priceOracle_) {
    priceOracle = priceOracle_;
  }

  function setBookkeeper(address bookkeeper_) external {
    bookkeeper = bookkeeper_;
  }
}
