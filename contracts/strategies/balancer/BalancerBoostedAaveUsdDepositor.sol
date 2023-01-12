// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "../../tools/TokenAmountsLib.sol";
import "../../tools/AppErrors.sol";

/// @title Depositor for the pool Balancer Boosted Aave USD (Polygon)
/// @dev See https://app.balancer.fi/#/polygon/pool/0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
abstract contract BalancerBoostedAaveUsdDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant BALANCER_BOOSTED_AAVE_USD_DEPOSITOR_VERSION = "1.0.0";

  /// @dev https://dev.balancer.fi/references/contracts/deployment-addresses
  IBVault public constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

  /// @notice Balancer Boosted Aave USD pool ID
  bytes32 public constant POOL_ID = 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b;

  /////////////////////////////////////////////////////////////////////
  ///                   Variables
  /////////////////////////////////////////////////////////////////////
  address public tokenA;
  address public tokenB;

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedAaveUsdDepositor_init(
    address router_,
    address tokenA_,
    address tokenB_,
    address rewardsPool_
  ) internal onlyInitializing {
    require(
      router_ != address(0)
      && rewardsPool_ != address(0)
      && tokenA_ != address(0)
      && tokenB_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    router = IUniswapV2Router02(router_);
    tokenA = tokenA_;
    tokenB = tokenB_;

    _rewardsPool = rewardsPool_;

    // infinity approve,  2**255 is more gas-efficient than type(uint).max
    IERC20(address(depositorPair)).approve(_rewardsPool, 2**255);
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = tokenA;
    poolAssets[1] = tokenB;
  }

  /// @notice Returns pool weights in percents (50/50%)
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](2);
    weights[0] = 1; // 50%
    weights[1] = 1; // 50%
    totalWeight = 2; // 100%
  }

  /// @notice Returns pool weights in percents
  /// @return reserves Reserves for: _depositorTokenA, _depositorTokenB
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    IUniswapV2Pair _depositorPair = depositorPair; // gas saving

    reserves = new uint[](2);
    if (_depositorSwapTokens) {
      (reserves[1], reserves[0],) = _depositorPair.getReserves();
    } else {
      (reserves[0], reserves[1],) = _depositorPair.getReserves();
    }
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint) {
    console.log("_depositorLiquidity", IStakingBase(_rewardsPool).balanceOf(address(this)));
    // All LP tokens were staked into the rewards pool
    return IStakingBase(_rewardsPool).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    console.log("_depositorTotalSupply", depositorPair.totalSupply());
    return depositorPair.totalSupply();
  }


  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of token A and B on the balance of the depositor
  /// @return amountsConsumedOut Amounts of token A and B deposited to the internal pool
  /// @return liquidityOut Total amount of liquidity added to the internal pool
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    return (amountsConsumedOut, liquidityOut);
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    console.log("_depositorExit.liquidityAmount_", liquidityAmount_);

  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual view returns (uint[] memory amountsOut) {
    return amountsOut;
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    return (tokensOut, amountsOut);
  }


  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   */
  uint[16] private __gap;

}