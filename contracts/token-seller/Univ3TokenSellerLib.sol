// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../integrations/uniswap/IUniswapV3Pool.sol";
import "../strategies/uniswap/UniswapV3Lib.sol";

library Univ3TokenSellerLib {
  //region ---------------------- Constants
  int24 constant private DENOMINATOR_INT = 100_000;
  //endregion ---------------------- Constants

  //region ---------------------- Data types
  struct Config {
    /// @notice Receiver of the token B
    address receiver;

    /// @notice Amount ot token A to invest to the narrow range
    uint amountA;

    /// @notice size of the narrow range
    int24 tickRange;

    /// @notice Min allowed lowest tick
    /// If current prices moves below it, the contract stops to move range and waits when the price return back.
    int24 minTick;

    /// @notice Min amount of token B that can be transferred to the receiver
    uint thresholdTokenB;

    /// @notice Threshold for the current tick. Refresh is required if
    /// (tick - lower tick) / (upper tick - lower tick)
    ///  exceeds the threshold
    uint thresholdRatio;
  }

  struct State {
    /// @notice Lower bound of the currently opened position
    int24 lowerTick;

    /// @notice Upper bound of the currently opened position
    int24 upperTick;

    /// @notice Liquidity amount deposited to the given range
    uint128 liquidityAmount;
  }
  //endregion ---------------------- Data types

  //region ------------------------------ Utils
  /// @notice Calculate distance from current tick to lower bound in percents of the total tick range, decimals 5
  function calcNeedToRefreshRatio(int24 tick, int24 lowerBound, int24 upperBound) internal pure returns (int24 ratio) {
    return (tick - lowerBound) * DENOMINATOR_INT / (upperBound - lowerBound);
  }

  //endregion ------------------------------ Utils

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

  /// @notice Calculate values of lowerTick and upperTick so that the {tick} is out of the total range
  /// and tick - tickLower <= tickSpacing
  /// @param tick Current tick (according to the current price)
  /// @param tickRangeLeft tick - lowerTick. It must be evenly divisible by {tickSpacing}, can be 0
  /// @param tickRangeRight upperTick - tick. It must be evenly divisible by {tickSpacing}
  /// @param tickSpacing Distance between ticks (related to the fee)
  function getNarrowTickRange(int24 tick, int24 tickRange, int24 tickSpacing) internal pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    // todo
    return (lowerTick, upperTick);
  }
  //endregion ------------------------------ Calculate tick range

  //region ------------------------------ Price calculations
  /// @notice Calculate y = y(c, d, x, P)
  /// See https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf
  /// formulas 23, 24
  /// @notice c By definition c^2 * P = p_upper, decimals 18
  /// @notice d By definition d^2 * P = p_lower, decimals 18
  /// @notice P Current price
  /// @notice x Amount 0
  /// @return y Amount 1
  function getY(uint p, uint c, uint d, uint x) external pure returns (uint y) {
    y = (d - 1e18) * c * p * x / (1e18 - c);
  }
  //endregion ------------------------------ Price calculations

  //region ---------------------- Enter/exit logic
  function _enter(
    IUniswapV3Pool pool,
    int24 tickSpacing,
    Univ3TokenSellerLib.Config storage config,
    Univ3TokenSellerLib.State storage state,
    uint amountA
  ) internal {
    // get optimal tick range
    (uint160 sqrtRatioX96, int24 tick,,,,,) = pool.slot0();
    (int24 tickLower, int24 tickUpper) = Univ3TokenSellerLib.getNarrowTickRange(tick, config.tickRange, tickSpacing);
    uint128 liquidity = UniswapV3Lib.getLiquidityForAmounts(
      sqrtRatioX96,
      tickLower,
      tickUpper,
      amountA,
      0
    );

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
  }

  function _exit(
    IUniswapV3Pool pool,
    Univ3TokenSellerLib.State storage state,
    bool clearState
  ) external {
    // withdraw liquidity from the pool to the balance
    pool.burn(state.lowerTick, state.upperTick, state.liquidityAmount);

    // collect fees and put them to the balance
    pool.collect(address(this), state.lowerTick, state.upperTick, type(uint128).max, type(uint128).max);

    if (clearState) {
      state.lowerTick = 0;
      state.upperTick = 0;
      state.liquidityAmount = 0;
    }
  }
  //endregion ---------------------- Enter/exit logic

}