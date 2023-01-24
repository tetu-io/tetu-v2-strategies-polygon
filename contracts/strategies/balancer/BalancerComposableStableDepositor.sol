// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../DepositorBase.sol";
import "./BalancerLogicLib.sol";
import "../../tools/TokenAmountsLib.sol";
import "../../tools/AppErrors.sol";
import "../../integrations/balancer/IBVault.sol";
import "../../integrations/balancer/IBalancerHelper.sol";
import "../../integrations/balancer/IBalancerBoostedAavePool.sol";
import "../../integrations/balancer/IBalancerBoostedAaveStablePool.sol";
import "../../integrations/balancer/IChildChainLiquidityGaugeFactory.sol";
import "../../integrations/balancer/IBalancerGauge.sol";

import "hardhat/console.sol";

/// @title Depositor for Composable Stable Pool with several embedded linear pools like "Balancer Boosted Aave USD"
/// @dev See https://app.balancer.fi/#/polygon/pool/0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
///            bb-am-DAI (DAI + amDAI) + bb-am-USDC (USDC + amUSDC) + bb-am-USDT (USDT + amUSDT)
///      See https://docs.balancer.fi/products/balancer-pools/boosted-pools for explanation of Boosted Pools on BalanceR.
///      Terms
///         bb-a-USD = pool bpt
///         bb-a-DAI, bb-a-USDC, etc = underlying bpt
abstract contract BalancerComposableStableDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant BALANCER_COMPOSABLE_STABLE_DEPOSITOR_VERSION = "1.0.0";

  /// @dev https://dev.balancer.fi/references/contracts/deployment-addresses
  IBVault private constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
  address private constant BALANCER_HELPER = 0x239e55F427D44C3cc793f49bFB507ebe76638a2b;
  /// @notice ChildChainLiquidityGaugeFactory allows to get gauge address by pool id
  /// @dev see https://dev.balancer.fi/resources/vebal-and-gauges/gauges
  address private constant CHILD_CHAIN_LIQUIDITY_GAUGE_FACTORY = 0x3b8cA519122CdD8efb272b0D3085453404B25bD0;

  /// @notice i.e. for "Balancer Boosted Aave USD": 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
  bytes32 public poolId;
  IBalancerGauge private _gauge;
  address[] private _rewardTokens;
  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedAaveUsdDepositor_init(
    bytes32 poolId_,
    address[] memory rewardTokens_
  ) internal onlyInitializing {
    poolId = poolId_;

    _gauge = IBalancerGauge(
      IChildChainLiquidityGaugeFactory(
        CHILD_CHAIN_LIQUIDITY_GAUGE_FACTORY
      ).getPoolGauge(BalancerLogicLib.getPoolAddress(poolId_))
    );
    // infinite approve of pool-BPT to the gauge todo is it safe for the external gauge?
    IERC20(BalancerLogicLib.getPoolAddress(poolId_)).safeApprove(address(_gauge), 2**255);

    // we can get list of reward tokens from the gauge, but it's more cheaper to get it outside
    _rewardTokens = rewardTokens_;
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
    reservesOut =  BalancerLogicLib.depositorPoolReserves(BALANCER_VAULT, poolId);
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint liquidityOut) {
    liquidityOut = _gauge.balanceOf(address(this))
      + IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).balanceOf(address(this));
    console.log("_depositorLiquidity: liquidityOut=gauge+depositor balance",
      liquidityOut,
      _gauge.balanceOf(address(this)),
      IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).balanceOf(address(this))
    );
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint totalSupplyOut) {
    totalSupplyOut = IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).getActualSupply();
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
    bytes32 _poolId = poolId; // gas saving
    IBalancerBoostedAaveStablePool pool = IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(_poolId));
    console.log("_depositorEnter.0 depositorBalance", pool.balanceOf(address(this)));

    // join to the pool, receive pool-BPTs
    (amountsConsumedOut, liquidityOut) = BalancerLogicLib.depositorEnter(BALANCER_VAULT, _poolId, amountsDesired_);

    console.log("_depositorEnter.1 liquidityOut", liquidityOut);
    console.log("_depositorEnter.2 amountsConsumedOut", amountsConsumedOut[0], amountsConsumedOut[1], amountsConsumedOut[2]);
    console.log("_depositorEnter.3 gaugeBalance, depositorBalance", _gauge.balanceOf(address(this)), pool.balanceOf(address(this)));

    // stake all available pool-BPTs to the gauge
    // we can have pool-BPTs on depositor's balance after previous exit, stake them too
    _gauge.deposit(pool.balanceOf(address(this)));
    console.log("_depositorEnter.4 gaugeBalance, depositorBalance", _gauge.balanceOf(address(this)), pool.balanceOf(address(this)));
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  /// @param liquidityAmount_ Max amount to withdraw in bpt. Actual withdrawn amount will be less,
  ///                         so it worth to add a gap to this amount, i.e. 1%
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    bytes32 _poolId = poolId; // gas saving
    IBalancerGauge __gauge = _gauge; // gas saving
    IBalancerBoostedAaveStablePool pool = IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(_poolId));

    // we need to withdraw pool-BPTs from the _gauge
    // at first, let's try to use exist pool-BPTs on the depositor balance, probably it's enough
    // we can have pool-BPTs on depositor's balance after previous exit, see BalancerLogicLib.depositorExit
    uint depositorBalance = pool.balanceOf(address(this));
    uint gaugeBalance = __gauge.balanceOf(address(this));
    console.log("_depositorExit.1 liquidityAmount_, gaugeBalance, depositorBalance", liquidityAmount_, gaugeBalance, depositorBalance);

    uint liquidityToWithdraw = liquidityAmount_ > depositorBalance
      ? liquidityAmount_ - depositorBalance
      : 0;
    console.log("_depositorExit.2 liquidityToWithdraw", liquidityToWithdraw);

    // calculate how much pool-BPTs we should withdraw from the gauge
    if (liquidityToWithdraw > 0) {
      if (liquidityToWithdraw > gaugeBalance) {
        console.log("_depositorExit.3 liquidityToWithdraw", liquidityToWithdraw);
        liquidityToWithdraw = gaugeBalance;
      }
    }
    console.log("_depositorExit.4 liquidityToWithdraw", liquidityToWithdraw);

    // un-stake required pool-BPTs from the gauge
    if (liquidityToWithdraw > 0) {
      __gauge.withdraw(liquidityToWithdraw);
    }

    // withdraw the liquidity from the pool
    if (liquidityAmount_ >= depositorBalance + gaugeBalance) {
      console.log("_depositorExit.5 Full exit, liquidityAmount_", liquidityAmount_);
      amountsOut = BalancerLogicLib.depositorExitFull(BALANCER_VAULT, _poolId);
    } else {
      console.log("_depositorExit.6 Partial exit liquidityToWithdraw", liquidityToWithdraw);
      amountsOut = BalancerLogicLib.depositorExit(BALANCER_VAULT, _poolId, liquidityToWithdraw);
    }
    console.log("_depositorExit.7 gaugeBalance, depositorBalance", __gauge.balanceOf(address(this)), pool.balanceOf(address(this)));
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit - TODO
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    uint liquidity = _depositorLiquidity();
    if (liquidity == 0) {
      // there is no liquidity, output is zero
      return new uint[](_depositorPoolAssets().length);
    } else if (liquidityAmount_ >= liquidity) {
      // todo quote full exit using try/catch
      return BalancerLogicLib.depositorQuoteExit(
        BALANCER_VAULT,
        IBalancerHelper(BALANCER_HELPER),
        poolId,
        liquidityAmount_
      );
    } else {
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
    uint[] memory amountsOut
  ) {
    return BalancerLogicLib.depositorClaimRewards(_gauge, _rewardTokens);
  }

  /// @dev Returns reward token addresses array.
  function rewardTokens() external view returns (address[] memory tokens) {
    return _rewardTokens;
  }


  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[16] private __gap; // TODO 16 ???
}
