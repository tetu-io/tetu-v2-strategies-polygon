// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "./UniswapV3Lib.sol";
import "./Uni3StrategyErrors.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";

library UniswapV3DebtLib {

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint internal constant SELL_GAP = 100;
  /// @dev should be placed local, probably will be adjusted later
  uint internal constant BORROW_PERIOD_ESTIMATION = 30 days / 2;

  //////////////////////////////////////////
  //            STRUCTURES
  //////////////////////////////////////////

  struct RebalanceDebtFillUpLocalVariables {
    uint debtAmount;
    uint availableBalanceTokenA;
    uint availableBalanceTokenB;
    uint needToBorrowOrFreeFromBorrow;
  }

  //////////////////////////////////////////
  //            MAIN LOGIC
  //////////////////////////////////////////

  /// @dev Returns the total collateral amount out for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @return totalCollateralAmountOut The total collateral amount out for the token pair.
  function getDebtTotalCollateralAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) internal returns (uint totalCollateralAmountOut) {
    (, totalCollateralAmountOut) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB, false);
  }

  /// @dev Returns the total debt amount out for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @return totalDebtAmountOut The total debt amount out for the token pair.
  function getDebtTotalDebtAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) internal returns (uint totalDebtAmountOut) {
    (totalDebtAmountOut,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB, true);
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
    uint fee1,
    uint liquidatorSwapSlippage
  ) internal {
    uint tokenAFee = depositorSwapTokens ? fee1 : fee0;
    uint tokenBFee = depositorSwapTokens ? fee0 : fee1;
    _closeDebt(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee, liquidatorSwapSlippage);
  }

  /// @dev Rebalances the debt by either filling up or closing and reopening debt positions. Sets new tick range.
  function rebalanceDebt(
    ITetuConverter tetuConverter,
    address controller,
    UniswapV3ConverterStrategyLogicLib.State storage state,
    uint liquidatorSwapSlippage
  ) external {
    IUniswapV3Pool pool = state.pool;
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    bool depositorSwapTokens = state.depositorSwapTokens;
    (uint tokenAFee, uint tokenBFee) = depositorSwapTokens ? (state.rebalanceEarned1, state.rebalanceEarned0) : (state.rebalanceEarned0, state.rebalanceEarned1);
    if (state.fillUp) {
      _rebalanceDebtFillup(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee, liquidatorSwapSlippage);
      (state.lowerTick, state.upperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    } else {
      _closeDebt(tetuConverter, controller, pool, tokenA, tokenB, tokenAFee, tokenBFee, liquidatorSwapSlippage);
      (int24 newLowerTick, int24 newUpperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
      bytes memory entryData = getEntryData(pool, newLowerTick, newUpperTick, depositorSwapTokens);
      _openDebt(tetuConverter, tokenA, tokenB, entryData, tokenAFee);
      state.lowerTick = newLowerTick;
      state.upperTick = newUpperTick;
    }
  }

  function getEntryData(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    address token1 = pool.token1();
    uint token1Price = UniswapV3Lib.getPrice(address(pool), token1);

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

  function calcTickRange(IUniswapV3Pool pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
    (, int24 tick, , , , ,) = pool.slot0();
    if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
      lowerTick = ((tick - tickRange) / tickSpacing - 1) * tickSpacing;
    } else {
      lowerTick = (tick - tickRange) / tickSpacing * tickSpacing;
    }
    upperTick = tickRange == 0 ? lowerTick + tickSpacing : lowerTick + tickRange * 2;
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
    int24 fullTickRange = upperTick - lowerTick;
    (lowerTickNew, upperTickNew) = calcTickRange(pool, fullTickRange == tickSpacing ? int24(0) : fullTickRange / 2, tickSpacing);
  }

  /// @notice Closes debt by liquidating tokens as necessary.
  ///         This function helps ensure that the converter strategy maintains the appropriate balances
  ///         and debt positions for token A and token B, while accounting for fees and potential price impacts.
  function _closeDebt(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    uint feeA,
    uint feeB,
    uint liquidatorSwapSlippage
  ) internal {
    uint debtAmount = getDebtTotalDebtAmountOut(tetuConverter, tokenA, tokenB);
    IPriceOracle priceOracle = IPriceOracle(IConverterController(tetuConverter.controller()).priceOracle());

    /// after disableFuse() debt can be zero
    /// we close debt only if it is more than $0.1
    if (debtAmount * priceOracle.getAssetPrice(tokenB) / 10 ** IERC20Metadata(tokenB).decimals() > 1e17) {
      uint availableBalanceTokenA = AppLib.balance(tokenA);
      uint availableBalanceTokenB = AppLib.balance(tokenB);

      // exclude fees if it is possible
      if(availableBalanceTokenA > feeA) {
        availableBalanceTokenA -= feeA;
      }
      if(availableBalanceTokenB > feeB) {
        availableBalanceTokenB -= feeB;
      }

      if (availableBalanceTokenB < debtAmount) {
        uint tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
        uint needToSellTokenA = tokenBprice * (debtAmount - availableBalanceTokenB) / 10 ** IERC20Metadata(tokenB).decimals();
        // add 1% gap for price impact
        needToSellTokenA += needToSellTokenA / SELL_GAP;

        ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, Math.min(needToSellTokenA, availableBalanceTokenA), liquidatorSwapSlippage, 0);
        availableBalanceTokenB = AppLib.balance(tokenB);
        if(availableBalanceTokenB > feeB) {
          availableBalanceTokenB -= feeB;
        }
      }

      ConverterStrategyBaseLib.closePosition(
        tetuConverter,
        tokenA,
        tokenB,
        Math.min(debtAmount, availableBalanceTokenB)
      );

      availableBalanceTokenB = AppLib.balance(tokenB);
      if(availableBalanceTokenB > feeB) {
        availableBalanceTokenB -= feeB;
      }
      ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, availableBalanceTokenB, liquidatorSwapSlippage, 0);
    }
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
      AppLib.balance(tokenA) - feeA,
      0
    );
  }

  /// @dev Rebalances the debt to reach the optimal ratio between token A and token B.
  function _rebalanceDebtFillup(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    uint tokenAFee,
    uint tokenBFee,
    uint liquidatorSwapSlippage
  ) internal {
    RebalanceDebtFillUpLocalVariables memory vars;
    vars.debtAmount = getDebtTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

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

        ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, vars.availableBalanceTokenB, liquidatorSwapSlippage, 0);

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
        ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, liquidatorSwapSlippage, 0);

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

  /// @dev Gets the token balance without fees.
  /// @param token The token address.
  /// @param fee The fee amount to be subtracted from the balance.
  /// @return balanceWithoutFees The token balance without the specified fee amount.
  function getBalanceWithoutFees(address token, uint fee) internal view returns (uint balanceWithoutFees) {
    balanceWithoutFees = AppLib.balance(token);
    require(balanceWithoutFees >= fee, Uni3StrategyErrors.BALANCE_LOWER_THAN_FEE);
    balanceWithoutFees -= fee;
  }

}
