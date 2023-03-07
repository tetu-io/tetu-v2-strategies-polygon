// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "./UniswapV3Library.sol";

library UniswapV3ConverterStrategyLogic {
  function initDepositor(IUniswapV3Pool pool, int24 tickRange_, address asset_) external view returns(int24 tickSpacing, int24 lowerTick, int24 upperTick, address tokenA, address tokenB, bool _depositorSwapTokens) {
    tickSpacing = UniswapV3Library.getTickSpacing(pool.fee());
    (, int24 tick, , , , ,) = pool.slot0();
    lowerTick = (tick - tickRange_) / tickSpacing * tickSpacing;
    upperTick = (tick + tickRange_) / tickSpacing * tickSpacing;
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

  function setNewTickRange(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 tickSpacing) external view returns(int24 lowerTickNew, int24 upperTickNew) {
    (, int24 tick, , , , ,) = pool.slot0();
    int24 halfRange = (upperTick - lowerTick) / 2;
    lowerTickNew = (tick - halfRange) / tickSpacing * tickSpacing;
    upperTickNew = (tick + halfRange) / tickSpacing * tickSpacing;
  }

  function addFillup(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 tickSpacing) external returns(int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidityOutFillup) {
    (, int24 tick, , , , ,) = pool.slot0();
    if (_balance(pool.token0()) > _balance(pool.token1()) * UniswapV3Library.getPrice(address(pool), pool.token1()) / 10**IERC20Metadata(pool.token1()).decimals()) {
      // add token0 to half range
      lowerTickFillup = tick / tickSpacing * tickSpacing + tickSpacing;
      upperTickFillup = upperTick;
      (,, liquidityOutFillup) = UniswapV3Library.addLiquidityPreview(address(pool), lowerTickFillup, upperTickFillup, _balance(pool.token0()), 0);
      pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOutFillup, "");
    } else {
      lowerTickFillup = lowerTick;
      upperTickFillup = tick / tickSpacing * tickSpacing - tickSpacing;
      (,, liquidityOutFillup) = UniswapV3Library.addLiquidityPreview(address(pool), lowerTickFillup, upperTickFillup, 0, _balance(pool.token1()));
      pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOutFillup, "");
    }
  }

  function getPoolReserves(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup, bool _depositorSwapTokens) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();

    (reserves[0], reserves[1]) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick,
      upperTick,
      liquidity
    );

    (uint amount0CurrentFillup, uint amount1CurrentFillup) = UniswapV3Library.getAmountsForLiquidity(
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

    (amountsOut[0], amountsOut[1]) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick,
      upperTick,
        liquidityAmountToExit
    );

    (uint amountOut0Fillup, uint amountOut1Fillup) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTickFillup,
      upperTickFillup,
      liquidityFillup * liquidityAmountToExit / liquidity
    );

    (uint fee0, uint fee1) = getFees(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, liquidity, liquidityFillup);

    amountsOut[0] += amountOut0Fillup + fee0;
    amountsOut[1] += amountOut1Fillup + fee1;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  function exit(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup, uint128 liquidityAmountToExit, bool _depositorSwapTokens) external returns (uint[] memory amountsOut, uint128 totalLiquidity, uint128 totalLiquidityFillup) {
    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = pool.burn(lowerTick, upperTick, liquidityAmountToExit);
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
    (amountsConsumed[0], amountsConsumed[1], newLiquidity) = UniswapV3Library.addLiquidityPreview(address(pool), lowerTick, upperTick, amountsDesired_[0], amountsDesired_[1]);
    pool.mint(address(this), lowerTick, upperTick, newLiquidity, "");
    liquidityOut = uint(newLiquidity);
    totalLiquidityNew = totalLiquidity + newLiquidity;
    if (_depositorSwapTokens) {
      (amountsConsumed[0], amountsConsumed[1]) = (amountsConsumed[1], amountsConsumed[0]);
    }
  }

  function getFees(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 lowerTickFillup, int24 upperTickFillup, uint128 liquidity, uint128 liquidityFillup) public view returns (uint fee0, uint fee1) {
    UniswapV3Library.PoolPosition memory position = UniswapV3Library.PoolPosition(address(pool), lowerTick, upperTick, liquidity, address(this));
    (fee0, fee1) = UniswapV3Library.getFees(position);
    UniswapV3Library.PoolPosition memory positionFillup = UniswapV3Library.PoolPosition(address(pool), lowerTickFillup, upperTickFillup, liquidityFillup, address(this));
    (uint fee0Fillup, uint fee1Fillup) = UniswapV3Library.getFees(positionFillup);
    fee0 += fee0Fillup;
    fee1 += fee1Fillup;
  }

  function needRebalance(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, int24 rebalanceTickRange) external view returns(bool) {
    (, int24 tick, , , , ,) = pool.slot0();
    int24 halfRange = (upperTick - lowerTick) / 2;
    int24 oldMedianTick = lowerTick + halfRange;
    if (tick > oldMedianTick) {
      return tick - oldMedianTick > rebalanceTickRange;
    }
    return oldMedianTick - tick > rebalanceTickRange;
  }

  function claimRewards(IUniswapV3Pool pool, int24 lowerTick, int24 upperTick, uint rebalanceEarned0, uint rebalanceEarned1, bool _depositorSwapTokens) external returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    pool.burn(lowerTick, upperTick, 0);
    (amountsOut[0], amountsOut[1]) = pool.collect(
      address(this),
      lowerTick,
      upperTick,
      type(uint128).max,
      type(uint128).max
    );
    amountsOut[0] += rebalanceEarned0;
    amountsOut[1] += rebalanceEarned1;
    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  function rebalanceDebt(ITetuConverter tetuConverter, address controller, IUniswapV3Pool pool, address tokenA, address tokenB) external {
    (uint debtAmount,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
    //    console.log('rebalance: collateralAmount in lending', collateralAmount);
    //    console.log('rebalance: debtAmount in lending', debtAmount);

    if (_balance(tokenB) > debtAmount) {
      //      console.log('rebalance: need to increase debt by', _balance(tokenB) - debtAmount);
      //      console.log('rebalance: rebalancing debt and collateral');

      uint needToBorrow = _balance(tokenB) - debtAmount;
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
      //      console.log('rebalance: need collateral     ', vars.collateral);
      //      console.log('rebalance: available collateral', _balance(tokenA));

      if (vars.collateral < _balance(tokenA)) {
        //        console.log('rebalance: enough collateral, increasing debt');
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(2),
          tokenA,
          tokenB,
          _balance(tokenB) - debtAmount
        );
      } else {
        //        console.log('rebalance: not enough collateral, need swap and full debt rebalance');
        //        console.log('rebalance: close all debt');
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount
        );
        //        console.log('rebalance: full tokenB liquidation');
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, _balance(tokenB), 5_000, 0);
        //        console.log('rebalance: open new debt');
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1,1,1),
          tokenA,
          tokenB,
          _balance(tokenA)
        );
      }
    } else {
      //      console.log('rebalance: need to decrease debt by', debtAmount - _balance(tokenB));
      //      console.log('rebalance: rebalancing debt and collateral');
      if (_balance(tokenB) > debtAmount - _balance(tokenB)) {
        //        console.log('rebalance: enough tokenB balance to decrease debt');
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount - _balance(tokenB)
        );
      } else {
//        console.log('rebalance: not enough tokenB, need swap and full debt rebalance');
        uint needToSellTokenA = UniswapV3Library.getPrice(address(pool), tokenB) * (debtAmount - _balance(tokenB)) / 10**IERC20Metadata(tokenB).decimals();
        // add 1% gap for price impact
        needToSellTokenA += needToSellTokenA / 100;
//        console.log('rebalance: tokenA liquidation amountIn, need to buy tokenB', needToSellTokenA, debtAmount - _balance(tokenB));
//        console.log('rebalance: tokenA balance', _balance(tokenA));
//        console.log('rebalance: tokenB balance', _balance(tokenB));
        /*(, uint bought) = */ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, 5_000, 0);
//        console.log('rebalance: bought tokenB', bought);
//        console.log('rebalance: close all debt');
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount < _balance(tokenB) ? debtAmount : _balance(tokenB)
        );
//        console.log('rebalance: open new debt');
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1,1,1),
          tokenA,
          tokenB,
          _balance(tokenA)
        );
      }
    }
  }

  function _balance(address token) internal view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }
}