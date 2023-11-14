// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";

contract MockAccountant {
  uint[] private _deltaGains;
  uint[] private _deltaLosses;
  address[] private _tokensPassed;

  function setCheckpoint(uint[] memory deltaGains_, uint[] memory deltaLosses_) external {
    _deltaGains = deltaGains_;
    _deltaLosses = deltaLosses_;
  }

  function getCheckpointResults() external view returns (address[] memory ) {
    console.log("len tokens 2", _tokensPassed.length);
    return _tokensPassed;
  }

  /// @notice Save checkpoint for all pool adapters of the given {user_}
  /// @return deltaGains Total amount of gains for the {tokens_} by all pool adapter
  /// @return deltaLosses Total amount of losses for the {tokens_} by all pool adapter
  function checkpoint(address[] memory tokens_) external returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  ) {
    console.log("checkpoint");
    console.log("len tokens", tokens_.length);
    _tokensPassed = new address[](tokens_.length);
    for (uint i = 0; i < tokens_.length; ++i) {
      _tokensPassed[i] = tokens_[i];
    }
    return (_deltaGains, _deltaLosses);
  }
}