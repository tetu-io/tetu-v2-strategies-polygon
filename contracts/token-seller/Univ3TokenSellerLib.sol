// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../integrations/uniswap/IUniswapV3Pool.sol";
import "../strategies/uniswap/UniswapV3Lib.sol";
import "hardhat/console.sol";

library Univ3TokenSellerLib {
  //region ---------------------- Constants
  uint constant private DENOMINATOR = 100_000;
  //endregion ---------------------- Constants

  //region ---------------------- Data types
  struct TokenSellerConfig {
    /// @notice Amount ot token A to invest to the narrow range
    uint amountA;

    /// @notice size of the narrow range (in tickSpacing)
    int24 tickRangeSize;

    /// @notice Min allowed lowest tick
    /// If current prices moves below it, the contract stops to move range and waits when the price return back.
    int24 minTick;

    /// @notice Min amount of token B that can be transferred to the receiver
    uint thresholdTokenB;

    /// @notice Threshold for the current tick. Refresh is required if
    ///   (tick - lower tick) / (upper tick - lower tick)
    /// exceeds the threshold. Decimals = {DENOMINATOR_INT}
    uint thresholdRatio;

    /// @notice Min allowed interval between calls of {refreshPool}
    uint thresholdLastRefreshPoolSec;
  }

  struct TokenSellerState {
    /// @notice Lower bound of the currently opened position
    int24 lowerTick;

    /// @notice Upper bound of the currently opened position
    int24 upperTick;

    /// @notice Liquidity amount deposited to the given range
    uint128 liquidityAmount;

    /// @notice Timestamp of last call of {refreshPool}
    uint lastRefreshPoolTimestamp;
  }

  struct NeedToRefreshLocal {
    int24 lowerTick;
    int24 upperTick;
    int24 tick;
    uint160 sqrtPriceX96;
    uint ratio;
    uint amount0;
    uint amount1;
  }
  //endregion ---------------------- Data types

  //region ---------------------- Events
  event EnterToPool(uint amountA, uint128 liquidity, int24 lowerTick, int24 upperTick);
  event ExitFromPool();
  event Withdraw(address receiver, address token, uint amount);
  event OnSetOwner(address newOwner);
  event OnAcceptOwner(address pendingOwner);

  //endregion ---------------------- Events

  //region ------------------------------ Calculate tick range
  /// @notice Calculate values of lowerTick and upperTick so that the {tick} is in the middle of the total range
  /// @param tick Current tick (according to the current price)
  /// @param tickRange Half of the total range: upperTick - lowerTick = 2 * totalRange.
  /// {tickRange} must be evenly divisible by {tickSpacing}
  /// @param tickSpacing Distance between ticks (related to the fee)
  function calcTickRangeSymmetrically(int24 tick, int24 tickRange, int24 tickSpacing) internal pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
      lowerTick = ((tick - tickRange) / tickSpacing - 1) * tickSpacing;
    } else {
      lowerTick = (tick - tickRange) / tickSpacing * tickSpacing;
    }
    upperTick = tickRange == 0 ? lowerTick + tickSpacing : lowerTick + tickRange * 2;
  }

  /// @notice Calculate values of lowerTick and upperTick so that the {tick} is out of the total range,
  /// but the difference of {tick} and {tickLower} is less or equal to {tickSpacing}
  /// @param tick Current tick (according to the current price)
  /// @param tickRangeSize Size of the tick range in tickSpacing, tickRange = {tickRangeSize} * {tickSpacing}
  /// @param tickSpacing Allowed distance between ticks (it depends on the fee)
  /// @param minTick Min allowed value of lowerTick
  function getNarrowTickRange(int24 tick, int24 tickRangeSize, int24 tickSpacing, int24 minTick) internal pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    console.log("getNarrowTickRange.tick");console.logInt(tick);
    console.log("getNarrowTickRange.tickRangeSize");console.logInt(tickRangeSize);
    console.log("getNarrowTickRange.tickSpacing");console.logInt(tickSpacing);
    console.log("getNarrowTickRange.minTick");console.logInt(minTick);
    lowerTick = max(
      tick < 0 ? tick : tick + tickSpacing - 1,
      minTick < 0 ? minTick : minTick + tickSpacing - 1
    ) / tickSpacing * tickSpacing;
    console.log("getNarrowTickRange.lowerTick");console.logInt(lowerTick);
    console.log("getNarrowTickRange.upperTick");console.logInt(lowerTick + tickRangeSize * tickSpacing);
    return (lowerTick, lowerTick + tickRangeSize * tickSpacing);
  }
  //endregion ------------------------------ Calculate tick range

  //region ---------------------- Enter/exit logic
  function needToRefresh(
    IUniswapV3Pool pool,
    int24 tickSpacing,
    Univ3TokenSellerLib.TokenSellerConfig storage config,
    Univ3TokenSellerLib.TokenSellerState storage state,
    bool poolSwapTokens
  ) internal view returns (bool) {
    console.log("needToRefresh");
    NeedToRefreshLocal memory v;
    if (block.timestamp > state.lastRefreshPoolTimestamp + config.thresholdLastRefreshPoolSec) {
      v.lowerTick = state.lowerTick;
      v.upperTick = state.upperTick;
      (v.sqrtPriceX96, v.tick, ,,,,) = pool.slot0();
      console.log("needToRefresh.tick");console.logInt(v.tick);
      console.log("needToRefresh.v.lowerTick");console.logInt(v.lowerTick);
      console.log("needToRefresh.v.upperTick");console.logInt(v.upperTick);

      if (v.tick <= v.lowerTick) {
        console.log("result.1:v.lowerTick - v.tick > tickSpacing", v.lowerTick - v.tick > tickSpacing);
        // new price is below lower tick, tick range should be moved
        // difference in 1 tickSpacing is allowed, it's exist right after the call of refreshPool()
        return v.lowerTick - v.tick > tickSpacing;
      } else {
        v.ratio = uint(int(v.tick - v.lowerTick)) * DENOMINATOR / uint(int((v.upperTick - v.lowerTick)));
        console.log("v.ratio", v.ratio);
        // new price is higher the lower tick
        (v.amount0, v.amount1) = UniswapV3Lib.getAmountsForLiquidity(v.sqrtPriceX96, v.lowerTick, v.upperTick, pool.liquidity());
        uint amountB = poolSwapTokens ? v.amount0 : v.amount1;
        console.log("v.amount0", v.amount0);
        console.log("v.amount1", v.amount1);
        console.log("amountB", amountB);
        console.log("result.2:amountB > config.thresholdTokenB", amountB > config.thresholdTokenB);
        console.log("result.2:v.ratio > config.thresholdRatio", v.ratio > config.thresholdRatio);
        return amountB > config.thresholdTokenB && v.ratio > config.thresholdRatio;
      }
    } else {
      console.log("needToRefresh.3 - false");
      return false;
    }
  }

  /// @notice Enter to the pool using narrow tick range given by {config}.
  /// Deposit only token A, amount of the second token is always zero.
  /// @param poolSwapTokens False means that token A is pool.token0 and token B is pool.token1 and vice versa
  /// @param amountA Amount of token A to be deposited to the pool. Assume that this amount exists on the balance.
  function enter(
    IUniswapV3Pool pool,
    int24 tickSpacing,
    Univ3TokenSellerLib.TokenSellerConfig storage config,
    Univ3TokenSellerLib.TokenSellerState storage state,
    uint amountA,
    bool poolSwapTokens
  ) internal {
    // get optimal tick range
    (uint160 sqrtRatioX96, int24 tick,,,,,) = pool.slot0();
    (int24 tickLower, int24 tickUpper) = Univ3TokenSellerLib.getNarrowTickRange(
      tick,
      config.tickRangeSize,
      tickSpacing,
      config.minTick
    ); // todo Take into account poolSwapTokens
    console.log("enter.tickLower");console.logInt(tickLower);
    console.log("enter.tickUpper");console.logInt(tickUpper);
    console.log("enter.tick");console.logInt(tick);
    console.log("enter.sqrtRatioX96", sqrtRatioX96);

    uint128 liquidity = UniswapV3Lib.getLiquidityForAmounts(
      sqrtRatioX96,
      tickLower,
      tickUpper,
      poolSwapTokens ? 0 : amountA,
      poolSwapTokens ? amountA : 0
    );
    console.log("enter.liquidity", liquidity);

    // enter to the pool
    IUniswapV3Pool(pool).mint(
      address(this), // owner
      tickLower,
      tickUpper,
      liquidity,
      abi.encode(msg.sender) // source of the liquidity
    );

    // save opened position info
    state.lowerTick = tickLower;
    state.upperTick = tickUpper;
    state.liquidityAmount = liquidity;

    emit EnterToPool(amountA, liquidity, tickLower, tickUpper);
  }

  /// @notice Close position and withdraw all fees and amounts from the pool on balance.
  /// @param clearState True - clear position-related values in {state}
  function exit(
    IUniswapV3Pool pool,
    Univ3TokenSellerLib.TokenSellerState storage state,
    bool clearState
  ) internal {
    // prepare to withdraw liquidity from the pool
    pool.burn(state.lowerTick, state.upperTick, state.liquidityAmount);

    // collect fees and put them to the balance
    pool.collect(address(this), state.lowerTick, state.upperTick, type(uint128).max, type(uint128).max);

    if (clearState) {
      state.lowerTick = 0;
      state.upperTick = 0;
      state.liquidityAmount = 0;
    }

    emit ExitFromPool();
  }
  //endregion ---------------------- Enter/exit logic

  //region ------------------------------ Utils
  /// @notice Returns the largest of two signed numbers.
  function max(int24 a, int24 b) internal pure returns (int24) {
    return a > b ? a : b;
  }
  //endregion ------------------------------ Utils
}