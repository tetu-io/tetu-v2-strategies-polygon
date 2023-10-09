// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "../DepositorBase.sol";
import "./Uni3StrategyErrors.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";

/// @title UniswapV3Depositor
/// @dev Abstract contract that is designed to interact with Uniswap V3 pools and manage liquidity.
///      Inherits from IUniswapV3MintCallback, DepositorBase, and Initializable.
abstract contract UniswapV3Depositor is IUniswapV3MintCallback, DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant UNISWAPV3_DEPOSITOR_VERSION = "1.0.4";

  uint internal constant IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_A = 0;
  uint internal constant IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_B = 1;

  /////////////////////////////////////////////////////////////////////
  ///                VARIABLES
  /////////////////////////////////////////////////////////////////////

  /// @dev State variable to store the current state of the whole strategy
  UniswapV3ConverterStrategyLogicLib.State internal state;

  /// @dev reserve space for future needs
  uint[100 - 60] private __gap;

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @return nums Balances of [tokenA, tokenB] for profit holder
  function getSpecificState() external view returns (
    uint[] memory nums
  ) {
    address strategyProfitHolder = state.pair.strategyProfitHolder;
    nums = new uint[](2);
    nums[IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_A] = IERC20(state.pair.tokenA).balanceOf(strategyProfitHolder);
    nums[IDX_SS_NUMS_PROFIT_HOLDER_BALANCE_B] = IERC20(state.pair.tokenB).balanceOf(strategyProfitHolder);
  }

  /// @notice Returns the fees for the current state.
  /// @return fee0 and fee1.
  function getFees() public view returns (uint fee0, uint fee1) {
    return UniswapV3ConverterStrategyLogicLib.getFees(state.pair);
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
    return UniswapV3ConverterStrategyLogicLib.getPoolReserves(state.pair);
  }

  /// @notice Returns the current liquidity of the depositor.
  /// @return The current liquidity of the depositor.
  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(state.pair.totalLiquidity);
  }

  /// @notice Returns the total supply of the depositor.
  /// @return In UniV3 we can not calculate the total supply of the wgole pool. Return only ourself value.
  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(state.pair.totalLiquidity);
  }

  /////////////////////////////////////////////////////////////////////
  ///                CALLBACK
  /////////////////////////////////////////////////////////////////////

  /// @notice Callback function called by Uniswap V3 pool on mint operation.
  /// @param amount0Owed The amount of token0 owed to the pool.
  /// @param amount1Owed The amount of token1 owed to the pool.
  function uniswapV3MintCallback(
    uint amount0Owed,
    uint amount1Owed,
    bytes calldata /*_data*/
  ) external override {
    require(msg.sender == state.pair.pool, Uni3StrategyErrors.NOT_CALLBACK_CALLER);
    if (amount0Owed > 0) IERC20(state.pair.depositorSwapTokens ? state.pair.tokenB : state.pair.tokenA).safeTransfer(msg.sender, amount0Owed);
    if (amount1Owed > 0) IERC20(state.pair.depositorSwapTokens ? state.pair.tokenA : state.pair.tokenB).safeTransfer(msg.sender, amount1Owed);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Handles the deposit operation.
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    (amountsConsumed, liquidityOut, state.pair.totalLiquidity) = UniswapV3ConverterStrategyLogicLib.enter(
      IUniswapV3Pool(state.pair.pool),
      state.pair.lowerTick,
      state.pair.upperTick,
      amountsDesired_,
      state.pair.totalLiquidity,
      state.pair.depositorSwapTokens
    );
  }

  /// @notice Handles the withdrawal operation.
  /// @param liquidityAmount The amount of liquidity to be withdrawn.
  /// @return amountsOut The amounts of the tokens withdrawn.
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    (uint fee0, uint fee1) = getFees();
    amountsOut = UniswapV3ConverterStrategyLogicLib.exit(state.pair, uint128(liquidityAmount));
    UniswapV3ConverterStrategyLogicLib.sendFeeToProfitHolder(state.pair, fee0, fee1);
  }

  /// @notice Returns the amount of tokens that would be withdrawn based on the provided liquidity amount.
  /// @param liquidityAmount The amount of liquidity to quote the withdrawal for.
  /// @return amountsOut The amounts of the tokens that would be withdrawn, underlying is first
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = UniswapV3ConverterStrategyLogicLib.quoteExit(state.pair, uint128(liquidityAmount));
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claims all possible rewards.
  /// @return tokensOut An array containing the addresses of the reward tokens,
  /// @return amountsOut An array containing the amounts of the reward tokens.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    (tokensOut, amountsOut, balancesBefore) = UniswapV3ConverterStrategyLogicLib.claimRewards(state.pair);
  }
}
