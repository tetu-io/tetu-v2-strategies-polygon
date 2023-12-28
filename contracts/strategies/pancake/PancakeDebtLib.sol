// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "./PancakeLib.sol";
import "./PancakeStrategyErrors.sol";
import "../pair/PairBasedStrategyLogicLib.sol";
import "../../libs/BorrowLib.sol";
import "../../integrations/pancake/IPancakeV3Pool.sol";

library PancakeDebtLib {
  using SafeERC20 for IERC20;

//region  -------------------------------------------- Constants
  uint public constant SELL_GAP = 100;
  /// @dev should be placed local, probably will be adjusted later
  uint internal constant BORROW_PERIOD_ESTIMATION = 30 days / 2;
//endregion  -------------------------------------------- Constants

//region  -------------------------------------------- Entry data
  /// @notice Calculate proportions of the tokens for entry kind 1
  /// @param pool Pool instance
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return prop0 Proportion onf token A. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  /// @return prop1 Proportion onf token B. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  function getEntryDataProportions(
    IPancakeV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) internal view returns (uint, uint) {
    address token1 = pool.token1();
    uint token1Price = PancakeLib.getPrice(address(pool), token1);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;
    require(token1Desired != 0, AppErrors.ZERO_VALUE);

    // calculate proportions
    (uint consumed0, uint consumed1,) = PancakeLib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);

    return depositorSwapTokens
      ? (1e18*consumed1 * token1Price / token1Desired, 1e18*consumed0)
      : (1e18*consumed0, 1e18*consumed1 * token1Price / token1Desired);
  }
//endregion  -------------------------------------------- Entry data

//region  -------------------------------------------- Calc tick range
  function calcTickRange(address pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
    return PairBasedStrategyLogicLib.calcTickRange(getCurrentTick(IPancakeV3Pool(pool)), tickRange, tickSpacing);
  }

  function getCurrentTick(IPancakeV3Pool pool) public view returns(int24 tick) {
    (, tick, , , , ,) = IPancakeV3Pool(pool).slot0();
  }

  /// @notice Calculate the new tick range for a PancakeSwap pool, the tick is read from the pool.
  /// @param pool The PancakeSwap pool to calculate the new tick range for.
  /// @param lowerTick The current lower tick value for the pool.
  /// @param upperTick The current upper tick value for the pool.
  /// @param tickSpacing The tick spacing for the pool.
  /// @return lowerTickNew The new lower tick value for the pool.
  /// @return upperTickNew The new upper tick value for the pool.
  function _calcNewTickRange(
    IPancakeV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing
  ) internal view returns (int24 lowerTickNew, int24 upperTickNew) {
    int24 currentTick = getCurrentTick(pool);
    return _calcNewTickRangeForTick(currentTick, lowerTick, upperTick, tickSpacing);
  }

  /// @notice Calculate the new tick range for a PancakeSwap pool, the tick is known
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
    (uint prop0, uint prop1) = getEntryDataProportions(IPancakeV3Pool(pairState.pool), newLowerTick, newUpperTick, pairState.depositorSwapTokens);
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

//region  -------------------------------------------- Utils
  /// @notice Call v.nft.positions(v.tokenId).
  ///         npm-run-coverage produces stack-too-deep error on direct call of nft.positions, so we use workaround
  /// @dev The function cannot return all params because of stack-too-deep, uncomment only values that you need.
  /// @param nft address of IPancakeNonfungiblePositionManager
  /// @param tokenId nft token
  function callNftPositions(address nft, uint256 tokenId) internal view returns (
//    uint96 nonce,
//    address operator,
//    address token0,
//    address token1,
//    uint24 fee,
    int24 tickLower,
    int24 tickUpper
//    uint128 liquidity,
//    uint256 feeGrowthInside0LastX128,
//    uint256 feeGrowthInside1LastX128,
//    uint128 tokensOwed0,
//    uint128 tokensOwed1
  ) {
    bytes4 selector = bytes4(keccak256("positions(uint256)"));
    uint256[12] memory data;

    assembly {
    // Allocate memory for data to call the function
      let ptr := mload(0x40)
      mstore(ptr, selector)          // Store function selector
      mstore(add(ptr, 0x04), tokenId)   // Store the argument

    // Make the external call
      let success := staticcall(
        gas(),                   // gas remaining
        nft,       // address of the external contract
        ptr,                     // pointer to input data
        0x24,                    // size of input data
        ptr,                     // pointer for output data
        0x180                    // size of output data (12 * 32 bytes)
      )

    // Check if the call was successful
      if eq(success, 0) { revert(0, 0) }

    // Copy return data
      for { let i := 0 } lt(i, 12) { i := add(i, 1) } {
        mstore(add(data, mul(i, 0x20)), mload(add(ptr, mul(i, 0x20))))
      }
    }

//    nonce = uint96(data[0]);
//    operator = address(uint160(data[1]));
//    token0 = address(uint160(data[2]));
//    token1 = address(uint160(data[3]));
//    fee = uint24(data[4]);
    tickLower = int24(int(data[5]));
    tickUpper = int24(int(data[6]));
//    liquidity = uint128(data[7]);
//    feeGrowthInside0LastX128 = data[8];
//    feeGrowthInside1LastX128 = data[9];
//    tokensOwed0 = uint128(data[10]);
//    tokensOwed1 = uint128(data[11]);
  }

//endregion  -------------------------------------------- Utils

}
