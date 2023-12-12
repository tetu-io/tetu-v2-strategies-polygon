// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "../DepositorBase.sol";
import "./PancakeStrategyErrors.sol";
import "./PancakeConverterStrategyLogicLib.sol";


abstract contract PancakeDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  //region  -------------------------------------------- Constants

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant PANCAKE_DEPOSITOR_VERSION = "1.0.0";

  uint internal constant IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_A = 0;
  uint internal constant IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_B = 1;
  uint internal constant IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_RT = 2;
  uint internal constant IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_BRT = 3;
  //endregion  -------------------------------------------- Constants

  //region  -------------------------------------------- Variables
  /// @dev State variable to store the current state of the whole strategy
  PancakeConverterStrategyLogicLib.State internal state;

  /// @dev reserve space for future needs
  uint[100 - 65] private __gap; // todo calc gap
  //endregion  -------------------------------------------- Variables

  //region  -------------------------------------------- View
  /// @return nums Balances of [tokenA, tokenB, rewardToken, bonusRewardToken] for profit holder
  function getSpecificState() external view returns (
    uint[] memory nums
  ) {
    address profitHolder = state.pair.strategyProfitHolder;
    nums = new uint[](4);
    nums[IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_A] = IERC20(state.pair.tokenA).balanceOf(profitHolder);
    nums[IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_B] = IERC20(state.pair.tokenB).balanceOf(profitHolder);
    nums[IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_RT] = IERC20(state.rewardToken).balanceOf(profitHolder);
    nums[IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_BRT] = IERC20(state.bonusRewardToken).balanceOf(profitHolder); // todo
  }

  /// @notice Returns the fees for the current state.
  /// @return fee0 and fee1.
  function getFees() public view returns (uint fee0, uint fee1) {
    return PancakeConverterStrategyLogicLib.getFees(state);
  }

  /// @notice Returns the pool assets.
  /// @return poolAssets An array containing the addresses of the pool assets.
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = state.pair.tokenA;
    poolAssets[1] = state.pair.tokenB;
  }

  /// @notice Returns the pool weights and the total weight.
  /// @return weights An array containing the weights of the pool assets, and totalWeight the sum of the weights.
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](2);
    weights[0] = 1;
    weights[1] = 1;
    totalWeight = 2;
  }

  /// @notice Returns the pool reserves.
  /// @return reserves An array containing the reserves of the pool assets.
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    return PancakeConverterStrategyLogicLib.getPoolReserves(state.pair);
  }

  /// @notice Returns the current liquidity of the depositor.
  /// @return The current liquidity of the depositor.
  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(state.pair.totalLiquidity);
  }

  /// @notice Returns the total supply of the depositor.
  /// @return In UniV3 we can not calculate the total supply of the whole pool. Return only ourself value.
  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(state.pair.totalLiquidity);
  }
  //endregion  -------------------------------------------- View

  //region  -------------------------------------------- Enter, exit
  /// @notice Handles the deposit operation.
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (uint[] memory amountsConsumed, uint liquidityOut) {
    (amountsConsumed, liquidityOut) = PancakeConverterStrategyLogicLib.enter(state, amountsDesired_);
  }

  /// @notice Handles the withdrawal operation.
  /// @param liquidityAmount The amount of liquidity to be withdrawn.
  /// @param emergency Emergency exit (only withdraw, don't claim any rewards or make any other additional actions)
  /// @return amountsOut The amounts of the tokens withdrawn.
  function _depositorExit(uint liquidityAmount, bool emergency) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = PancakeConverterStrategyLogicLib.exit(state, uint128(liquidityAmount), emergency);
  }

  /// @notice Returns the amount of tokens that would be withdrawn based on the provided liquidity amount.
  /// @param liquidityAmount The amount of liquidity to quote the withdrawal for.
  /// @return amountsOut The amounts of the tokens that would be withdrawn.
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = PancakeConverterStrategyLogicLib.quoteExit(state.pair, uint128(liquidityAmount));
  }
  //endregion  -------------------------------------------- Enter, exit

  //region  -------------------------------------------- Claim rewards
  /// @notice Claims all possible rewards.
  /// @return tokensOut An array containing the addresses of the reward tokens,
  /// @return amountsOut An array containing the amounts of the reward tokens.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    return PancakeConverterStrategyLogicLib.claimRewards(state);
  }
  //endregion  -------------------------------------------- Claim rewards
}
