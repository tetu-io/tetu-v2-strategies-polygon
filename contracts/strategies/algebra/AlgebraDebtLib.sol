// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "./AlgebraLib.sol";
import "./AlgebraStrategyErrors.sol";
import "./AlgebraConverterStrategyLogicLib.sol";
import "../../libs/BorrowLib.sol";
import "../pair/PairBasedStrategyLib.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

library AlgebraDebtLib {
  using SafeERC20 for IERC20;

//region  -------------------------------------------- Constants
  uint public constant SELL_GAP = 100;
  address internal constant ONEINCH = 0x1111111254EEB25477B68fb85Ed929f73A960582; // 1inch router V5
  address internal constant OPENOCEAN = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64; // OpenOceanExchangeProxy
//endregion  -------------------------------------------- Constants

//region  -------------------------------------------- Entry data
  /// @notice Calculate proportions of the tokens for entry kind 1
  /// @param pool Pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return prop0 Proportion onf token A. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  /// @return prop1 Proportion onf token B. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  function getEntryDataProportions(
    IAlgebraPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) internal view returns (uint, uint) {
    address token1 = pool.token1();
    uint token1Price = AlgebraLib.getPrice(address(pool), token1);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;
    require(token1Desired != 0, AppErrors.ZERO_VALUE);

    // calculate proportions
    (uint consumed0, uint consumed1,) = AlgebraLib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);
    return depositorSwapTokens
      ? (1e18*consumed1 * token1Price / token1Desired, 1e18*consumed0)
      : (1e18*consumed0, 1e18*consumed1 * token1Price / token1Desired);
  }

//endregion  -------------------------------------------- Entry data

//region  -------------------------------------------- Calc tick range
  function calcTickRange(IAlgebraPool pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
    return PairBasedStrategyLogicLib.calcTickRange(getCurrentTick(pool), tickRange, tickSpacing);
  }

  function getCurrentTick(IAlgebraPool pool) public view returns(int24 tick) {
    (, tick, , , , ,) = pool.globalState();
  }

  /// @notice Calculate the new tick range for a Algebra pool, the tick is read from the pool.
  /// @param pool The Algebra pool to calculate the new tick range for.
  /// @param lowerTick The current lower tick value for the pool.
  /// @param upperTick The current upper tick value for the pool.
  /// @param tickSpacing The tick spacing for the pool.
  /// @return lowerTickNew The new lower tick value for the pool.
  /// @return upperTickNew The new upper tick value for the pool.
  function _calcNewTickRange(
    IAlgebraPool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing
  ) internal view returns (int24 lowerTickNew, int24 upperTickNew) {
    int24 currentTick = getCurrentTick(pool);
    return _calcNewTickRangeForTick(currentTick, lowerTick, upperTick, tickSpacing);
  }

  /// @notice Calculate the new tick range for a Algebra pool, the tick is known.
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
    (uint prop0, uint prop1) = getEntryDataProportions(IAlgebraPool(pairState.pool), newLowerTick, newUpperTick, pairState.depositorSwapTokens);
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
