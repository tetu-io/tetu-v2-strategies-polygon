// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface IBalancerGauge {
  function decimals() external view returns (uint256);
  function version() external view returns (string memory);

  function last_claim() external view returns (uint256);
  function claimed_reward(address _addr, address _token) external view returns (uint256);
  function claimable_reward(address _addr, address _token) external view returns (uint256);
  function claimable_reward_write(address _addr, address _token) external returns (uint256);

  function reward_contract() external view returns (address);
  function reward_data(address _token) external view returns (
    address token,
    address distributor,
    uint256 period_finish,
    uint256 rate,
    uint256 last_update,
    uint256 integral
  );
  function reward_tokens(uint256 arg0) external view returns (address);
  function reward_balances(address arg0) external view returns (uint256);
  function rewards_receiver(address arg0) external view returns (address);
  function reward_integral(address arg0) external view returns (uint256);
  function reward_integral_for(address arg0, address arg1) external view returns (uint256);
  function set_rewards_receiver(address _receiver) external;
  function set_rewards(
    address _reward_contract,
    bytes32 _claim_sig,
    address[8] memory _reward_tokens
  ) external;

  function claim_rewards() external;
  function claim_rewards(address _addr) external;
  function claim_rewards(address _addr, address _receiver) external;

  function deposit(uint256 _value) external;
  function deposit(uint256 _value, address _addr) external;
  function deposit(uint256 _value, address _addr, bool _claim_rewards) external;

  function withdraw(uint256 _value) external;
  function withdraw(uint256 _value, bool _claim_rewards) external;

  function transfer(address _to, uint256 _value) external returns (bool);
  function transferFrom(address _from, address _to, uint256 _value) external returns (bool);

  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address _spender, uint256 _value) external returns (bool);

  function permit(
    address _owner,
    address _spender,
    uint256 _value,
    uint256 _deadline,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) external returns (bool);

  function increaseAllowance(address _spender, uint256 _added_value) external returns (bool);
  function decreaseAllowance(address _spender, uint256 _subtracted_value) external returns (bool);

  function initialize(
    address _lp_token,
    address _reward_contract,
    bytes32 _claim_sig
  ) external;

  function lp_token() external view returns (address);

  function balanceOf(address arg0) external view returns (uint256);
  function totalSupply() external view returns (uint256);
  function name() external view returns (string memory);
  function symbol() external view returns (string memory);
  function DOMAIN_SEPARATOR() external view returns (bytes32);
  function nonces(address arg0) external view returns (uint256);
  function claim_sig() external view returns (bytes memory);
}
