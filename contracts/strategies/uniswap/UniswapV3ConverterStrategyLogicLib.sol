// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "./UniswapV3Lib.sol";

library UniswapV3ConverterStrategyLogicLib {

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 100;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  uint internal constant SELL_GAP = 100;
  uint internal constant BORROW_PERIOD_ESTIMATION = 30 days / 2;

  //////////////////////////////////////////
  //            STRUCTURES
  //////////////////////////////////////////

  struct State {
    address tokenA;
    address tokenB;
    IUniswapV3Pool pool;
    int24 tickSpacing;
    bool fillUp;
    bool isStablePool;
    int24 lowerTick;
    int24 upperTick;
    int24 lowerTickFillup;
    int24 upperTickFillup;
    int24 rebalanceTickRange;
    bool depositorSwapTokens;
    uint128 totalLiquidity;
    uint128 totalLiquidityFillup;
    uint rebalanceEarned0;
    uint rebalanceEarned1;
    uint rebalanceLost;
    bool isFuseTriggered;
    uint fuseThreshold;
    uint lastPrice;
  }

  struct TryCoverLossParams {
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    bool depositorSwapTokens;
    uint fee0;
    uint fee1;
    uint oldInvestedAssets;
  }

  struct RebalanceLocalVariables {
    int24 upperTick;
    int24 lowerTick;
    int24 tickSpacing;
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    uint lastPrice;
    uint fuseThreshold;
    bool _depositorSwapTokens;
    uint rebalanceEarned0;
    uint rebalanceEarned1;

    uint newRebalanceEarned0;
    uint newRebalanceEarned1;
    uint notCoveredLoss;
    int24 newLowerTick;
    int24 newUpperTick;

    bool fillUp;
    bool isStablePool;
    uint newPrice;
  }

  struct RebalanceDebtFillUpLocalVariables {
    uint debtAmount;
    uint availableBalanceTokenA;
    uint availableBalanceTokenB;
    uint needToBorrowOrFreeFromBorrow;
  }

  //////////////////////////////////////////
  //            HELPERS
  //////////////////////////////////////////

  /// @dev Gets the liquidator swap slippage based on the pool type (stable or volatile).
  /// @param pool The IUniswapV3Pool instance.
  /// @return The liquidator swap slippage percentage.
  function _getLiquidatorSwapSlippage(IUniswapV3Pool pool) internal view returns (uint) {
    return isStablePool(pool) ? LIQUIDATOR_SWAP_SLIPPAGE_STABLE : LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE;
  }

  /// @notice Get the balance of the given token held by the contract.
  /// @param token The token address.
  /// @return The balance of the token.
  function _balance(address token) internal view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  /// @dev Gets the token balance without fees.
  /// @param token The token address.
  /// @param fee The fee amount to be subtracted from the balance.
  /// @return balanceWithoutFees The token balance without the specified fee amount.
  function getBalanceWithoutFees(address token, uint fee) internal view returns (uint balanceWithoutFees) {
    balanceWithoutFees = _balance(token);
    require(balanceWithoutFees >= fee, "Balance lower than fee");
    balanceWithoutFees -= fee;
  }

  /// @notice Check if the given pool is a stable pool.
  /// @param pool The Uniswap V3 pool.
  /// @return A boolean indicating if the pool is stable.
  function isStablePool(IUniswapV3Pool pool) public view returns (bool) {
    return pool.fee() == 100;
  }

  /// @notice Get the token amounts held by the contract excluding earned parts.
  /// @param state The state of the pool.
  /// @return amountA The balance of tokenA.
  /// @return amountB The balance of tokenB.
  function getTokenAmounts(State storage state) external view returns (uint amountA, uint amountB) {
    bool depositorSwapTokens = state.depositorSwapTokens;
    amountA = _balance(state.tokenA);
    amountB = _balance(state.tokenB);

    uint earned0 = (depositorSwapTokens ? state.rebalanceEarned1 : state.rebalanceEarned0);
    uint earned1 = (depositorSwapTokens ? state.rebalanceEarned0 : state.rebalanceEarned1);

    require(amountA >= earned0 && amountB >= earned1, "Wrong balance");
    amountA -= earned0;
    amountB -= earned1;
  }

  /// @notice Get the price ratio of the two given tokens from the oracle.
  /// @param converter The Tetu converter.
  /// @param tokenA The first token address.
  /// @param tokenB The second token address.
  /// @return The price ratio of the two tokens.
  function getOracleAssetsPrice(ITetuConverter converter, address tokenA, address tokenB) public view returns (uint) {
    IPriceOracle oracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);
    return priceB * 1e18 / priceA;
  }

  /// @notice Check if the fuse is enabled based on the price difference and fuse threshold.
  /// @param oldPrice The old price.
  /// @param newPrice The new price.
  /// @param fuseThreshold The fuse threshold.
  /// @return A boolean indicating if the fuse is enabled.
  function isEnableFuse(uint oldPrice, uint newPrice, uint fuseThreshold) internal pure returns (bool) {
    return oldPrice > newPrice ? (oldPrice - newPrice) > fuseThreshold : (newPrice - oldPrice) > fuseThreshold;
  }

  /// @dev Gets the update information for the strategy, including token amounts received and spent.
  /// @param state The State storage object.
  /// @param baseAmounts Mapping of token addresses to their base amounts on the strategy balance (not rewards).
  /// @return receivedA The amount of tokenA received.
  /// @return spentA The amount of tokenA spent.
  /// @return receivedB The amount of tokenB received.
  /// @return spentB The amount of tokenB spent.
  function getUpdateInfo(State storage state, mapping(address => uint) storage baseAmounts) external view returns (
    uint receivedA,
    uint spentA,
    uint receivedB,
    uint spentB
  ){
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    bool depositorSwapTokens = state.depositorSwapTokens;
    //updating baseAmounts (token amounts on strategy balance which are not rewards)
    uint balanceOfTokenABefore = baseAmounts[tokenA];
    uint balanceOfTokenBBefore = baseAmounts[tokenB];
    uint balanceOfTokenAAfter = _balance(tokenA) - (depositorSwapTokens ? state.rebalanceEarned1 : state.rebalanceEarned0);
    uint balanceOfTokenBAfter = _balance(tokenB) - (depositorSwapTokens ? state.rebalanceEarned0 : state.rebalanceEarned1);

    receivedA = balanceOfTokenABefore > balanceOfTokenAAfter ? 0 : balanceOfTokenAAfter - balanceOfTokenABefore;
    spentA = balanceOfTokenABefore > balanceOfTokenAAfter ? balanceOfTokenABefore - balanceOfTokenAAfter : 0;
    receivedB = balanceOfTokenBBefore > balanceOfTokenBAfter ? 0 : balanceOfTokenBAfter - balanceOfTokenBBefore;
    spentB = balanceOfTokenBBefore > balanceOfTokenBAfter ? balanceOfTokenBBefore - balanceOfTokenBAfter : 0;
  }

  //////////////////////////////////////////
  //            CALCULATIONS
  //////////////////////////////////////////

  /// @notice Calculate the initial values for a Uniswap V3 pool Depositor.
  /// @param pool The Uniswap V3 pool to get the initial values from.
  /// @param tickRange_ The tick range for the pool.
  /// @param rebalanceTickRange_ The rebalance tick range for the pool.
  /// @param asset_ Underlying asset of the depositor.
  /// @return tickSpacing The tick spacing for the pool.
  /// @return lowerTick The lower tick value for the pool.
  /// @return upperTick The upper tick value for the pool.
  /// @return tokenA The address of the first token in the pool.
  /// @return tokenB The address of the second token in the pool.
  /// @return _depositorSwapTokens A boolean representing whether to use reverse tokens for pool.
  function calcInitialDepositorValues(
    IUniswapV3Pool pool,
    int24 tickRange_,
    int24 rebalanceTickRange_,
    address asset_
  ) external view returns (
    int24 tickSpacing,
    int24 lowerTick,
    int24 upperTick,
    address tokenA,
    address tokenB,
    bool _depositorSwapTokens
  ) {
    tickSpacing = UniswapV3Lib.getTickSpacing(pool.fee());
    (, int24 tick, , , , ,) = pool.slot0();
    if (tickRange_ == 0) {
      lowerTick = tick / tickSpacing * tickSpacing;
      upperTick = lowerTick + tickSpacing;
    } else {
      require(tickRange_ == tickRange_ / tickSpacing * tickSpacing, 'Incorrect tickRange');
      require(rebalanceTickRange_ == rebalanceTickRange_ / tickSpacing * tickSpacing, 'Incorrect rebalanceTickRange');
      lowerTick = (tick - tickRange_) / tickSpacing * tickSpacing;
      upperTick = (tick + tickRange_) / tickSpacing * tickSpacing;
    }
    require(asset_ == pool.token0() || asset_ == pool.token1(), 'Incorrect asset');
    if (asset_ == pool.token0()) {
      tokenA = pool.token0();
      tokenB = pool.token1();
      _depositorSwapTokens = false;
    } else {
      tokenA = pool.token1();
      tokenB = pool.token0();
      _depositorSwapTokens = true;
    }
  }

  /// @notice Calculate the new tick range for a Uniswap V3 pool.
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
    (, int24 tick, , , , ,) = pool.slot0();
    if (upperTick - lowerTick == tickSpacing) {
      lowerTickNew = tick / tickSpacing * tickSpacing;
      upperTickNew = lowerTickNew + tickSpacing;
    } else {
      int24 halfRange = (upperTick - lowerTick) / 2;
      lowerTickNew = (tick - halfRange) / tickSpacing * tickSpacing;
      upperTickNew = (tick + halfRange) / tickSpacing * tickSpacing;
    }
  }

  /// @dev Calculates the new fee amounts and the not covered loss, if any, after attempting to cover losses.
  /// @param p The TryCoverLossParams instance containing required parameters.
  /// @param collateralAmount The current collateral amount.
  /// @return newFee0 The new fee amount for tokenA.
  /// @return newFee1 The new fee amount for tokenB.
  /// @return notCoveredLoss The amount of loss that could not be covered by fees.
  function _calculateCoverLoss(
    TryCoverLossParams memory p,
    uint collateralAmount
  ) internal view returns (uint newFee0, uint newFee1, uint notCoveredLoss) {
    notCoveredLoss = 0;

    newFee0 = p.fee0;
    newFee1 = p.fee1;
    uint feeA = p.depositorSwapTokens ? newFee1 : newFee0;
    uint feeB = p.depositorSwapTokens ? newFee0 : newFee1;

    uint newInvestedAssets = collateralAmount + _balance(p.tokenA) - feeA;
    if (newInvestedAssets < p.oldInvestedAssets) {
      // we have lost
      uint lost = p.oldInvestedAssets - newInvestedAssets;

      if (lost <= feeA) {
        // feeA is enough to cover lost
        if (p.depositorSwapTokens) {
          newFee1 -= lost;
        } else {
          newFee0 -= lost;
        }
      } else {
        // feeA is not enough to cover lost

        if (p.depositorSwapTokens) {
          newFee1 = 0;
        } else {
          newFee0 = 0;
        }

        uint feeBinTermOfA;
        if (feeB > 0) {

          feeBinTermOfA = UniswapV3Lib.getPrice(address(p.pool), p.tokenB) * feeB / 10 ** IERC20Metadata(p.tokenB).decimals();

          if (feeA + feeBinTermOfA > lost) {
            if (p.depositorSwapTokens) {
              newFee0 = (feeA + feeBinTermOfA - lost) * UniswapV3Lib.getPrice(address(p.pool), p.tokenA) / 10 ** IERC20Metadata(p.tokenA).decimals();
            } else {
              newFee1 = (feeA + feeBinTermOfA - lost) * UniswapV3Lib.getPrice(address(p.pool), p.tokenA) / 10 ** IERC20Metadata(p.tokenA).decimals();
            }
          } else {
            notCoveredLoss = lost - feeA - feeBinTermOfA;
            if (p.depositorSwapTokens) {
              newFee0 = 0;
            } else {
              newFee1 = 0;
            }
          }
        } else {
          notCoveredLoss = lost - feeA;
        }
      }
    }
  }

  //////////////////////////////////////////
  //            Pool info
  //////////////////////////////////////////

  /// @notice Retrieve the reserves of a Uniswap V3 pool managed by this contract.
  /// @param state The State storage containing the pool's information.
  /// @return reserves An array containing the reserve amounts of the contract owned liquidity.
  function getPoolReserves(State storage state) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = state.pool.slot0();

    (reserves[0], reserves[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTick,
      state.upperTick,
      state.totalLiquidity
    );

    (uint amount0CurrentFillup, uint amount1CurrentFillup) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTickFillup,
      state.upperTickFillup,
      state.totalLiquidityFillup
    );

    (uint fee0, uint fee1) = getFees(state);

    reserves[0] += amount0CurrentFillup + fee0 + _balance(state.pool.token0());
    reserves[1] += amount1CurrentFillup + fee1 + _balance(state.pool.token1());

    if (state.depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  /// @notice Retrieve the fees generated by a Uniswap V3 pool managed by this contract.
  /// @param state The State storage containing the pool's information.
  /// @return fee0 The fees generated for the first token in the pool.
  /// @return fee1 The fees generated for the second token in the pool.
  function getFees(State storage state) public view returns (uint fee0, uint fee1) {
    UniswapV3Lib.PoolPosition memory position = UniswapV3Lib.PoolPosition(address(state.pool), state.lowerTick, state.upperTick, state.totalLiquidity, address(this));
    (fee0, fee1) = UniswapV3Lib.getFees(position);
    UniswapV3Lib.PoolPosition memory positionFillup = UniswapV3Lib.PoolPosition(address(state.pool), state.lowerTickFillup, state.upperTickFillup, state.totalLiquidityFillup, address(this));
    (uint fee0Fillup, uint fee1Fillup) = UniswapV3Lib.getFees(positionFillup);
    fee0 += fee0Fillup;
    fee1 += fee1Fillup;
  }

  /// @notice Estimate the exit amounts for a given liquidity amount in a Uniswap V3 pool.
  /// @param pool The Uniswap V3 pool to quote the exit amounts for.
  /// @param lowerTick The lower tick value for the pool.
  /// @param upperTick The upper tick value for the pool.
  /// @param lowerTickFillup The lower tick value for the fillup range in the pool.
  /// @param upperTickFillup The upper tick value for the fillup range in the pool.
  /// @param liquidity The current liquidity in the pool.
  /// @param liquidityFillup The current liquidity in the fillup range.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsOut An array containing the estimated exit amounts for each token in the pool.
  function quoteExit(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 lowerTickFillup,
    int24 upperTickFillup,
    uint128 liquidity,
    uint128 liquidityFillup,
    uint128 liquidityAmountToExit,
    bool _depositorSwapTokens
  ) external view returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();

    (amountsOut[0], amountsOut[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick,
      upperTick,
      liquidityAmountToExit
    );

    if (liquidity > 0 && liquidityFillup > 0) {
      (uint amountOut0Fillup, uint amountOut1Fillup) = UniswapV3Lib.getAmountsForLiquidity(
        sqrtRatioX96,
        lowerTickFillup,
        upperTickFillup,
        liquidityFillup * liquidityAmountToExit / liquidity
      );

      amountsOut[0] += amountOut0Fillup;
      amountsOut[1] += amountOut1Fillup;
    }

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  /// @notice Determine if the pool needs to be rebalanced.
  /// @param state The state of the pool.
  /// @return A boolean indicating if the pool needs to be rebalanced.
  function needRebalance(State storage state) external view returns (bool) {
    if (state.isFuseTriggered) {
      return false;
    }
    (, int24 tick, , , , ,) = state.pool.slot0();
    if (state.upperTick - state.lowerTick == state.tickSpacing) {
      return tick < state.lowerTick || tick >= state.upperTick;
    } else {
      int24 halfRange = (state.upperTick - state.lowerTick) / 2;
      int24 oldMedianTick = state.lowerTick + halfRange;
      if (tick > oldMedianTick) {
        return tick - oldMedianTick >= state.rebalanceTickRange;
      }
      return oldMedianTick - tick > state.rebalanceTickRange;
    }
  }

  /// @notice Get entry data for a Uniswap V3 pool.
  /// @param pool The Uniswap V3 pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param tickSpacing The tick spacing of the pool.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return entryData A byte array containing the entry data for the pool.
  function getEntryData(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    address token1 = pool.token1();
    uint token1Price = UniswapV3Lib.getPrice(address(pool), token1);
    (lowerTick, upperTick) = _calcNewTickRange(pool, lowerTick, upperTick, tickSpacing);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;

    // calculate proportions
    (uint consumed0, uint consumed1,) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);

    if (depositorSwapTokens) {
      entryData = abi.encode(1, consumed1 * token1Price / token1Desired, consumed0);
    } else {
      entryData = abi.encode(1, consumed0, consumed1 * token1Price / token1Desired);
    }
  }

  //////////////////////////////////////////
  //            Joins to the pool
  //////////////////////////////////////////

  /// @notice Enter the pool and provide liquidity with desired token amounts.
  /// @param pool The Uniswap V3 pool to provide liquidity to.
  /// @param lowerTick The lower tick value for the pool.
  /// @param upperTick The upper tick value for the pool.
  /// @param amountsDesired_ An array containing the desired amounts of tokens to provide liquidity.
  /// @param totalLiquidity The current total liquidity in the pool.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsConsumed An array containing the consumed amounts for each token in the pool.
  /// @return liquidityOut The amount of liquidity added to the pool.
  /// @return totalLiquidityNew The updated total liquidity after providing liquidity.
  function enter(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    uint[] memory amountsDesired_,
    uint128 totalLiquidity,
    bool _depositorSwapTokens
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut, uint128 totalLiquidityNew) {

    amountsConsumed = new uint[](2);
    if (_depositorSwapTokens) {
      (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
    }
    uint128 newLiquidity;
    (amountsConsumed[0], amountsConsumed[1], newLiquidity) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTick, upperTick, amountsDesired_[0], amountsDesired_[1]);
    pool.mint(address(this), lowerTick, upperTick, newLiquidity, "");
    liquidityOut = uint(newLiquidity);
    totalLiquidityNew = totalLiquidity + newLiquidity;
    if (_depositorSwapTokens) {
      (amountsConsumed[0], amountsConsumed[1]) = (amountsConsumed[1], amountsConsumed[0]);
    }
  }

  /// @notice Add liquidity to a Uniswap V3 pool in a specified tick range according fill up rules.
  /// @param pool The Uniswap V3 pool to add liquidity to.
  /// @param lowerTick The current lower tick value for the pool.
  /// @param upperTick The current upper tick value for the pool.
  /// @param tickSpacing The tick spacing for the pool.
  /// @param fee0 The fee amount for the first token in the pool.
  /// @param fee1 The fee amount for the second token in the pool.
  /// @return lowerTickFillup The lower tick value for the new liquidity range.
  /// @return upperTickFillup The upper tick value for the new liquidity range.
  /// @return liquidityOutFillup The liquidity amount added to the new range.
  function addFillup(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    uint fee0,
    uint fee1
  ) external returns (int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidityOutFillup) {
    uint balance0 = _balance(pool.token0());
    uint balance1 = _balance(pool.token1());

    require(balance0 >= fee0 && balance1 >= fee1, "Wrong fee");
    balance0 -= fee0;
    balance1 -= fee1;

    (, int24 tick, , , , ,) = pool.slot0();
    if (balance0 > balance1 * UniswapV3Lib.getPrice(address(pool), pool.token1()) / 10 ** IERC20Metadata(pool.token1()).decimals()) {
      // add token0 to half range
      lowerTickFillup = tick / tickSpacing * tickSpacing + tickSpacing;
      upperTickFillup = upperTick;
      (,, liquidityOutFillup) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTickFillup, upperTickFillup, balance0, 0);
      pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOutFillup, "");
    } else {
      lowerTickFillup = lowerTick;
      upperTickFillup = tick / tickSpacing * tickSpacing - tickSpacing;
      (,, liquidityOutFillup) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTickFillup, upperTickFillup, 0, balance1);
      pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOutFillup, "");
    }
  }

  //////////////////////////////////////////
  //            Exit from the pool
  //////////////////////////////////////////


  /// @notice Exit the pool and collect tokens proportional to the liquidity amount to exit.
  /// @param pool The Uniswap V3 pool to exit from.
  /// @param lowerTick The lower tick value for the pool.
  /// @param upperTick The upper tick value for the pool.
  /// @param lowerTickFillup The lower tick value for the fillup range in the pool.
  /// @param upperTickFillup The upper tick value for the fillup range in the pool.
  /// @param liquidity The current liquidity in the pool.
  /// @param liquidityFillup The current liquidity in the fillup range.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsOut An array containing the collected amounts for each token in the pool.
  /// @return totalLiquidity The updated total liquidity after the exit.
  /// @return totalLiquidityFillup The updated total liquidity in the fillup range after the exit.
  function exit(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 lowerTickFillup,
    int24 upperTickFillup,
    uint128 liquidity,
    uint128 liquidityFillup,
    uint128 liquidityAmountToExit,
    bool _depositorSwapTokens
  ) external returns (uint[] memory amountsOut, uint128 totalLiquidity, uint128 totalLiquidityFillup) {
    totalLiquidityFillup = 0;

    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = pool.burn(lowerTick, upperTick, liquidityAmountToExit);
    // all fees will be collected but not returned in amountsOut
    pool.collect(
      address(this),
      lowerTick,
      upperTick,
      type(uint128).max,
      type(uint128).max
    );

    // remove proportional part of fillup liquidity
    if (liquidityFillup != 0) {
      uint128 toRemoveFillUpAmount = liquidityFillup * liquidityAmountToExit / liquidity;
      (uint amountsOutFillup0, uint amountsOutFillup1) = pool.burn(lowerTickFillup, upperTickFillup, toRemoveFillUpAmount);
      pool.collect(
        address(this),
        lowerTickFillup,
        upperTickFillup,
        type(uint128).max,
        type(uint128).max
      );
      amountsOut[0] += amountsOutFillup0;
      amountsOut[1] += amountsOutFillup1;

      require(liquidityFillup >= toRemoveFillUpAmount, "Wrong fillup");
      totalLiquidityFillup = liquidityFillup - toRemoveFillUpAmount;
    }

    require(liquidity >= liquidityAmountToExit, "Wrong liquidity");
    totalLiquidity = liquidity - liquidityAmountToExit;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  //////////////////////////////////////////
  //            Claim
  //////////////////////////////////////////

  /// @notice Claim rewards from the Uniswap V3 pool.
  /// @param pool The Uniswap V3 pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param lowerTickFillup The lower tick of the pool's fill-up range.
  /// @param upperTickFillup The upper tick of the pool's fill-up range.
  /// @param rebalanceEarned0 The amount of token0 earned from rebalancing.
  /// @param rebalanceEarned1 The amount of token1 earned from rebalancing.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsOut An array containing the amounts of token0 and token1 claimed as rewards.
  function claimRewards(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 lowerTickFillup,
    int24 upperTickFillup,
    uint rebalanceEarned0,
    uint rebalanceEarned1,
    bool _depositorSwapTokens
  ) external returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    pool.burn(lowerTick, upperTick, 0);
    (amountsOut[0], amountsOut[1]) = pool.collect(
      address(this),
      lowerTick,
      upperTick,
      type(uint128).max,
      type(uint128).max
    );
    if (lowerTickFillup != upperTickFillup) {
      pool.burn(lowerTickFillup, upperTickFillup, 0);
      (uint fillup0, uint fillup1) = pool.collect(
        address(this),
        lowerTickFillup,
        upperTickFillup,
        type(uint128).max,
        type(uint128).max
      );
      amountsOut[0] += fillup0;
      amountsOut[1] += fillup1;
    }
    amountsOut[0] += rebalanceEarned0;
    amountsOut[1] += rebalanceEarned1;
    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  //////////////////////////////////////////
  //            Debt actions
  //////////////////////////////////////////

  /// @dev Returns the total collateral amount out for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @return totalCollateralAmountOut The total collateral amount out for the token pair.
  function getDeptTotalCollateralAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) internal returns (uint totalCollateralAmountOut) {
    (, totalCollateralAmountOut) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
  }

  /// @dev Returns the total debt amount out for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @return totalDebtAmountOut The total debt amount out for the token pair.
  function getDeptTotalDebtAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) internal returns (uint totalDebtAmountOut) {
    (totalDebtAmountOut,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
  }

  /// @dev Closes the debt positions for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param controller The controller address.
  /// @param pool The IUniswapV3Pool instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @param fee0 The fee amount for tokenA.
  /// @param fee1 The fee amount for tokenB.
  function closeDebt(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    bool depositorSwapTokens,
    uint fee0,
    uint fee1
  ) internal {
    uint tokenAFee = depositorSwapTokens ? fee1 : fee0;
    uint tokenBFee = depositorSwapTokens ? fee0 : fee1;
    _closeDebt(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee);
  }

  /// @dev Rebalances the debt by either filling up or closing and reopening debt positions.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param controller The controller address.
  /// @param pool The IUniswapV3Pool instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @param fillUp True if the fill-up strategy should be used, false otherwise.
  /// @param lowerTick The lower tick of the current tick range.
  /// @param upperTick The upper tick of the current tick range.
  /// @param tickSpacing The tick spacing for the pool.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @param fee0 The fee amount for tokenA.
  /// @param fee1 The fee amount for tokenB.
  function rebalanceDebt(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    bool fillUp,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    bool depositorSwapTokens,
    uint fee0,
    uint fee1
  ) internal {
    uint tokenAFee = depositorSwapTokens ? fee1 : fee0;
    uint tokenBFee = depositorSwapTokens ? fee0 : fee1;
    if (fillUp) {
      _rebalanceDebtFillup(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee);
    } else {
      _closeDebt(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee);
      bytes memory entryData = getEntryData(pool, lowerTick, upperTick, tickSpacing, depositorSwapTokens);
      _openDebt(tetuConverter, tokenA, tokenB, entryData, tokenAFee);
    }
  }

  /// @notice Closes debt by liquidating tokens as necessary.
  ///         This function helps ensure that the converter strategy maintains the appropriate balances
  ///         and debt positions for token A and token B, while accounting for fees and potential price impacts.
  /// @param tetuConverter The Tetu converter instance.
  /// @param controller The Tetu controller instance.
  /// @param pool The Uniswap V3 pool instance.
  /// @param tokenA The address of token A.
  /// @param tokenB The address of token B.
  /// @param feeA The fee associated with token A.
  /// @param feeB The fee associated with token B.
  function _closeDebt(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    uint feeA,
    uint feeB
  ) internal {
    uint debtAmount = getDeptTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

    uint availableBalanceTokenA = _balance(tokenA);
    uint availableBalanceTokenB = _balance(tokenB);

    require(availableBalanceTokenA >= feeA && availableBalanceTokenB >= feeB, "Wrong balance");
    availableBalanceTokenA -= feeA;
    availableBalanceTokenB -= feeB;

    uint liquidatorSwapSlippage = _getLiquidatorSwapSlippage(pool);

    if (availableBalanceTokenB < debtAmount) {

      uint tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
      uint needToSellTokenA = tokenBprice * (debtAmount - availableBalanceTokenB) / 10 ** IERC20Metadata(tokenB).decimals();
      // add 1% gap for price impact
      needToSellTokenA += needToSellTokenA / SELL_GAP;

      if (needToSellTokenA < availableBalanceTokenA) {
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, liquidatorSwapSlippage, 0);
      } else {
        // very rare case, but happens on long run backtests
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, availableBalanceTokenA, liquidatorSwapSlippage, 0);
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          _balance(tokenB) - feeB
        );
        // refresh dept amount
        debtAmount = getDeptTotalDebtAmountOut(tetuConverter, tokenA, tokenB);
        if (debtAmount > 0) {
          tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
          needToSellTokenA = tokenBprice * debtAmount / 10 ** IERC20Metadata(tokenB).decimals();
          needToSellTokenA += needToSellTokenA / SELL_GAP;
          ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, liquidatorSwapSlippage, 0);
        }
      }
    }

    if (debtAmount > 0) {
      ConverterStrategyBaseLib.closePosition(
        tetuConverter,
        tokenA,
        tokenB,
        debtAmount
      );
    }

    ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, _balance(tokenB) - feeB, liquidatorSwapSlippage, 0);
  }

  /// @dev Opens a new debt position using entry data.
  /// @param tetuConverter The TetuConverter contract.
  /// @param tokenA The address of token A.
  /// @param tokenB The address of token B.
  /// @param entryData The data required to open a position.
  /// @param feeA The fee associated with token A.
  function _openDebt(
    ITetuConverter tetuConverter,
    address tokenA,
    address tokenB,
    bytes memory entryData,
    uint feeA
  ) internal {
    ConverterStrategyBaseLib.openPosition(
      tetuConverter,
      entryData,
      tokenA,
      tokenB,
      _balance(tokenA) - feeA,
      0
    );
  }

  /// @dev Rebalances the debt to reach the optimal ratio between token A and token B.
  /// @param tetuConverter The TetuConverter contract.
  /// @param controller The controller contract address.
  /// @param pool The Uniswap V3 pool contract.
  /// @param tokenA The address of token A.
  /// @param tokenB The address of token B.
  /// @param tokenAFee The fee associated with token A.
  /// @param tokenBFee The fee associated with token B.
  function _rebalanceDebtFillup(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    uint tokenAFee,
    uint tokenBFee
  ) internal {
    RebalanceDebtFillUpLocalVariables memory vars;
    vars.debtAmount = getDeptTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

    vars.availableBalanceTokenA = getBalanceWithoutFees(tokenA, tokenAFee);
    vars.availableBalanceTokenB = getBalanceWithoutFees(tokenB, tokenBFee);

    if (vars.availableBalanceTokenB > vars.debtAmount) {
      vars.needToBorrowOrFreeFromBorrow = vars.availableBalanceTokenB - vars.debtAmount;

      if (_getCollateralAmountForBorrow(tetuConverter, tokenA, tokenB, vars.needToBorrowOrFreeFromBorrow) < vars.availableBalanceTokenA) {
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(2),
          tokenA,
          tokenB,
          vars.needToBorrowOrFreeFromBorrow,
          0
        );
      } else {
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          vars.debtAmount
        );

        vars.availableBalanceTokenB = getBalanceWithoutFees(tokenB, tokenBFee);

        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, vars.availableBalanceTokenB, _getLiquidatorSwapSlippage(pool), 0);

        vars.availableBalanceTokenA = getBalanceWithoutFees(tokenA, tokenAFee);

        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1, 1, 1),
          tokenA,
          tokenB,
          vars.availableBalanceTokenA,
          0
        );
      }
    } else {
      vars.needToBorrowOrFreeFromBorrow = vars.debtAmount - vars.availableBalanceTokenB;
      if (vars.availableBalanceTokenB > vars.needToBorrowOrFreeFromBorrow) {
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          vars.needToBorrowOrFreeFromBorrow
        );
      } else {
        uint needToSellTokenA = UniswapV3Lib.getPrice(address(pool), tokenB) * vars.needToBorrowOrFreeFromBorrow / 10 ** IERC20Metadata(tokenB).decimals();
        // add % gap for price impact
        needToSellTokenA += needToSellTokenA / SELL_GAP;
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, _getLiquidatorSwapSlippage(pool), 0);

        vars.availableBalanceTokenB = getBalanceWithoutFees(tokenB, tokenBFee);

        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          vars.debtAmount < vars.availableBalanceTokenB ? vars.debtAmount : vars.availableBalanceTokenB
        );

        vars.availableBalanceTokenA = getBalanceWithoutFees(tokenA, tokenAFee);

        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1, 1, 1),
          tokenA,
          tokenB,
          vars.availableBalanceTokenA,
          0
        );
      }
    }
  }

  /// @dev Calculates the collateral amount required for borrowing a specified amount.
  /// @param tetuConverter The TetuConverter contract.
  /// @param tokenA The address of token A.
  /// @param tokenB The address of token B.
  /// @param needToBorrow The amount that needs to be borrowed.
  /// @return collateralAmount The amount of collateral required for borrowing the specified amount.
  function _getCollateralAmountForBorrow(
    ITetuConverter tetuConverter,
    address tokenA,
    address tokenB,
    uint needToBorrow
  ) internal view returns (uint collateralAmount) {
    ConverterStrategyBaseLib.OpenPositionLocal memory vars;
    (vars.converters, vars.collateralsRequired, vars.amountsToBorrow,) = tetuConverter.findBorrowStrategies(
      abi.encode(2),
      tokenA,
      needToBorrow,
      tokenB,
      BORROW_PERIOD_ESTIMATION
    );

    uint len = vars.converters.length;
    if (len > 0) {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        vars.amountToBorrow = needToBorrow < vars.amountsToBorrow[i]
        ? needToBorrow
        : vars.amountsToBorrow[i];
        vars.collateral = needToBorrow < vars.amountsToBorrow[i]
        ? vars.collateralsRequired[i] * needToBorrow / vars.amountsToBorrow[i]
        : vars.collateralsRequired[i];
        needToBorrow -= vars.amountToBorrow;
        if (needToBorrow == 0) break;
      }
    }
    return vars.collateral;
  }

  //////////////////////////////////////////
  //            Rebalance
  //////////////////////////////////////////

  /// @dev Rebalances the current position, adjusts the tick range, and attempts to cover loss with pool rewards.
  /// @param state The State storage object.
  /// @param converter The TetuConverter contract.
  /// @param controller The Tetu controller address.
  /// @param oldInvestedAssets The amount of invested assets before rebalancing.
  /// @return tokenAmounts The token amounts for deposit (if length != 2 then do nothing).
  /// @return isNeedFillup Indicates if fill-up is required after rebalancing.
  function rebalance(
    State storage state,
    ITetuConverter converter,
    address controller,
    uint oldInvestedAssets
  ) external returns (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    bool isNeedFillup
  ) {
    tokenAmounts = new uint[](0);
    isNeedFillup = false;

    RebalanceLocalVariables memory vars = RebalanceLocalVariables({
    upperTick : state.upperTick,
    lowerTick : state.lowerTick,
    tickSpacing : state.tickSpacing,
    pool : state.pool,
    tokenA : state.tokenA,
    tokenB : state.tokenB,
    lastPrice : state.lastPrice,
    fuseThreshold : state.fuseThreshold,
    _depositorSwapTokens : state.depositorSwapTokens,
    rebalanceEarned0 : state.rebalanceEarned0,
    rebalanceEarned1 : state.rebalanceEarned1,
    // setup initial values
    newRebalanceEarned0 : 0,
    newRebalanceEarned1 : 0,
    notCoveredLoss : 0,
    newLowerTick : 0,
    newUpperTick : 0,
    fillUp : false,
    isStablePool : false,
    newPrice : 0
    });

    vars.newPrice = getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

    /// @dev for ultra-wide ranges we use Swap rebalancing strategy and Fill-up for other
    /// @dev upperTick always greater then lowerTick
    vars.fillUp = vars.upperTick - vars.lowerTick >= 4 * vars.tickSpacing;

    /// @dev for stable pools fuse can be enabled
    vars.isStablePool = isStablePool(vars.pool);

    if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
      /// @dev enabling fuse: close debt and stop providing liquidity
      state.isFuseTriggered = true;

      closeDebt(
        converter,
        controller,
        vars.pool,
        vars.tokenA,
        vars.tokenB,
        vars._depositorSwapTokens,
        vars.rebalanceEarned0,
        vars.rebalanceEarned1
      );

      vars.newRebalanceEarned0 = vars.rebalanceEarned0;
      vars.newRebalanceEarned1 = vars.rebalanceEarned1;
      vars.newLowerTick = vars.lowerTick;
      vars.newUpperTick = vars.upperTick;
    } else {
      if (vars.isStablePool) {
        state.lastPrice = vars.newPrice;
      }

      /// @dev rebalacing debt with passing rebalanceEarned0, rebalanceEarned1 that will remain untouched
      rebalanceDebt(
        converter,
        controller,
        vars.pool,
        vars.tokenA,
        vars.tokenB,
        vars.fillUp,
        vars.lowerTick,
        vars.upperTick,
        vars.tickSpacing,
        vars._depositorSwapTokens,
        vars.rebalanceEarned0,
        vars.rebalanceEarned1
      );

      /// @dev trying to cover rebalance loss (IL + not hedged part of tokenB + swap cost) by pool rewards
      (vars.newRebalanceEarned0, vars.newRebalanceEarned1, vars.notCoveredLoss) = _calculateCoverLoss(
        TryCoverLossParams(
          vars.pool,
          vars.tokenA,
          vars.tokenB,
          vars._depositorSwapTokens,
          vars.rebalanceEarned0,
          vars.rebalanceEarned1,
          oldInvestedAssets
        ),
        getDeptTotalCollateralAmountOut(converter, vars.tokenA, vars.tokenB)
      );
      state.rebalanceEarned0 = vars.newRebalanceEarned0;
      state.rebalanceEarned1 = vars.newRebalanceEarned1;
      if (vars.notCoveredLoss != 0) {
        state.rebalanceLost += vars.notCoveredLoss;
      }

      // calculate and set new tick range
      (vars.newLowerTick, vars.newUpperTick) = _calcNewTickRange(vars.pool, vars.lowerTick, vars.upperTick, vars.tickSpacing);
      state.lowerTick = vars.newLowerTick;
      state.upperTick = vars.newUpperTick;


      tokenAmounts = new uint[](2);
      tokenAmounts[0] = _balance(vars.tokenA) - (vars._depositorSwapTokens ? vars.newRebalanceEarned1 : vars.newRebalanceEarned0);
      tokenAmounts[1] = _balance(vars.tokenB) - (vars._depositorSwapTokens ? vars.newRebalanceEarned0 : vars.newRebalanceEarned1);

      if (vars.fillUp) {
        isNeedFillup = true;
      }
    }
  }
}
