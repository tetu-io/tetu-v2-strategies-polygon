// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";

interface IStakingRewards {
/////////////////////////////////////////////////
/// quickswap-core, IStakingRewards
/////////////////////////////////////////////////

  // Views
  function lastTimeRewardApplicable() external view returns (uint256);

  function rewardPerToken() external view returns (uint256);

  function earned(address account) external view returns (uint256);

  function totalSupply() external view returns (uint256);

  function balanceOf(address account) external view returns (uint256);

  // Mutative

  function stake(uint256 amount) external;

  function withdraw(uint256 amount) external;

  function getReward() external;

  function exit() external;

  /////////////////////////////////////////////////
  /// quickswap-core, StakingRewards
  /////////////////////////////////////////////////
  function rewardsToken() external view returns (IERC20);

  function stakingToken() external view returns (IERC20);
}