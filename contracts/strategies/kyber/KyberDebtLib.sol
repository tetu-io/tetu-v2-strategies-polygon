// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "./KyberLib.sol";
import "./KyberStrategyErrors.sol";
import "./KyberConverterStrategyLogicLib.sol";
import "../../libs/BorrowLib.sol";
import "../pair/PairBasedStrategyLib.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

library KyberDebtLib {
  using SafeERC20 for IERC20;

  //region  -------------------------------------------- Entry data
  /// @notice Calculate proportions of the tokens for entry kind 1
  /// @param pool Pool instance
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return prop0 Proportion onf token A. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  /// @return prop1 Proportion onf token B. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  function getEntryDataProportions(
    IPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) internal view returns (uint, uint) {
    address token1 = address(pool.token1());
    uint token1Price = KyberLib.getPrice(address(pool), token1);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;
    require(token1Desired != 0, AppErrors.ZERO_VALUE);

    // calculate proportions
    (uint consumed0, uint consumed1,) = KyberLib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);
    return depositorSwapTokens
      ? (1e18*consumed1 * token1Price / token1Desired, 1e18*consumed0)
      : (1e18*consumed0, 1e18*consumed1 * token1Price / token1Desired);
  }

  function getEntryData(
    IPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    (uint prop0, uint prop1) = getEntryDataProportions(pool, lowerTick, upperTick, depositorSwapTokens);
    entryData = abi.encode(1, prop0, prop1);
  }
  //endregion  -------------------------------------------- Entry data

  //region  -------------------------------------------- Calc tick range
  function calcTickRange(IPool pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
    (, int24 tick, ,) = pool.getPoolState();
    return PairBasedStrategyLogicLib.calcTickRange(tick, tickRange, tickSpacing);
  }

  function getCurrentTick(IPool pool) public view returns(int24 tick) {
    (, tick, ,) = pool.getPoolState();
  }

  /// @notice Calculate the new tick range for a Kyber pool, the tick is read from the pool
  /// @param pool The Kyber pool to calculate the new tick range for.
  /// @param lowerTick The current lower tick value for the pool.
  /// @param upperTick The current upper tick value for the pool.
  /// @param tickSpacing The tick spacing for the pool.
  /// @return lowerTickNew The new lower tick value for the pool.
  /// @return upperTickNew The new upper tick value for the pool.
  function _calcNewTickRange(
    IPool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing
  ) internal view returns (int24 lowerTickNew, int24 upperTickNew) {
    int24 currentTick = getCurrentTick(pool);
    return _calcNewTickRangeForTick(currentTick, lowerTick, upperTick, tickSpacing);
  }

  /// @notice Calculate the new tick range for a Kyber pool, the tick is already known
  function _calcNewTickRangeForTick(
    int24 currentTick,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing
  ) internal pure returns (int24 lowerTickNew, int24 upperTickNew) {
    int24 fullTickRange = upperTick - lowerTick;
    int24 tickRange = fullTickRange == tickSpacing
      ? int24(0)
      : fullTickRange / 2;
    return PairBasedStrategyLogicLib.calcTickRange(currentTick, tickRange, tickSpacing);
  }
  //endregion  -------------------------------------------- Calc tick range

  //region  -------------------------------------------- Rebalance
  /// @param liquidationThresholdsAB [liquidityThreshold of token A, liquidityThreshold of tokenB]
  function rebalanceNoSwaps(
    address[2] calldata converterLiquidator,
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint profitToCover,
    uint totalAssets,
    address splitter,
    uint[2] calldata liquidationThresholdsAB,
    int24 tick
  ) external {
    (int24 newLowerTick, int24 newUpperTick) = _calcNewTickRangeForTick(tick, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
    (uint prop0, uint prop1) = getEntryDataProportions(IPool(pairState.pool), newLowerTick, newUpperTick, pairState.depositorSwapTokens);
    PairBasedStrategyLogicLib._rebalanceNoSwaps(
      converterLiquidator,
      pairState,
      profitToCover,
      totalAssets,
      splitter,
  liquidationThresholdsAB,
      prop0 * BorrowLib.SUM_PROPORTIONS / (prop0 + prop1)
    );
    (pairState.lowerTick, pairState.upperTick) = (newLowerTick, newUpperTick);
  }
  //endregion  -------------------------------------------- Rebalance
}
