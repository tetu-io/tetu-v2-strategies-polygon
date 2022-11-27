// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../strategies/DystopiaConverterStrategy.sol";

/// @title Implementation of Converter Strategy with Dystopia Depositor
/// @author bogdoslav
contract StrategyDystopiaConverter is DystopiaConverterStrategy {

  address constant public _DYSTOPIA_ROUTER = 0xbE75Dd16D029c6B32B7aD57A0FD9C1c20Dd2862e;

  function initialize(
    address controller_,
    address splitter_,
    address[] memory  rewardTokens_,
    address converter_,
    address tokenA_,
    address tokenB_,
    bool stable_
  ) external initializer {

    initializeStrategy(
      controller_,
      splitter_,
      rewardTokens_,
      converter_,
      _DYSTOPIA_ROUTER,
      tokenA_,
      tokenB_,
      stable_
    );

  }

}
