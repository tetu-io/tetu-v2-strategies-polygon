// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./ConverterStrategyBase.sol";
import "./depositors/DystopiaDepositor.sol";

/// @title Converter Strategy with Dystopia Depositor
/// @author bogdoslav
contract DystopiaConverterStrategy is ConverterStrategyBase, DystopiaDepositor {

  string public constant override NAME = "Dystopia Converter Strategy";
  string public constant override PLATFORM = "Dystopia";
  string public constant override STRATEGY_VERSION = "1.0.0";

  function initializeStrategy(
    address controller_,
    address splitter_,
    address[] memory  rewardTokens_,
    address converter_,
    address router_,
    address tokenA_,
    address tokenB_,
    bool stable_,
    address voter_
  ) internal onlyInitializing {

    __DystopiaDepositor_init(router_, tokenA_, tokenB_, stable_, voter_);

    address[] memory thresholdTokens;
    uint[] memory thresholdAmounts;

    __ConverterStrategyBase_init(
      controller_,
      splitter_,
      rewardTokens_,
      converter_,
      thresholdTokens,
      thresholdAmounts
    );
  }

}
