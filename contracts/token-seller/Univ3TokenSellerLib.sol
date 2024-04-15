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

    /// @notice Min allowed lowest tick
    /// If current prices moves below it, the contract stops to move range and waits when the price will return back.
    int24 minTick;

    /// @notice Required right tick range (same for any price values) = upper tick - tick
    /// Assume, that it's divisible without remainder by tickSpacing
    int24 tickRangeRight;

    /// @notice Required left tick range (same for any price values) = tick - lower tick, can be 0
    /// Assume, that it's divisible without remainder by tickSpacing
    int24 tickRangeLeft;

    /// @notice Amount of token B that cannot be withdrawn from balance inside {refreshPool}
    uint minBalanceTokenB;

    /// @notice Min amount of token B that can be transferred to the receiver
    uint thresholdTokenB;

    /// @notice Threshold for the ratio = (tick - lowerBound) / (lowerBound - upperBound), DENOMINATOR
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

  /// @notice Calculate values of lowerTick and upperTick so that the {tick} is at the left edge of the total range
  /// @param tick Current tick (according to the current price)
  /// @param tickRangeLeft tick - lowerTick. It must be evenly divisible by {tickSpacing}, can be 0
  /// @param tickRangeRight upperTick - tick. It must be evenly divisible by {tickSpacing}
  /// @param tickSpacing Distance between ticks (related to the fee)
  function calcTickRangeAsymmetrical(int24 tick, int24 tickRangeLeft, int24 tickRangeRight, int24 tickSpacing) internal pure returns (
    int24 lowerTick,
    int24 upperTick
  ) {
    if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
      lowerTick = ((tick - tickRangeLeft) / tickSpacing - 1) * tickSpacing;
    } else {
      lowerTick = (tick - tickRangeLeft) / tickSpacing * tickSpacing;
    }
    upperTick = tickRangeRight == 0 ? lowerTick + tickSpacing : lowerTick + tickRangeRight + tickRangeLeft;
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
    uint128 liquidity
  ) internal {
    // get optimal tick range
    (, int24 tick,,,,,) = pool.slot0();
    (int24 tickLower, int24 tickUpper) = Univ3TokenSellerLib.calcTickRangeAsymmetrical(
      tick,
      config.tickRangeLeft,
      config.tickRangeRight,
      tickSpacing
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