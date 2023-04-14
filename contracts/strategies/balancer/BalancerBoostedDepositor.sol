// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "./BalancerLogicLib.sol";
import "../../integrations/balancer/IBVault.sol";
import "../../integrations/balancer/IBalancerHelper.sol";
import "../../integrations/balancer/IComposableStablePool.sol";
import "../../integrations/balancer/IChildChainLiquidityGaugeFactory.sol";
import "../../integrations/balancer/IBalancerGauge.sol";


/// @title Depositor for Composable Stable Pool with several embedded linear pools like "Balancer Boosted Tetu USD"
/// @dev See https://app.balancer.fi/polygon#/polygon/pool/0xb3d658d5b95bf04e2932370dd1ff976fe18dd66a000000000000000000000ace
///            bb-t-DAI (DAI + tDAI) + bb-t-USDC (USDC + tUSDC) + bb-t-USDT (USDT + tUSDT)
///      See https://docs.balancer.fi/products/balancer-pools/boosted-pools for explanation of Boosted Pools on BalanceR.
///      Terms
///         bb-t-USD = pool bpt
///         bb-t-DAI, bb-t-USDC, bb-t-USDT = underlying bpt
abstract contract BalancerBoostedDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant BALANCER_BOOSTED_DEPOSITOR_VERSION = "1.0.0";

  /// @dev https://dev.balancer.fi/references/contracts/deployment-addresses
  IBVault internal constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
  address internal constant BALANCER_HELPER = 0x239e55F427D44C3cc793f49bFB507ebe76638a2b;
  /// @notice ChildChainLiquidityGaugeFactory allows to get gauge address by pool id
  /// @dev see https://dev.balancer.fi/resources/vebal-and-gauges/gauges
  address internal constant CHILD_CHAIN_LIQUIDITY_GAUGE_FACTORY = 0x3b8cA519122CdD8efb272b0D3085453404B25bD0;

  /// @notice i.e. for "Balancer Boosted Aave USD": 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
  /// @notice i.e. for "Balancer Boosted Tetu USD": 0xb3d658d5b95bf04e2932370dd1ff976fe18dd66a000000000000000000000ace
  bytes32 public poolId;
  IBalancerGauge public gauge;
  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedDepositor_init(address pool_) internal onlyInitializing {
    poolId = IComposableStablePool(pool_).getPoolId();

    gauge = IBalancerGauge(
      IChildChainLiquidityGaugeFactory(
        CHILD_CHAIN_LIQUIDITY_GAUGE_FACTORY
      ).getPoolGauge(pool_)
    );
    // infinite approve of pool-BPT to the gauge todo is it safe for the external gauge?
    IERC20(pool_).safeApprove(address(gauge), type(uint).max);
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets, same as getPoolTokens but without pool-bpt
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    return BalancerLogicLib.depositorPoolAssets(BALANCER_VAULT, poolId);
  }

  /// @notice Returns pool weights
  /// @return weights Array with weights, length = getPoolTokens.tokens - 1 (all assets except BPT)
  /// @return totalWeight Total sum of all items of {weights}
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    return BalancerLogicLib.depositorPoolWeights(BALANCER_VAULT, poolId);
  }

  /// @notice Total amounts of the main assets under control of the pool, i.e amounts of DAI, USDC, USDT
  /// @return reservesOut Total amounts of embedded assets, i.e. for "Balancer Boosted Aave USD" we return:
  ///                     0: balance DAI + (balance amDAI recalculated to DAI)
  ///                     1: balance USDC + (amUSDC recalculated to USDC)
  ///                     2: balance USDT + (amUSDT recalculated to USDT)
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reservesOut) {
    reservesOut = BalancerLogicLib.depositorPoolReserves(BALANCER_VAULT, poolId);
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint liquidityOut) {
    liquidityOut = gauge.balanceOf(address(this))
    + IComposableStablePool(BalancerLogicLib.getPoolAddress(poolId)).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint totalSupplyOut) {
    totalSupplyOut = IComposableStablePool(BalancerLogicLib.getPoolAddress(poolId)).getActualSupply();
  }

  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of assets on the balance of the depositor
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  ///         i.e. for "Balancer Boosted Aave USD" we have DAI, USDC, USDT
  /// @return amountsConsumedOut Amounts of assets deposited to balanceR pool
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  /// @return liquidityOut Total amount of liquidity added to balanceR pool in terms of pool-bpt tokens
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    bytes32 _poolId = poolId;
    IComposableStablePool pool = IComposableStablePool(BalancerLogicLib.getPoolAddress(_poolId));

    // join to the pool, receive pool-BPTs
    (amountsConsumedOut, liquidityOut) = BalancerLogicLib.depositorEnter(BALANCER_VAULT, _poolId, amountsDesired_);

    // stake all available pool-BPTs to the gauge
    // we can have pool-BPTs on depositor's balance after previous exit, stake them too
    gauge.deposit(pool.balanceOf(address(this)));
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  /// @param liquidityAmount_ Max amount to withdraw in bpt. Actual withdrawn amount will be less,
  ///                         so it worth to add a gap to this amount, i.e. 1%
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (
    uint[] memory amountsOut
  ) {
    bytes32 _poolId = poolId;
    IBalancerGauge __gauge = gauge;
    IComposableStablePool pool = IComposableStablePool(BalancerLogicLib.getPoolAddress(_poolId));

    // we need to withdraw pool-BPTs from the _gauge
    // at first, let's try to use exist pool-BPTs on the depositor balance, probably it's enough
    // we can have pool-BPTs on depositor's balance after previous exit, see BalancerLogicLib.depositorExit
    uint depositorBalance = pool.balanceOf(address(this));
    uint gaugeBalance = __gauge.balanceOf(address(this));

    uint liquidityToWithdraw = liquidityAmount_ > depositorBalance
    ? liquidityAmount_ - depositorBalance
    : 0;

    // calculate how much pool-BPTs we should withdraw from the gauge
    if (liquidityToWithdraw > 0) {
      if (liquidityToWithdraw > gaugeBalance) {
        liquidityToWithdraw = gaugeBalance;
      }
    }

    // un-stake required pool-BPTs from the gauge
    if (liquidityToWithdraw > 0) {
      __gauge.withdraw(liquidityToWithdraw);
    }

    // withdraw the liquidity from the pool
    amountsOut = (liquidityAmount_ >= depositorBalance + gaugeBalance)
    ? BalancerLogicLib.depositorExitFull(BALANCER_VAULT, _poolId)
    : BalancerLogicLib.depositorExit(BALANCER_VAULT, _poolId, liquidityToWithdraw);
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then full exit is required
  ///      we emulate is at normal exit + conversion of remain BPT directly to the main asset
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    uint liquidity = _depositorLiquidity();
    if (liquidity == 0) {
      // there is no liquidity, output is zero
      return new uint[](_depositorPoolAssets().length);
    } else {
      // BalancerLogicLib.depositorQuoteExit takes into account the cost of unused BPT
      // so we don't need a special logic here for the full exit
      return BalancerLogicLib.depositorQuoteExit(
        BALANCER_VAULT,
        IBalancerHelper(BALANCER_HELPER),
        poolId,
        liquidityAmount_
      );
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory depositorBalancesBefore
  ) {
    return BalancerLogicLib.depositorClaimRewards(gauge, _depositorPoolAssets(), rewardTokens());
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() public view returns (address[] memory tokens) {
    uint total;
    for (; total < 8; ++total) {
      if (gauge.reward_tokens(total) == address(0)) {
        break;
      }
    }
    tokens = new address[](total);
    for (uint i; i < total; ++i) {
      tokens[i] = gauge.reward_tokens(i);
    }
  }

  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[16] private __gap; // TODO 16 ???
}
