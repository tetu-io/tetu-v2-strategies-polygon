// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuVaultV2.sol";
import "./UniswapV3Lib.sol";
import "./Uni3StrategyErrors.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "../../libs/BorrowLib.sol";
import "../../interfaces/IPairBasedStrategyReaderAccess.sol";
import "../pair/PairBasedStrategyLib.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

library UniswapV3DebtLib {
  using SafeERC20 for IERC20;

//region  -------------------------------------------- Constants
  uint public constant SELL_GAP = 100;
  /// @dev should be placed local, probably will be adjusted later
  uint internal constant BORROW_PERIOD_ESTIMATION = 30 days / 2;
//endregion  -------------------------------------------- Constants

//region  -------------------------------------------- Rewards
  function coverLossFromRewards(uint loss, address strategyProfitHolder, address tokenA, address tokenB, address pool) external returns (uint covered) {
    uint bA = IERC20Metadata(tokenA).balanceOf(strategyProfitHolder);
    uint bB = IERC20Metadata(tokenB).balanceOf(strategyProfitHolder);

    if (loss <= bA) {
      IERC20(tokenA).safeTransferFrom(strategyProfitHolder, address(this), loss);
      covered = loss;
    } else {
      uint needToCoverA = loss;
      if (bA > 0) {
        IERC20(tokenA).safeTransferFrom(strategyProfitHolder, address(this), bA);
        needToCoverA -= bA;
      }
      if (bB > 0) {
        uint needTransferB = UniswapV3Lib.getPrice(pool, tokenA) * needToCoverA / 10 ** IERC20Metadata(tokenA).decimals();
        uint canTransferB = Math.min(needTransferB, bB);
        // There is a chance to have needTransferB == canTransferB == 0 if loss = 1
        if (canTransferB != 0) {
          IERC20(tokenB).safeTransferFrom(strategyProfitHolder, address(this), canTransferB);
          needToCoverA -= needToCoverA * canTransferB / needTransferB; // needTransferB >= canTransferB != 0 here
        }
      }
      covered = loss - needToCoverA;
    }
  }
//endregion  -------------------------------------------- Rewards

//region  -------------------------------------------- Entry data
  function getEntryData(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    (uint prop0, uint prop1) = getEntryDataProportions(pool, lowerTick, upperTick, depositorSwapTokens);
    entryData = abi.encode(1, prop0, prop1);
  }

  /// @notice Calculate proportions of the tokens for entry kind 1
  function getEntryDataProportions(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (uint, uint) {
    address token1 = pool.token1();
    uint token1Price = UniswapV3Lib.getPrice(address(pool), token1);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;
    require(token1Desired != 0, AppErrors.ZERO_VALUE);

    // calculate proportions
    (uint consumed0, uint consumed1,) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);

    return depositorSwapTokens
      ? (consumed1 * token1Price / token1Desired, consumed0)
      : (consumed0, consumed1 * token1Price / token1Desired);
  }
//endregion  -------------------------------------------- Entry data

//region  -------------------------------------------- Calc tick range
  function calcTickRange(address pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
    return PairBasedStrategyLogicLib.calcTickRange(getCurrentTick(IUniswapV3Pool(pool)), tickRange, tickSpacing);
  }

  function getCurrentTick(IUniswapV3Pool pool) public view returns(int24 tick) {
    (, tick, , , , ,) = IUniswapV3Pool(pool).slot0();
  }

  /// @notice Calculate the new tick range for a Uniswap V3 pool, the tick is read from the pool.
  /// @param pool The Uniswap V3 pool to calculate the new tick range for.
  /// @param lowerTick The current lower tick value for the pool.
  /// @param upperTick The current upper tick value for the pool.
  /// @param tickSpacing The tick spacing for the pool.
  /// @return lowerTickNew The new lower tick value for the pool.
  /// @return upperTickNew The new upper tick value for the pool.
  function _calcNewTickRange(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing
  ) internal view returns (int24 lowerTickNew, int24 upperTickNew) {
    int24 currentTick = getCurrentTick(pool);
    return _calcNewTickRangeForTick(currentTick, lowerTick, upperTick, tickSpacing);
  }

  /// @notice Calculate the new tick range for a Uniswap V3 pool, the tick is known
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
  /// @notice Calculate right asset proportions, make rebalance, update lower/upper ticks in {pairState}
  /// @param tick Current tick in the pool
  function rebalanceNoSwaps(
    address[2] calldata converterLiquidator,
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint profitToCover,
    uint totalAssets,
    address splitter,
    mapping(address => uint) storage liquidityThresholds_,
    int24 tick
  ) external {
    (int24 newLowerTick, int24 newUpperTick) = _calcNewTickRangeForTick(tick, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
    (uint prop0, uint prop1) = getEntryDataProportions(IUniswapV3Pool(pairState.pool), newLowerTick, newUpperTick, pairState.depositorSwapTokens);
    PairBasedStrategyLogicLib.rebalanceNoSwaps(
      converterLiquidator,
      pairState,
      profitToCover,
      totalAssets,
      splitter,
      liquidityThresholds_,
      prop0 * BorrowLib.SUM_PROPORTIONS / (prop0 + prop1)
    );
    (pairState.lowerTick, pairState.upperTick) = (newLowerTick, newUpperTick);
  }
//endregion  -------------------------------------------- Rebalance

}
