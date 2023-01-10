// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";

/// @notice Common methods from quickswap-core, IStakingDualRewards and IStakingRewards
/// @dev This interface allows us to use QuickswapDepositor for two different kinds of the rewards pools
interface IStakingBase {
  function lastTimeRewardApplicable() external view returns (uint256);
  function totalSupply() external view returns (uint256);
  function balanceOf(address account) external view returns (uint256);

  function stake(uint256 amount) external;
  function withdraw(uint256 amount) external;
  function getReward() external;
  function exit() external;
  function stakingToken() external view returns (IERC20);
}
