// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

/// @notice gauge-v2, see 0xc9b36096f5201ea332Db35d6D195774ea0D5988f
/// @dev see 20230316-child-chain-gauge-factory-v2 in balancer-deployments repository
interface IBalancerGauge {
  event Approval(
    address indexed _owner,
    address indexed _spender,
    uint256 _value
  );
  event Transfer(address indexed _from, address indexed _to, uint256 _value);
  event Deposit(address indexed _user, uint256 _value);
  event Withdraw(address indexed _user, uint256 _value);
  event UpdateLiquidityLimit(
    address indexed _user,
    uint256 _original_balance,
    uint256 _original_supply,
    uint256 _working_balance,
    uint256 _working_supply
  );

  function deposit(uint256 _value) external;

  function deposit(uint256 _value, address _user) external;

  function withdraw(uint256 _value) external;

  function withdraw(uint256 _value, address _user) external;

  function transferFrom(
    address _from,
    address _to,
    uint256 _value
  ) external returns (bool);

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

  function transfer(address _to, uint256 _value) external returns (bool);

  function increaseAllowance(address _spender, uint256 _added_value)
  external
  returns (bool);

  function decreaseAllowance(address _spender, uint256 _subtracted_value)
  external
  returns (bool);

  function user_checkpoint(address addr) external returns (bool);

  function claimable_tokens(address addr) external returns (uint256);

  function claimed_reward(address _addr, address _token)
  external
  view
  returns (uint256);

  function claimable_reward(address _user, address _reward_token)
  external
  view
  returns (uint256);

  function set_rewards_receiver(address _receiver) external;

  function claim_rewards() external;

  function claim_rewards(address _addr) external;

  function claim_rewards(address _addr, address _receiver) external;

  function claim_rewards(
    address _addr,
    address _receiver,
    uint256[] memory _reward_indexes
  ) external;

  function add_reward(address _reward_token, address _distributor) external;

  function set_reward_distributor(address _reward_token, address _distributor)
  external;

  function deposit_reward_token(address _reward_token, uint256 _amount)
  external;

  function killGauge() external;

  function unkillGauge() external;

  function decimals() external view returns (uint256);

  function allowance(address owner, address spender)
  external
  view
  returns (uint256);

  function integrate_checkpoint() external view returns (uint256);

  function bal_token() external view returns (address);

  function bal_pseudo_minter() external view returns (address);

  function voting_escrow_delegation_proxy() external view returns (address);

  function authorizer_adaptor() external view returns (address);

  function initialize(address _lp_token, string memory _version) external;

  function DOMAIN_SEPARATOR() external view returns (bytes32);

  function nonces(address arg0) external view returns (uint256);

  function name() external view returns (string memory);

  function symbol() external view returns (string memory);

  function balanceOf(address arg0) external view returns (uint256);

  function totalSupply() external view returns (uint256);

  function lp_token() external view returns (address);

  function version() external view returns (string memory);

  function factory() external view returns (address);

  function working_balances(address arg0) external view returns (uint256);

  function working_supply() external view returns (uint256);

  function period() external view returns (uint256);

  function period_timestamp(uint256 arg0) external view returns (uint256);

  function integrate_checkpoint_of(address arg0)
  external
  view
  returns (uint256);

  function integrate_fraction(address arg0) external view returns (uint256);

  function integrate_inv_supply(uint256 arg0) external view returns (uint256);

  function integrate_inv_supply_of(address arg0)
  external
  view
  returns (uint256);

  function reward_count() external view returns (uint256);

  function reward_tokens(uint256 arg0) external view returns (address);

  function reward_data(address arg0) external view returns (S_0 memory);

  function rewards_receiver(address arg0) external view returns (address);

  function reward_integral_for(address arg0, address arg1)
  external
  view
  returns (uint256);

  function is_killed() external view returns (bool);

  function inflation_rate(uint256 arg0) external view returns (uint256);
}

  struct S_0 {
    address distributor;
    uint256 period_finish;
    uint256 rate;
    uint256 last_update;
    uint256 integral;
  }
