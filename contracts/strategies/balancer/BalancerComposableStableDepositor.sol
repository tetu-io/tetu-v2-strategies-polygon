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

  /// @notice For "Balancer Boosted Aave USD": 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
  bytes32 public poolId;

  /////////////////////////////////////////////////////////////////////
  ///                   Variables
  /////////////////////////////////////////////////////////////////////

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedAaveUsdDepositor_init(bytes32 poolId_) internal onlyInitializing {
    poolId = poolId_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets, same as getPoolTokens but without pool-bpt
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(poolId);
    uint bptIndex = IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).getBptIndex();
    uint len = tokens.length;

    poolAssets = new address[](len - 1);
    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex) continue;

      poolAssets[k] = IBalancerBoostedAavePool(address(tokens[i])).getMainToken();
      ++k;
    }
  }

  /// @notice Returns pool weights
  /// @return weights Array with weights, length = getPoolTokens.tokens - 1 (all assets except BPT)
  /// @return totalWeight Total sum of all items of {weights}
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(poolId);
    totalWeight = tokens.length - 1; // totalWeight is equal to length of output array here
    weights = new uint[](totalWeight);
    for (uint i; i < totalWeight; i = uncheckedInc(i)) {
      weights[i] = 1;
    }
  }

  /// @notice Total amounts of the main assets under control of the pool, i.e amounts of DAI, USDC, USDT
  /// @return reservesOut Total amounts of embedded assets, i.e. for "Balancer Boosted Aave USD" we return:
  ///                     0: balance DAI + (balance amDAI recalculated to DAI)
  ///                     1: balance USDC + (amUSDC recalculated to USDC)
  ///                     2: balance USDT + (amUSDT recalculated to USDT)
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reservesOut) {
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(poolId);
    uint bptIndex = IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).getBptIndex();
    uint len = tokens.length;
    reservesOut = new uint[](len - 1); // exclude pool-BPT

    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex) continue;
      IBalancerBoostedAavePool linearPool = IBalancerBoostedAavePool(address(tokens[i]));

      // Each bb-am-* returns (main-token, wrapped-token, bb-am-itself), the order of tokens is arbitrary
      // i.e. (DAI + amDAI + bb-am-DAI) or (bb-am-USDC, amUSDC, USDC)

      // get balances of all tokens of bb-am-XXX token, i.e. balances of (DAI, amDAI, bb-am-DAI)
      (, uint256[] memory balances,) = BALANCER_VAULT.getPoolTokens(linearPool.getPoolId());
      uint mainIndex = linearPool.getMainIndex(); // DAI
      uint wrappedIndex = linearPool.getWrappedIndex(); // amDAI

      reservesOut[k] = balances[mainIndex] + balances[wrappedIndex] * linearPool.getWrappedTokenRate() / 1e18;
      ++k;
    }
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint) {
    console.log("_depositorLiquidity", IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).balanceOf(address(this)));
    return IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    console.log("_depositorTotalSupply", IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).getActualSupply());
    return IBalancerBoostedAaveStablePool(BalancerLogicLib.getPoolAddress(poolId)).getActualSupply();
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
    return BalancerLogicLib.depositorEnter(BALANCER_VAULT, poolId, amountsDesired_);
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  /// @param liquidityAmount_ Amount to withdraw in bpt
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    if (liquidityAmount_ >= _depositorLiquidity()) {
      // todo Full exit
      return BalancerLogicLib.depositorExit(BALANCER_VAULT, poolId, liquidityAmount_);
    } else {
      return BalancerLogicLib.depositorExit(BALANCER_VAULT, poolId, liquidityAmount_);
    }
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit - TODO
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    if (liquidityAmount_ >= _depositorLiquidity()) {
      // todo Full exit
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
    return (tokensOut, amountsOut);
  }


  /////////////////////////////////////////////////////////////////////
  ///             Utils
  /////////////////////////////////////////////////////////////////////
  function uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[16] private __gap; // TODO 16 ???
}
