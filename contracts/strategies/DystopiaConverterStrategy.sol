// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./ConverterStrategyBase.sol";
import "../depositors/DystopiaDepositor.sol";

/// @title Converter Strategy with Dystopia Depositor
/// @author bogdoslav
contract DystopiaConverterStrategy is ConverterStrategyBase, DystopiaDepositor {

  string public constant override NAME = "Dystopia Converter Strategy";
  string public constant override PLATFORM = "Dystopia";
  string public constant override STRATEGY_VERSION = "1.0.0";
  address constant public _DYSTOPIA_ROUTER = 0xbE75Dd16D029c6B32B7aD57A0FD9C1c20Dd2862e;
  address constant public _DYSTOPIA_VOTER = 0x649BdF58B09A0Cd4Ac848b42c4B5e1390A72A49A;

  /// @dev Reward Tokens
  address[] internal _rewardTokens;

  function init(
    address controller_,
    address splitter_,
    address[] memory  rewardTokens_,
    address converter_,
    address tokenA_,
    address tokenB_,
    bool stable_
  ) external initializer {

    __DystopiaDepositor_init(_DYSTOPIA_ROUTER, tokenA_, tokenB_, stable_, _DYSTOPIA_VOTER);

    __ConverterStrategyBase_init(
      controller_,
      splitter_,
      converter_
    );

    _rewardTokens = rewardTokens_;
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() external view returns (address[] memory tokens) {
    return _rewardTokens;
  }

}
