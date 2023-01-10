// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "./IStakingBase.sol";

interface IStakingDualRewards is IStakingBase {
  /////////////////////////////////////////////////
  /// quickswap-core, IStakingDualRewards
  /////////////////////////////////////////////////
  // Views
  function rewardPerTokenA() external view returns (uint256);
  function rewardPerTokenB() external view returns (uint256);

  function earnedA(address account) external view returns (uint256);
  function earnedB(address account) external view returns (uint256);

  /////////////////////////////////////////////////
  /// quickswap-core, StakingDualRewards
  /////////////////////////////////////////////////
  function rewardsTokenA() external view returns (IERC20);
  function rewardsTokenB() external view returns (IERC20);
}
