// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "./UniswapV3Lib.sol";

library UniswapV3ConverterStrategyLogicLib {
  struct TryCoverLossParams {
    ITetuConverter tetuConverter;
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    bool depositorSwapTokens;
    uint fee0;
    uint fee1;
    uint oldInvestedAssets;
  }

  function isStablePool(IUniswapV3Pool pool) external view returns (bool) {
    return pool.fee() == 100;
  }

  function getOracleAssetsPrice(ITetuConverter converter, address tokenA, address tokenB) external view returns (uint) {
    IPriceOracle oracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);
    return priceB * 1e18 / priceA;
  }

  function enableFuse(uint oldPrice, uint newPrice, uint fuseThreshold) external pure returns (bool) {
    return oldPrice > newPrice ? (oldPrice - newPrice) > fuseThreshold : (newPrice - oldPrice) > fuseThreshold;
  }

  function initDepositor(IUniswapV3Pool pool, int24 tickRange_, int24 rebalanceTickRange_, address asset_) external view returns (int24 tickSpacing, int24 lowerTick, int24 upperTick, address tokenA, address tokenB, bool _depositorSwapTokens) {
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

  function setNewTickRange(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 tickSpacing) public view returns (int24 lowerTickNew, int24 upperTickNew) {
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

  function addFillup(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 tickSpacing, uint fee0, uint fee1) external returns (int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidityOutFillup) {
    uint balance0 = _balance(pool.token0()) - fee0;
    uint balance1 = _balance(pool.token1()) - fee1;
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

  function getPoolReserves(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup, bool _depositorSwapTokens) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();

    (reserves[0], reserves[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick,
      upperTick,
      liquidity
    );

    (uint amount0CurrentFillup, uint amount1CurrentFillup) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTickFillup,
      upperTickFillup,
      liquidityFillup
    );

    (uint fee0, uint fee1) = getFees(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, liquidity, liquidityFillup);

    reserves[0] += amount0CurrentFillup + fee0 + _balance(pool.token0());
    reserves[1] += amount1CurrentFillup + fee1 + _balance(pool.token1());

    if (_depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  function quoteExit(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup, uint128 liquidityAmountToExit, bool _depositorSwapTokens) external view returns (uint[] memory amountsOut) {
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

  function exit(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup, uint128 liquidityAmountToExit, bool _depositorSwapTokens) external returns (uint[] memory amountsOut, uint128 totalLiquidity, uint128 totalLiquidityFillup) {
    totalLiquidityFillup = 0;
    // hide warning

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
      uint128 toRemovefillUpAmount = liquidityFillup * liquidityAmountToExit / liquidity;
      (uint amountsOutFillup0, uint amountsOutFillup1) = pool.burn(lowerTickFillup, upperTickFillup, toRemovefillUpAmount);
      pool.collect(
        address(this),
        lowerTickFillup,
        upperTickFillup,
        type(uint128).max,
        type(uint128).max
      );
      amountsOut[0] += amountsOutFillup0;
      amountsOut[1] += amountsOutFillup1;

      totalLiquidityFillup = liquidityFillup - toRemovefillUpAmount;
    }

    totalLiquidity = liquidity - liquidityAmountToExit;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  function enter(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, uint[] memory amountsDesired_, uint128 totalLiquidity, bool _depositorSwapTokens) external returns (uint[] memory amountsConsumed, uint liquidityOut, uint128 totalLiquidityNew) {
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

  function getFees(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup) public view returns (uint fee0, uint fee1) {
    UniswapV3Lib.PoolPosition memory position = UniswapV3Lib.PoolPosition(address(pool), lowerTick, upperTick, liquidity, address(this));
    (fee0, fee1) = UniswapV3Lib.getFees(position);
    UniswapV3Lib.PoolPosition memory positionFillup = UniswapV3Lib.PoolPosition(address(pool), lowerTickFillup, upperTickFillup, liquidityFillup, address(this));
    (uint fee0Fillup, uint fee1Fillup) = UniswapV3Lib.getFees(positionFillup);
    fee0 += fee0Fillup;
    fee1 += fee1Fillup;
  }

  function needRebalance(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 rebalanceTickRange, int24 tickSpacing) external view returns (bool) {
    (, int24 tick, , , , ,) = pool.slot0();
    if (upperTick - lowerTick == tickSpacing) {
      return tick < lowerTick || tick >= upperTick;
    } else {
      int24 halfRange = (upperTick - lowerTick) / 2;
      int24 oldMedianTick = lowerTick + halfRange;
      if (tick > oldMedianTick) {
        return tick - oldMedianTick >= rebalanceTickRange;
      }
      return oldMedianTick - tick > rebalanceTickRange;
    }
  }

  function claimRewards(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint rebalanceEarned0, uint rebalanceEarned1, bool _depositorSwapTokens) external returns (uint[] memory amountsOut) {
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

  function getEntryData(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 tickSpacing, bool depositSwapTokens) public view returns (bytes memory entryData) {
    address token1 = pool.token1();
    uint token1Price = UniswapV3Lib.getPrice(address(pool), token1);
    (lowerTick, upperTick) = setNewTickRange(pool, lowerTick, upperTick, tickSpacing);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;

    // calculate proportions
    (uint consumed0, uint consumed1,) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);

    if (depositSwapTokens) {
      entryData = abi.encode(1, consumed1 * token1Price / token1Desired, consumed0);
    } else {
      entryData = abi.encode(1, consumed0, consumed1 * token1Price / token1Desired);
    }
  }

  function closeDebt(ITetuConverter tetuConverter, address controller, IUniswapV3Pool pool, address tokenA, address tokenB, bool depositorSwapTokens, uint fee0, uint fee1) external {
    uint tokenAFee = depositorSwapTokens ? fee1 : fee0;
    uint tokenBFee = depositorSwapTokens ? fee0 : fee1;
    _rebalanceDebtSwapP1(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee);
  }

  function rebalanceDebt(ITetuConverter tetuConverter, address controller, IUniswapV3Pool pool, address tokenA, address tokenB, bool fillUp, int24 lowerTick, int24 upperTick, int24 tickSpacing, bool depositorSwapTokens, uint fee0, uint fee1) external {
    uint tokenAFee = depositorSwapTokens ? fee1 : fee0;
    uint tokenBFee = depositorSwapTokens ? fee0 : fee1;
    if (fillUp) {
      _rebalanceDebtFillup(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee);
    } else {
      _rebalanceDebtSwapP1(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee);
      bytes memory entryData = getEntryData(pool, lowerTick, upperTick, tickSpacing, depositorSwapTokens);
      _rebalanceDebtSwapP2(tetuConverter, tokenA, tokenB, entryData, tokenAFee);
    }
  }

  function tryToCoverLoss(TryCoverLossParams memory p) external returns (uint newFee0, uint newFee1, uint notCoveredLoss) {
    notCoveredLoss = 0;
    // hide warning

    (,uint collateralAmount) = p.tetuConverter.getDebtAmountCurrent(address(this), p.tokenA, p.tokenB);

    newFee0 = p.fee0;
    newFee1 = p.fee1;
    uint feeA = p.depositorSwapTokens ? p.fee1 : p.fee0;
    uint feeB = p.depositorSwapTokens ? p.fee0 : p.fee1;

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

  function _rebalanceDebtSwapP1(ITetuConverter tetuConverter, address controller, IUniswapV3Pool pool, address tokenA, address tokenB, uint feeA, uint feeB) internal {
    (uint debtAmount,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);

    uint availableBalanceTokenA = _balance(tokenA) - feeA;
    uint availableBalanceTokenB = _balance(tokenB) - feeB;

    uint liquidatorSwapSlippage = _getLiquidatorSwapSlippage(pool);

    if (availableBalanceTokenB < debtAmount) {

      // todo get price from oracle
      uint tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
      uint needToSellTokenA = tokenBprice * (debtAmount - availableBalanceTokenB) / 10 ** IERC20Metadata(tokenB).decimals();
      // add 1% gap for price impact
      needToSellTokenA += needToSellTokenA / 100;

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
        (debtAmount,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
        if (debtAmount > 0) {
          // todo get price from oracle
          tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
          needToSellTokenA = tokenBprice * debtAmount / 10 ** IERC20Metadata(tokenB).decimals();
          needToSellTokenA += needToSellTokenA / 100;
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

  function _rebalanceDebtSwapP2(ITetuConverter tetuConverter, address tokenA, address tokenB, bytes memory entryData, uint feeA) internal {
    ConverterStrategyBaseLib.openPosition(
      tetuConverter,
      entryData,
      tokenA,
      tokenB,
      _balance(tokenA) - feeA,
      0
    );
  }

  function _getLiquidatorSwapSlippage(IUniswapV3Pool pool) internal view returns (uint) {
    // slippage is 0.5% for 0.01% fee pools and 5% for other pools
    return pool.fee() == 100 ? 500 : 5_000;
  }

  function _getCollateralAmountForBorrow(ITetuConverter tetuConverter, address tokenA, address tokenB, uint needToBorrow) internal view returns (uint) {
    ConverterStrategyBaseLib.OpenPositionLocal memory vars;
    (vars.converters, vars.collateralsRequired, vars.amountsToBorrow,) = tetuConverter.findBorrowStrategies(
      abi.encode(2),
      tokenA,
      needToBorrow,
      tokenB,
      30 days / 2
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

  function _rebalanceDebtFillup(ITetuConverter tetuConverter, address controller, IUniswapV3Pool pool, address tokenA, address tokenB, uint tokenAFee, uint tokenBFee) internal {
    (uint debtAmount,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);

    uint availableBalanceTokenA = _balance(tokenA) - tokenAFee;
    uint availableBalanceTokenB = _balance(tokenB) - tokenBFee;

    uint needToBorrowOrFreeFromBorrow;
    if (availableBalanceTokenB > debtAmount) {
      needToBorrowOrFreeFromBorrow = availableBalanceTokenB - debtAmount;

      if (_getCollateralAmountForBorrow(tetuConverter, tokenA, tokenB, needToBorrowOrFreeFromBorrow) < availableBalanceTokenA) {
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(2),
          tokenA,
          tokenB,
          needToBorrowOrFreeFromBorrow,
          0
        );
      } else {
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount
        );

        availableBalanceTokenB = _balance(tokenB) - tokenBFee;
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, availableBalanceTokenB, 5_000, 0);
        availableBalanceTokenA = _balance(tokenA) - tokenAFee;
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1, 1, 1),
          tokenA,
          tokenB,
          availableBalanceTokenA,
          0
        );
      }
    } else {
      needToBorrowOrFreeFromBorrow = debtAmount - availableBalanceTokenB;
      if (availableBalanceTokenB > needToBorrowOrFreeFromBorrow) {
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          needToBorrowOrFreeFromBorrow
        );
      } else {
        uint needToSellTokenA = UniswapV3Lib.getPrice(address(pool), tokenB) * (debtAmount - availableBalanceTokenB) / 10 ** IERC20Metadata(tokenB).decimals();
        // add 1% gap for price impact
        needToSellTokenA += needToSellTokenA / 100;
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, 5_000, 0);
        availableBalanceTokenB = _balance(tokenB) - tokenBFee;
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount < availableBalanceTokenB ? debtAmount : availableBalanceTokenB
        );
        availableBalanceTokenA = _balance(tokenA) - tokenAFee;
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1, 1, 1),
          tokenA,
          tokenB,
          availableBalanceTokenA,
          0
        );
      }
    }
  }

//  function rebalance(
//    uint upperTick,
//    uint lowerTick,
//    uint tickSpacing,
//    IUniswapV3Pool pool,
//    ITetuConverter converter,
//    address tokenA,
//    address tokenB,
//    uint lastPrice,
//    uint fuseThreshold,
//    address controller,
//    address [] memory _depositorSwapTokens,
//    uint rebalanceEarned0,
//    uint rebalanceEarned1,
//    uint investedAssets
//  ) external returns (
//    bool isFuseTriggered,
//    uint newLastPrice,
//    uint notCoveredLoss, // need to add to rebalanceLost
//    uint newLowerTick,
//    uint newUpperTick
//  ){
//    isFuseTriggered = false;
//    newLastPrice = 0;
//    notCoveredLoss = 0;
//    newLowerTick = 0;
//    newUpperTick = 0;
//
//    /// @dev for ultra-wide ranges we use Swap rebalancing strategy and Fill-up for other
//    /// @dev upperTick always greater then lowerTick
//    bool fillUp = upperTick - lowerTick >= 4 * tickSpacing;
//
//    /// @dev for stable pools fuse can be enabled
//    bool isStablePool = UniswapV3ConverterStrategyLogicLib.isStablePool(pool);
//
//    uint newPrice = UniswapV3ConverterStrategyLogicLib.getOracleAssetsPrice(converter, tokenA, tokenB);
//
//    if (isStablePool && UniswapV3ConverterStrategyLogicLib.enableFuse(lastPrice, newPrice, fuseThreshold)) {
//      /// @dev enabling fuse: close debt and stop providing liquidity
//      isFuseTriggered = true;
//
//      UniswapV3ConverterStrategyLogicLib.closeDebt(
//        converter,
//        controller,
//        pool,
//        tokenA,
//        tokenB,
//        _depositorSwapTokens,
//        rebalanceEarned0,
//        rebalanceEarned1
//      );
//    } else {
//      if (isStablePool) {
//        newLastPrice = newPrice;
//      }
//
//      /// @dev rebalacing debt with passing rebalanceEarned0, rebalanceEarned1 that will remain untouched
//      UniswapV3ConverterStrategyLogicLib.rebalanceDebt(
//        converter,
//        controller,
//        pool,
//        tokenA,
//        tokenB,
//        fillUp,
//        lowerTick,
//        upperTick,
//        tickSpacing,
//        _depositorSwapTokens,
//        rebalanceEarned0,
//        rebalanceEarned1
//      );
//
//      /// @dev trying to cover rebalance loss (IL + not hedged part of tokenB + swap cost) by pool rewards
//      (rebalanceEarned0, rebalanceEarned1, notCoveredLoss) = UniswapV3ConverterStrategyLogicLib.tryToCoverLoss(
//        UniswapV3ConverterStrategyLogicLib.TryCoverLossParams(
//          converter,
//          controller,
//          pool,
//          tokenA,
//          tokenB,
//          _depositorSwapTokens,
//          rebalanceEarned0,
//          rebalanceEarned1,
//          investedAssets,
//          tickSpacing,
//          lowerTick,
//          upperTick
//        )
//      );
//
//      // calculate and set new tick range
//      (newLowerTick, newUpperTick) = UniswapV3ConverterStrategyLogicLib.setNewTickRange(pool, lowerTick, upperTick, tickSpacing);
//
//      //put liquidity to pool without updated rebalanceEarned0, rebalanceEarned1 amounts
//      uint[] memory tokenAmounts = new uint[](2);
//      tokenAmounts[0] = _balance(tokenA) - (_depositorSwapTokens ? rebalanceEarned1 : rebalanceEarned0);
//      tokenAmounts[1] = _balance(tokenB) - (_depositorSwapTokens ? rebalanceEarned0 : rebalanceEarned1);
//      _depositorEnter(tokenAmounts);
//
//      //add fill-up liquidity part of fill-up is used
//      if (fillUp) {
//        (lowerTickFillup, upperTickFillup, totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.addFillup(pool, lowerTick, upperTick, tickSpacing, rebalanceEarned0, rebalanceEarned1);
//      }
//    }
//
//    //updating baseAmounts (token amounts on strategy balance which are not rewards)
//    uint balanceOfTokenABefore = baseAmounts[tokenA];
//    uint balanceOfTokenBBefore = baseAmounts[tokenB];
//    uint balanceOfTokenAAfter = _balance(tokenA) - (_depositorSwapTokens ? rebalanceEarned1 : rebalanceEarned0);
//    uint balanceOfTokenBAfter = _balance(tokenB) - (_depositorSwapTokens ? rebalanceEarned0 : rebalanceEarned1);
//    _updateBaseAmountsForAsset(
//      tokenA,
//      balanceOfTokenABefore > balanceOfTokenAAfter ? 0 : balanceOfTokenAAfter - balanceOfTokenABefore,
//      balanceOfTokenABefore > balanceOfTokenAAfter ? balanceOfTokenABefore - balanceOfTokenAAfter : 0
//    );
//    _updateBaseAmountsForAsset(
//      tokenB,
//      balanceOfTokenBBefore > balanceOfTokenBAfter ? 0 : balanceOfTokenBAfter - balanceOfTokenBBefore,
//      balanceOfTokenBBefore > balanceOfTokenBAfter ? balanceOfTokenBBefore - balanceOfTokenBAfter : 0
//    );
//
//    //updating investedAssets based on new baseAmounts
//    _updateInvestedAssets();
//  }

  function _balance(address token) internal view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }
}
