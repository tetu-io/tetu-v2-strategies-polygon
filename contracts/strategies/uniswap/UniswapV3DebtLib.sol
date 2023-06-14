// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "./UniswapV3Lib.sol";
import "./Uni3StrategyErrors.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuVaultV2.sol";

library UniswapV3DebtLib {

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint public constant SELL_GAP = 100;
  /// @dev should be placed local, probably will be adjusted later
  uint internal constant BORROW_PERIOD_ESTIMATION = 30 days / 2;
  address internal constant ONEINCH = 0x1111111254EEB25477B68fb85Ed929f73A960582; // 1inch router V5
  address internal constant OPENOCEAN = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64; // OpenOceanExchangeProxy

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
  function getDebtTotalCollateralAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) public returns (uint totalCollateralAmountOut) {
    (, totalCollateralAmountOut) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB, false);
  }

  /// @dev Returns the total debt amount out for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @return totalDebtAmountOut The total debt amount out for the token pair.
  function getDebtTotalDebtAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) public returns (uint totalDebtAmountOut) {
    (totalDebtAmountOut,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB, true);
  }

  /// @dev Closes the debt positions for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param controller The controller address.
  /// @param pool The IUniswapV3Pool instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  function closeDebt(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    uint liquidatorSwapSlippage,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) public {
    _closeDebt(tetuConverter, controller, pool, tokenA, tokenB, liquidatorSwapSlippage);
    if (profitToCover > 0) {
      ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets);
    }
  }

  function closeDebtByAgg(
    ITetuConverter tetuConverter,
    address tokenA,
    address tokenB,
    uint liquidatorSwapSlippage,
    UniswapV3ConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) public {
    _closeDebtByAgg(tetuConverter, tokenA, tokenB, liquidatorSwapSlippage, aggParams);
    if (profitToCover > 0) {
      ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets);
    }
  }

  /// @dev Rebalances the debt by either filling up or closing and reopening debt positions. Sets new tick range.
  function rebalanceDebt(
    ITetuConverter tetuConverter,
    address controller,
    UniswapV3ConverterStrategyLogicLib.State storage state,
    uint liquidatorSwapSlippage,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) external {
    IUniswapV3Pool pool = state.pool;
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    bool depositorSwapTokens = state.depositorSwapTokens;
    if (state.fillUp) {
      if (profitToCover > 0) {
        ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets);
      }
      _rebalanceDebtFillup(tetuConverter, controller, pool, tokenA, tokenB, liquidatorSwapSlippage);
      (state.lowerTick, state.upperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    } else {
      _closeDebt(tetuConverter, controller, pool, tokenA, tokenB, liquidatorSwapSlippage);
      if (profitToCover > 0) {
        ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets);
      }
      (int24 newLowerTick, int24 newUpperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
      bytes memory entryData = getEntryData(pool, newLowerTick, newUpperTick, depositorSwapTokens);
      _openDebt(tetuConverter, tokenA, tokenB, entryData);
      state.lowerTick = newLowerTick;
      state.upperTick = newUpperTick;
    }
  }

  function rebalanceDebtSwapByAgg(
    ITetuConverter tetuConverter,
    UniswapV3ConverterStrategyLogicLib.State storage state,
    uint liquidatorSwapSlippage,
    UniswapV3ConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) external {
    IUniswapV3Pool pool = state.pool;
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    bool depositorSwapTokens = state.depositorSwapTokens;
    _closeDebtByAgg(tetuConverter, tokenA, tokenB, liquidatorSwapSlippage, aggParams);
    if (profitToCover > 0) {
      ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets);
    }
  (int24 newLowerTick, int24 newUpperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    bytes memory entryData = getEntryData(pool, newLowerTick, newUpperTick, depositorSwapTokens);
    _openDebt(tetuConverter, tokenA, tokenB, entryData);
    state.lowerTick = newLowerTick;
    state.upperTick = newUpperTick;
  }

  function rebalanceNoSwaps(
    ITetuConverter tetuConverter,
    UniswapV3ConverterStrategyLogicLib.State storage state,
    uint liquidatorSwapSlippage,
    UniswapV3ConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) external {
    IUniswapV3Pool pool = state.pool;
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    bool depositorSwapTokens = state.depositorSwapTokens;
    _closeDebtByAgg(tetuConverter, tokenA, tokenB, liquidatorSwapSlippage, aggParams);
    if (profitToCover > 0) {
      ConverterStrategyBaseLib2.sendToInsurance(tokenA, profitToCover, splitter, totalAssets);
    }
    (int24 newLowerTick, int24 newUpperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    bytes memory entryData = getEntryData(pool, newLowerTick, newUpperTick, depositorSwapTokens);
    _openDebt(tetuConverter, tokenA, tokenB, entryData);
    state.lowerTick = newLowerTick;
    state.upperTick = newUpperTick;
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

  /// @dev we close debt only if it is more than $0.1
  function needCloseDebt(uint debtAmount, ITetuConverter tetuConverter, address tokenB) public view returns (bool) {
    IPriceOracle priceOracle = IPriceOracle(IConverterController(tetuConverter.controller()).priceOracle());
    return debtAmount * priceOracle.getAssetPrice(tokenB) / 10 ** IERC20Metadata(tokenB).decimals() > 1e17;
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
  ///         and debt positions for token A and token B, while accounting for potential price impacts.
  function _closeDebt(
    ITetuConverter tetuConverter,
    address controller,
    IUniswapV3Pool pool,
    address tokenA,
    address tokenB,
    uint liquidatorSwapSlippage
  ) internal {
    uint debtAmount = getDebtTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

    if (needCloseDebt(debtAmount, tetuConverter, tokenB)) {
      uint availableBalanceTokenA = AppLib.balance(tokenA);
      uint availableBalanceTokenB = AppLib.balance(tokenB);

      if (availableBalanceTokenB < debtAmount) {
        uint tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
        uint needToSellTokenA = tokenBprice * (debtAmount - availableBalanceTokenB) / 10 ** IERC20Metadata(tokenB).decimals();
        // add 1% gap for price impact
        needToSellTokenA += needToSellTokenA / SELL_GAP;

        ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, Math.min(needToSellTokenA, availableBalanceTokenA), liquidatorSwapSlippage, 0, false);
        availableBalanceTokenB = AppLib.balance(tokenB);
      }

      ConverterStrategyBaseLib.closePosition(
        tetuConverter,
        tokenA,
        tokenB,
        Math.min(debtAmount, availableBalanceTokenB)
      );

      availableBalanceTokenB = AppLib.balance(tokenB);
      ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, availableBalanceTokenB, liquidatorSwapSlippage, 0, false);
    }
  }

  function _closeDebtByAgg(
    ITetuConverter tetuConverter,
    address tokenA,
    address tokenB,
    uint liquidatorSwapSlippage,
    UniswapV3ConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams
  ) internal {
    _checkSwapRouter(aggParams.agg);

    uint debtAmount = getDebtTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

    if (needCloseDebt(debtAmount, tetuConverter, tokenB)) {
      uint balanceTokenABefore = AppLib.balance(tokenA);
      uint balanceTokenBBefore = AppLib.balance(tokenB);

      address tokenIn = aggParams.direction ? tokenA : tokenB;

      AppLib.approveIfNeeded(tokenIn, aggParams.amount, aggParams.agg);

      {
        (bool success, bytes memory result) = aggParams.agg.call(aggParams.swapData);
        require(success, string(result));
      }

      uint availableBalanceTokenA = AppLib.balance(tokenA);
      uint availableBalanceTokenB = AppLib.balance(tokenB);

      require(
        tetuConverter.isConversionValid(
          tokenIn,
          aggParams.amount,
          aggParams.direction ? tokenB : tokenA,
          aggParams.direction ? availableBalanceTokenB - balanceTokenBBefore : availableBalanceTokenA - balanceTokenABefore,
          liquidatorSwapSlippage
        ), AppErrors.PRICE_IMPACT);

      ConverterStrategyBaseLib.closePosition(
        tetuConverter,
        tokenA,
        tokenB,
        Math.min(debtAmount, availableBalanceTokenB)
      );

      availableBalanceTokenB = AppLib.balance(tokenB);
    }
  }

  /// @dev Opens a new debt position using entry data.
  /// @param tetuConverter The TetuConverter contract.
  /// @param tokenA The address of token A.
  /// @param tokenB The address of token B.
  /// @param entryData The data required to open a position.
  function _openDebt(
    ITetuConverter tetuConverter,
    address tokenA,
    address tokenB,
    bytes memory entryData/*,
    uint feeA*/
  ) internal {
    ConverterStrategyBaseLib.openPosition(
      tetuConverter,
      entryData,
      tokenA,
      tokenB,
      AppLib.balance(tokenA)/* - feeA*/,
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
    uint liquidatorSwapSlippage
  ) internal {
    RebalanceDebtFillUpLocalVariables memory vars;
    vars.debtAmount = getDebtTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

    vars.availableBalanceTokenA = AppLib.balance(tokenA);
    vars.availableBalanceTokenB = AppLib.balance(tokenB);

    // todo fix this logic, i think its incorrect now
    if (vars.debtAmount > 0) {
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

          vars.availableBalanceTokenB = AppLib.balance(tokenB);

          ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenB, tokenA, vars.availableBalanceTokenB, liquidatorSwapSlippage, 0, false);

          vars.availableBalanceTokenA = AppLib.balance(tokenA);

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

          if (needToSellTokenA <= vars.availableBalanceTokenA) {
            ConverterStrategyBaseLib.liquidate(tetuConverter, ITetuLiquidator(IController(controller).liquidator()), tokenA, tokenB, needToSellTokenA, liquidatorSwapSlippage, 0, false);

            vars.availableBalanceTokenB = AppLib.balance(tokenB);

            ConverterStrategyBaseLib.closePosition(
              tetuConverter,
              tokenA,
              tokenB,
              vars.debtAmount < vars.availableBalanceTokenB ? vars.debtAmount : vars.availableBalanceTokenB
            );

            vars.availableBalanceTokenA = AppLib.balance(tokenA);

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

  function _checkSwapRouter(address router) internal pure {
    require(router == ONEINCH || router == OPENOCEAN, Uni3StrategyErrors.UNKNOWN_SWAP_ROUTER);
  }
}
