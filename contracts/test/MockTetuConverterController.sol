// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract MockTetuConverterController {
  address public priceOracle;
  constructor(address priceOracle_) {
     priceOracle = priceOracle_;
  }
}