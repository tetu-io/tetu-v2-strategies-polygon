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
  string public constant UNISWAPV3_DEPOSITOR_VERSION = "1.0.1";

  /////////////////////////////////////////////////////////////////////
  ///                VARIABLES
  /////////////////////////////////////////////////////////////////////

  /// @dev State variable to store the current state of the whole strategy
  UniswapV3ConverterStrategyLogicLib.State internal state;

  /////////////////////////////////////////////////////////////////////
  ///                INIT
  /////////////////////////////////////////////////////////////////////

  /// @dev Initializes the contract with the provided parameters.
  /// @param asset_ The address of the asset.
  /// @param pool_ The address of the Uniswap V3 pool.
  /// @param tickRange_ The tick range for the positions.
  /// @param rebalanceTickRange_ The tick range for rebalancing.
  function __UniswapV3Depositor_init(
    address asset_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) internal onlyInitializing {
    require(pool_ != address(0), AppErrors.ZERO_ADDRESS);
    state.pool = IUniswapV3Pool(pool_);
    state.rebalanceTickRange = rebalanceTickRange_;
    (
    state.tickSpacing,
    state.lowerTick,
    state.upperTick,
    state.tokenA,
    state.tokenB,
    state.depositorSwapTokens
    ) = UniswapV3ConverterStrategyLogicLib.calcInitialDepositorValues(
      state.pool,
      tickRange_,
      rebalanceTickRange_,
      asset_
    );
  }


  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns the current state of the contract.
  function getState() external view returns (
    address tokenA,
    address tokenB,
    IUniswapV3Pool pool,
    int24 tickSpacing,
    int24 lowerTick,
    int24 upperTick,
    int24 rebalanceTickRange,
    uint128 totalLiquidity,
    bool isFuseTriggered,
    uint fuseThreshold,
    uint[] memory rebalanceResults
  ) {
    tokenA = state.tokenA;
    tokenB = state.tokenB;
    pool = state.pool;
    tickSpacing = state.tickSpacing;
    lowerTick = state.lowerTick;
    upperTick = state.upperTick;
    rebalanceTickRange = state.rebalanceTickRange;
    totalLiquidity = state.totalLiquidity;
    isFuseTriggered = state.isFuseTriggered;
    fuseThreshold = state.fuseThreshold;

    rebalanceResults = new uint[](3);
    rebalanceResults[0] = state.rebalanceEarned0;
    rebalanceResults[1] = state.rebalanceEarned1;
    rebalanceResults[2] = state.rebalanceLost;
  }

  /// @notice Returns the fees for the current state.
  /// @return fee0 and fee1.
  function getFees() public view returns (uint fee0, uint fee1) {
    return UniswapV3ConverterStrategyLogicLib.getFees(state);
  }

  /// @notice Returns the pool assets.
  /// @return poolAssets An array containing the addresses of the pool assets.
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = state.tokenA;
    poolAssets[1] = state.tokenB;
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
    return UniswapV3ConverterStrategyLogicLib.getPoolReserves(state);
  }

  /// @notice Returns the current liquidity of the depositor.
  /// @return The current liquidity of the depositor.
  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(state.totalLiquidity);
  }

  /// @notice Returns the total supply of the depositor.
  /// @return In UniV3 we can not calculate the total supply of the wgole pool. Return only ourself value.
  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(state.totalLiquidity);
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
    require(msg.sender == address(state.pool), Uni3StrategyErrors.NOT_CALLBACK_CALLER);
    if (amount0Owed > 0) IERC20(state.depositorSwapTokens ? state.tokenB : state.tokenA).safeTransfer(msg.sender, amount0Owed);
    if (amount1Owed > 0) IERC20(state.depositorSwapTokens ? state.tokenA : state.tokenB).safeTransfer(msg.sender, amount1Owed);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Handles the deposit operation.
  function _depositorEnter(
    uint[] memory amountsDesired_
  ) override internal virtual returns (uint[] memory amountsConsumed, uint liquidityOut) {
    (amountsConsumed, liquidityOut, state.totalLiquidity) = UniswapV3ConverterStrategyLogicLib.enter(state.pool, state.lowerTick, state.upperTick, amountsDesired_, state.totalLiquidity, state.depositorSwapTokens);
  }

  /// @notice Handles the withdrawal operation.
  /// @param liquidityAmount The amount of liquidity to be withdrawn.
  /// @return amountsOut The amounts of the tokens withdrawn.
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    (uint fee0, uint fee1) = getFees();
    state.rebalanceEarned0 += fee0;
    state.rebalanceEarned1 += fee1;
    (amountsOut, state.totalLiquidity, state.totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.exit(state.pool, state.lowerTick, state.upperTick, state.lowerTickFillup, state.upperTickFillup, state.totalLiquidity, state.totalLiquidityFillup, uint128(liquidityAmount), state.depositorSwapTokens);
  }

  /// @notice Returns the amount of tokens that would be withdrawn based on the provided liquidity amount.
  /// @param liquidityAmount The amount of liquidity to quote the withdrawal for.
  /// @return amountsOut The amounts of the tokens that would be withdrawn.
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = UniswapV3ConverterStrategyLogicLib.quoteExit(state.pool, state.lowerTick, state.upperTick, state.lowerTickFillup, state.upperTickFillup, state.totalLiquidity, state.totalLiquidityFillup, uint128(liquidityAmount), state.depositorSwapTokens);
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

    tokensOut = new address[](2);
    tokensOut[0] = state.tokenA;
    tokensOut[1] = state.tokenB;

    (amountsOut, balancesBefore) = UniswapV3ConverterStrategyLogicLib.claimRewards(
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.lowerTickFillup,
      state.upperTickFillup,
      state.rebalanceEarned0,
      state.rebalanceEarned1,
      state.depositorSwapTokens,
      tokensOut
    );
    state.rebalanceEarned0 = 0;
    state.rebalanceEarned1 = 0;
  }

  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[49] private __gap;

}
