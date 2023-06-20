// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../../libs/BorrowLib.sol";

contract BorrowLibFacade {
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    address asset0,
    address asset1,
    uint prop0,
    uint threshold0,
    uint threshold1
  ) external {
    BorrowLib.rebalanceAssets(tetuConverter_, asset0, asset1, prop0, threshold0, threshold1);
  }
}