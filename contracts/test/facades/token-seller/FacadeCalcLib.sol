// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../../../token-seller/CalcLib.sol";

contract FacadeCalcLib {
  function sqrt(uint x) external pure returns (uint z) {
    return CalcLib.sqrt(x);
  }

  function log2(uint256 x) external pure returns (uint256 result) {
    return CalcLib.log2(x);
  }
}