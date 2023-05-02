// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface IChildChainStreamer {

  function add_reward(
    address _token,
    address _distributor,
    uint256 _duration
  ) external;

  function remove_reward(address _token, address _recipient) external;

  function get_reward() external;

  function notify_reward_amount(address _token) external;

  function set_reward_duration(address _token, uint256 _duration) external;

  function set_reward_distributor(address _token, address _distributor) external;

  function reward_receiver() external view returns (address);

  function reward_tokens(uint256 arg0) external view returns (address);

  function reward_count() external view returns (uint256);

  function reward_data(address arg0) external view returns (
    address distributor,
    uint256 period_finish,
    uint256 rate,
    uint256 duration,
    uint256 received,
    uint256 paid
  );

  function last_update_time() external view returns (uint256);
}