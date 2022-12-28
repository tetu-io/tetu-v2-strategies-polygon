// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../strategies/depositors/DepositorBase.sol";
import "../strategies/depositors/DystopiaDepositor.sol";
import "./DepositorTestBase.sol";

/// @title Dystopia Depositor Test contract.
/// @author bogdoslav
contract DystopiaDepositorTest is DepositorTestBase, DystopiaDepositor {
  constructor(address router, address tokenA, address tokenB, bool stable, address voter)
  initializer {
    __DystopiaDepositor_init(router, tokenA, tokenB, stable, voter);
  }

  function depositorGauge() external view returns (address) {
    return _depositorGauge;
  }
}
