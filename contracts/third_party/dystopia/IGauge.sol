// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

interface IGauge {

  function veIds(address stakingToken, address account) external view returns (uint);

  function getReward(
    address stakingToken,
    address account,
    address[] memory tokens
  ) external;

  function getAllRewards(
    address stakingToken,
    address account
  ) external;

  function getAllRewardsForTokens(
    address[] memory stakingTokens,
    address account
  ) external;

  function attachVe(address stakingToken, address account, uint veId) external;

  function detachVe(address stakingToken, address account, uint veId) external;

  function handleBalanceChange(address account) external;

  function notifyRewardAmount(address stakingToken, address token, uint amount) external;

  function addStakingToken(address token) external;

  function depositAll(uint tokenId) external;

  function withdrawAll() external;

  function withdraw(uint amount) external;

  function balanceOf(address account) external view returns (uint);

  function rewardTokensLength() external view returns (uint);

  function rewardTokens(uint id) external view returns (address);

  function claimFees() external returns (uint claimed0, uint claimed1);

  function getReward(address account, address[] memory tokens) external;

}
