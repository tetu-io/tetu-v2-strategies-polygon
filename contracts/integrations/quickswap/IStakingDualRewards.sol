// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";

interface IStakingDualRewards {
  /////////////////////////////////////////////////
  /// quickswap-core, IStakingDualRewards
  /////////////////////////////////////////////////
  // Views
  function lastTimeRewardApplicable() external view returns (uint256);

  function rewardPerTokenA() external view returns (uint256);
  function rewardPerTokenB() external view returns (uint256);

  function earnedA(address account) external view returns (uint256);

  function earnedB(address account) external view returns (uint256);

  function totalSupply() external view returns (uint256);

  function balanceOf(address account) external view returns (uint256);

  // Mutative

  function stake(uint256 amount) external;

  function withdraw(uint256 amount) external;

  function getReward() external;

  function exit() external;

  /////////////////////////////////////////////////
  /// quickswap-core, StakingDualRewards
  /////////////////////////////////////////////////
  function rewardsTokenA() external view returns (IERC20);

  function rewardsTokenB() external view returns (IERC20);

  function stakingToken() external view returns (IERC20);
}
