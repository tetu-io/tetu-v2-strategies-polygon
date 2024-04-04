// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract MockTetuConverterController {
  address public priceOracle;
  address public bookkeeper;
  address public liquidator;
  address public forwarder;

  constructor(address priceOracle_) {
    priceOracle = priceOracle_;
  }

  function setBookkeeper(address bookkeeper_) external {
    bookkeeper = bookkeeper_;
  }

  function setLiquidator(address liquidator_) external {
    liquidator = liquidator_;
  }

  function setForwarder(address forwarder_) external {
    forwarder = forwarder_;
  }
}
