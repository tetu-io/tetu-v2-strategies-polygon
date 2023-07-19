// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../../libs/BorrowLib.sol";

contract BorrowLibFacade {
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    ITetuLiquidator tetuLiquidator_,
    address asset0,
    address asset1,
    uint prop0,
    uint threshold0,
    uint threshold1,
    uint addition0
  ) external {
    BorrowLib.rebalanceAssets(tetuConverter_, tetuLiquidator_, asset0, asset1, prop0, threshold0, threshold1, addition0);
  }
}