// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../../libs/AppErrors.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";

abstract contract UniswapV3Depositor is IUniswapV3MintCallback, DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant UNISWAPV3_DEPOSITOR_VERSION = "1.0.0";

  /////////////////////////////////////////////////////////////////////
  ///                VARIABLES
  /////////////////////////////////////////////////////////////////////

  UniswapV3ConverterStrategyLogicLib.State internal state;

  /////////////////////////////////////////////////////////////////////
  ///                INIT
  /////////////////////////////////////////////////////////////////////

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

  function getState() external view returns (
    address tokenA,
    address tokenB,
    IUniswapV3Pool pool,
    int24 tickSpacing,
    int24 lowerTick,
    int24 upperTick,
    int24 rebalanceTickRange,
    uint128 totalLiquidity,
    uint rebalanceEarned0,
    uint rebalanceEarned1,
    uint rebalanceLost,
    bool isFuseTriggered,
    uint fuseThreshold
  ) {
    return (
    state.tokenA,
    state.tokenB,
    state.pool,
    state.tickSpacing,
    state.lowerTick,
    state.upperTick,
    state.rebalanceTickRange,
    state.totalLiquidity,
    state.rebalanceEarned0,
    state.rebalanceEarned1,
    state.rebalanceLost,
    state.isFuseTriggered,
    state.fuseThreshold
    );
  }

  function getFees() internal view returns (uint fee0, uint fee1) {
    return UniswapV3ConverterStrategyLogicLib.getFees(state);
  }

  /// @notice Returns pool assets
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = state.tokenA;
    poolAssets[1] = state.tokenB;
  }

  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](2);
    weights[0] = 1;
    weights[1] = 1;
    totalWeight = 2;
  }

  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    return UniswapV3ConverterStrategyLogicLib.getPoolReserves(state);
  }

  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(state.totalLiquidity);
  }

  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(state.totalLiquidity);
  }

  /////////////////////////////////////////////////////////////////////
  ///                CALLBACK
  /////////////////////////////////////////////////////////////////////

  /// @notice Uniswap V3 callback fn, called back on pool.mint
  function uniswapV3MintCallback(
    uint amount0Owed,
    uint amount1Owed,
    bytes calldata /*_data*/
  ) external override {
    require(msg.sender == address(state.pool), "callback caller");
    // console.log('uniswapV3MintCallback amount0Owed', amount0Owed);
    // console.log('uniswapV3MintCallback amount1Owed', amount1Owed);
    if (amount0Owed > 0) IERC20(state.depositorSwapTokens ? state.tokenB : state.tokenA).safeTransfer(msg.sender, amount0Owed);
    if (amount1Owed > 0) IERC20(state.depositorSwapTokens ? state.tokenA : state.tokenB).safeTransfer(msg.sender, amount1Owed);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    (amountsConsumed, liquidityOut, state.totalLiquidity) = UniswapV3ConverterStrategyLogicLib.enter(state.pool, state.lowerTick, state.upperTick, amountsDesired_, state.totalLiquidity, state.depositorSwapTokens);
  }

  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    (uint fee0, uint fee1) = getFees();
    state.rebalanceEarned0 += fee0;
    state.rebalanceEarned1 += fee1;
    (amountsOut, state.totalLiquidity, state.totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.exit(state.pool, state.lowerTick, state.upperTick, state.lowerTickFillup, state.upperTickFillup, state.totalLiquidity, state.totalLiquidityFillup, uint128(liquidityAmount), state.depositorSwapTokens);
  }

  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = UniswapV3ConverterStrategyLogicLib.quoteExit(state.pool, state.lowerTick, state.upperTick, state.lowerTickFillup, state.upperTickFillup, state.totalLiquidity, state.totalLiquidityFillup, uint128(liquidityAmount), state.depositorSwapTokens);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    amountsOut = UniswapV3ConverterStrategyLogicLib.claimRewards(state.pool, state.lowerTick, state.upperTick, state.lowerTickFillup, state.upperTickFillup, state.rebalanceEarned0, state.rebalanceEarned1, state.depositorSwapTokens);
    state.rebalanceEarned0 = 0;
    state.rebalanceEarned1 = 0;
    tokensOut = new address[](2);
    tokensOut[0] = state.tokenA;
    tokensOut[1] = state.tokenB;
  }

}
