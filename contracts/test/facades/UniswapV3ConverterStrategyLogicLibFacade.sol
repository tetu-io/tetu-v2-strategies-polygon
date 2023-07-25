// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/uniswap/UniswapV3ConverterStrategyLogicLib.sol";

contract UniswapV3ConverterStrategyLogicLibFacade {
  UniswapV3ConverterStrategyLogicLib.State internal state;

  /// @param tickParams [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  function setState(
    address[2] memory tokensAB,
    IUniswapV3Pool pool,
    bool isStablePool,
    int24[4] memory tickParams,
    bool depositorSwapTokens,
    uint128 totalLiquidity,
    address strategyProfitHolder,
    PairBasedStrategyLib.FuseStateParams memory fuse
  ) external {
    state.tokenA = tokensAB[0];
    state.tokenB = tokensAB[1];

    state.pool = pool;
    state.isStablePool = isStablePool;

    state.tickSpacing = tickParams[0];
    state.lowerTick = tickParams[1];
    state.upperTick = tickParams[2];
    state.rebalanceTickRange = tickParams[3];

    state.depositorSwapTokens = depositorSwapTokens;
    state.totalLiquidity = totalLiquidity;
    state.strategyProfitHolder = strategyProfitHolder;
    state.fuse = fuse;
  }

  function needStrategyRebalance(ITetuConverter converter_) external view returns (bool needRebalance) {
    return UniswapV3ConverterStrategyLogicLib.needStrategyRebalance(state, converter_);
  }

  function _needStrategyRebalance(
    ITetuConverter converter_,
    IUniswapV3Pool pool_,
    PairBasedStrategyLib.FuseStateParams memory fuse_,
    address tokenA,
    address tokenB
  ) internal view returns (
    bool strategyRebalanceRequired,
    bool fuseStatusChanged,
    PairBasedStrategyLib.FuseStatus fuseStatus
  ) {
    return UniswapV3ConverterStrategyLogicLib._needStrategyRebalance(state, converter_, pool_, fuse_, tokenA, tokenB);
  }

  function _needPoolRebalance(IUniswapV3Pool pool) internal view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib._needPoolRebalance(pool, state);
  }
}