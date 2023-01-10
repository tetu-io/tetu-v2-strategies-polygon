// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "./IStakingBase.sol";

interface IStakingRewards is IStakingBase {
/////////////////////////////////////////////////
/// quickswap-core, IStakingRewards
/////////////////////////////////////////////////

  // Views
  function rewardPerToken() external view returns (uint256);
  function earned(address account) external view returns (uint256);

  /////////////////////////////////////////////////
  /// quickswap-core, StakingRewards
  /////////////////////////////////////////////////
  function rewardsToken() external view returns (IERC20);
}