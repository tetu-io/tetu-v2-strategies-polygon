// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

interface IGauge {

  function notifyRewardAmount(address token, uint amount) external;

  function getReward(address account, address[] memory tokens) external;

  function claimFees() external returns (uint claimed0, uint claimed1);

  function depositAll(uint tokenId) external;

  function withdrawAll() external;

  function withdraw(uint amount) external;

  function balanceOf(address account) external view returns (uint);

  function rewardTokensLength() external view returns (uint);

  function rewardTokens(uint id) external view returns (address);

}
