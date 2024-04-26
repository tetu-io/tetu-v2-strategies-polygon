// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../integrations/uniswap/IUniswapV3Pool.sol";
import "../strategies/uniswap/UniswapV3Lib.sol";

library Univ3TokenSellerLib {
  //region ---------------------- Constants
  uint constant private DENOMINATOR = 100_000;
  //endregion ---------------------- Constants

  //region ---------------------- Data types
  struct TokenSellerConfig {
    /// @notice Min allowed lowest tick (or MAX allowed upper tick if poolSwapToken is true)
    /// If current prices moves below it, the contract stops to move range and waits when the price return back.
    /// This value can be auto-calculate in constructor/setConfig
    /// if not-zero value of sqrtPriceX96limit is provided
    int24 tickLimit;

    /// @notice size of the narrow range (in tickSpacing)
    uint tickRangeSize;

    /// @notice Amount ot token A to invest to the narrow range
    uint amountA;

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
  }
  //endregion ---------------------- Data types

  //region ---------------------- Errors and events
  error ErrorZeroLiquidityToMint(uint160 sqrtRatioX96, int24 tick, int24 lowerTick, int24 upperTick, uint amountA);

  event EnterToPool(uint amountA, uint128 liquidity, int24 lowerTick, int24 upperTick);
  event ExitFromPool();
  event Withdraw(address receiver, address token, uint amount);
  event OnSetOwner(address newOwner);
  event OnAcceptOwner(address pendingOwner);
  //endregion ---------------------- Errors and events

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
  /// @param sqrtRatioX96 sqrt(current price) * 2pow96
  /// @param tick Current tick (according to the current price)
  /// @param tickRangeSize Size of the tick range in tickSpacing, tickRange = {tickRangeSize} * {tickSpacing}
  /// @param tickSpacing Allowed distance between ticks (it depends on the fee)
  /// @param tickLimit Min allowed value of lowerTick (or MAX allowed value of upperTick if poolSwapTokens is true)
  /// @param poolSwapTokens False: token0=tokenA, token1=tokenB; true: token0=tokenB, token1=tokenA
  function getNarrowTickRange(
    uint160 sqrtRatioX96,
    int24 tick,
    uint tickRangeSize,
    int24 tickSpacing,
    int24 tickLimit,
    bool poolSwapTokens
  ) internal pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    if (poolSwapTokens) {
      upperTick = min(
        tick > 0 ? tick : tick - tickSpacing + 1,
        tickLimit > 0 ? tickLimit : tickLimit - tickSpacing + 1
      ) / tickSpacing * tickSpacing;

      // the tick should lay out of range [lowerTick, upperTick], otherwise some amount of token B is required
      // possible situation: Price1 => Tick0, Price2 => Tick0, Price1 > Price2; so we need additional check of the prices
      uint160 sqrtRatioBX96 = UniswapV3Lib._getSqrtRatioAtTick(upperTick);
      if (sqrtRatioBX96 > sqrtRatioX96) {
        upperTick -= tickSpacing;
      }

      return (upperTick - int24(int(tickRangeSize)) * tickSpacing, upperTick);
    } else {
      lowerTick = max(
        tick < 0 ? tick : tick + tickSpacing - 1,
        tickLimit < 0 ? tickLimit : tickLimit + tickSpacing - 1
      ) / tickSpacing * tickSpacing;

      // the tick should lay out of range [lowerTick, upperTick], otherwise some amount of token B is required
      // possible situation: Price1 => Tick0, Price2 => Tick0, Price1 > Price2; so we need additional check of the prices
      uint160 sqrtRatioAX96 = UniswapV3Lib._getSqrtRatioAtTick(lowerTick);
      if (sqrtRatioAX96 < sqrtRatioX96) {
        lowerTick += tickSpacing;
      }

      return (lowerTick, lowerTick + int24(int(tickRangeSize)) * tickSpacing);
    }
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
    NeedToRefreshLocal memory v;
    if (state.liquidityAmount != 0 && block.timestamp > state.lastRefreshPoolTimestamp + config.thresholdLastRefreshPoolSec) {
      v.lowerTick = state.lowerTick;
      v.upperTick = state.upperTick;
      (v.sqrtPriceX96, v.tick, ,,,,) = pool.slot0();

      if (poolSwapTokens) {
        if (v.tick >= v.upperTick) {
          // new price is greater upper tick, tick range should be moved
          // difference in 1 tickSpacing is allowed, it's exist right after the call of refreshPool()
          return v.tick - v.upperTick > tickSpacing;
        } else {
          v.ratio = uint(int(v.upperTick - v.tick)) * DENOMINATOR / uint(int((v.upperTick - v.lowerTick)));
          // new price is higher the lower tick. There is a problem here: amountB doesn't take into account fees
          (uint amountB, ) = UniswapV3Lib.getAmountsForLiquidity(v.sqrtPriceX96, v.lowerTick, v.upperTick, pool.liquidity());
          return amountB > config.thresholdTokenB && v.ratio > config.thresholdRatio;
        }
      } else {
        if (v.tick <= v.lowerTick) {
          // new price is below lower tick, tick range should be moved
          // difference in 1 tickSpacing is allowed, it's exist right after the call of refreshPool()
          return v.lowerTick - v.tick > tickSpacing;
        } else {
          v.ratio = uint(int(v.tick - v.lowerTick)) * DENOMINATOR / uint(int((v.upperTick - v.lowerTick)));
          // new price is higher the lower tick. There is a problem here: amountB doesn't take into account fees
          (, uint amountB) = UniswapV3Lib.getAmountsForLiquidity(v.sqrtPriceX96, v.lowerTick, v.upperTick, pool.liquidity());
          return amountB > config.thresholdTokenB && v.ratio > config.thresholdRatio;
        }
      }
    } else {
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
      sqrtRatioX96,
      tick,
      config.tickRangeSize,
      tickSpacing,
      config.tickLimit,
      poolSwapTokens
    );

    uint128 liquidity = UniswapV3Lib.getLiquidityForAmounts(
      sqrtRatioX96,
      tickLower,
      tickUpper,
      poolSwapTokens ? 0 : amountA,
      poolSwapTokens ? amountA : 0
    );
    if (liquidity == 0) revert ErrorZeroLiquidityToMint(sqrtRatioX96, tick, tickLower, tickUpper, amountA);

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
  /// @notice Returns the smallest of two signed numbers.
  function min(int24 a, int24 b) internal pure returns (int24) {
    return a < b ? a : b;
  }
  //endregion ------------------------------ Utils

  //region ------------------------------ Calculate amount required to swap
  /// @notice Calculate what amount should be swapped to move current price to given target value.
  /// @param targetSqrtPriceX96 Required price after the swap (sqrt price * 2pow96)
  /// @param swapToken1 True if pool.token1 should be swapped
  /// @param amountToSwap Amount of token 0 or 1 (depends on swapToken1) that should be swapped
  /// to set current price in the pool equal to the {targetSqrtPriceX96}
  function getAmountToSwap(IUniswapV3Pool pool, uint160 targetSqrtPriceX96) internal view returns (
    bool swapToken1,
    uint amountToSwap
  ) {
    (uint160 sqrtPriceX96, int24 tick,,,,,) = pool.slot0();
    int24 tickSpacing = pool.tickSpacing();
    uint128 liquidity = pool.liquidity();
    int24 lowerTick = (tick / tickSpacing) * tickSpacing == tick
      ? tick
      : (tick / tickSpacing) * tickSpacing - tickSpacing;
    int24 upperTick = lowerTick + tickSpacing;
    swapToken1 = targetSqrtPriceX96 > sqrtPriceX96;

    if (swapToken1) {
      // it's necessary to swap token1 => token0
      while (targetSqrtPriceX96 > sqrtPriceX96) {
        uint160 upperSqrtPriceX96 = UniswapV3Lib._getSqrtRatioAtTick(upperTick);
        if (targetSqrtPriceX96 > upperSqrtPriceX96) {
          amountToSwap += UniswapV3Lib._getAmount1ForLiquidity(sqrtPriceX96, upperSqrtPriceX96, liquidity);
          (,int128 liquidityNet,,,,,,) = pool.ticks(upperTick);
          if (liquidityNet > 0) {
            liquidity += uint128(liquidityNet);
          } else {
            liquidity -= uint128(-liquidityNet);
          }
          sqrtPriceX96 = upperSqrtPriceX96;
          lowerTick += tickSpacing;
          upperTick += tickSpacing;
        } else {
          amountToSwap += UniswapV3Lib._getAmount1ForLiquidity(sqrtPriceX96, targetSqrtPriceX96, liquidity);
          sqrtPriceX96 = targetSqrtPriceX96;
        }
      }
    } else {
      // it's necessary to swap token0 => token1
      while (targetSqrtPriceX96 < sqrtPriceX96) {
        uint160 lowerSqrtPriceX96 = UniswapV3Lib._getSqrtRatioAtTick(lowerTick);
        if (targetSqrtPriceX96 < lowerSqrtPriceX96) {
          amountToSwap += UniswapV3Lib._getAmount0ForLiquidity(sqrtPriceX96, lowerSqrtPriceX96, liquidity);
          (,int128 liquidityNet,,,,,,) = pool.ticks(lowerTick);
          if (liquidityNet > 0) {
            liquidity -= uint128(liquidityNet);
          } else {
            liquidity += uint128(-liquidityNet);
          }
          sqrtPriceX96 = lowerSqrtPriceX96;
          lowerTick -= tickSpacing;
          upperTick -= tickSpacing;
        } else {
          amountToSwap += UniswapV3Lib._getAmount0ForLiquidity(sqrtPriceX96, targetSqrtPriceX96, liquidity);
          sqrtPriceX96 = targetSqrtPriceX96;
        }
      }
    }

    return (swapToken1, amountToSwap);
  }
  //endregion ------------------------------ Calculate amount required to swap

}