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
    PairBasedStrategyLib.FuseStateParams[2] memory fuseAB
  ) external {
    state.pair.tokenA = tokensAB[0];
    state.pair.tokenB = tokensAB[1];

    state.pair.pool = address(pool);
    state.pair.isStablePool = isStablePool;

    state.pair.tickSpacing = tickParams[0];
    state.pair.lowerTick = tickParams[1];
    state.pair.upperTick = tickParams[2];
    state.pair.rebalanceTickRange = tickParams[3];

    state.pair.depositorSwapTokens = depositorSwapTokens;
    state.pair.totalLiquidity = totalLiquidity;
    state.pair.strategyProfitHolder = strategyProfitHolder;
    state.pair.fuseAB[0] = fuseAB[0];
    state.pair.fuseAB[1] = fuseAB[1];
  }

  function needStrategyRebalance(ITetuConverter converter_) external view returns (bool needRebalance) {
    return UniswapV3ConverterStrategyLogicLib.needStrategyRebalance(state.pair, converter_);
  }
}