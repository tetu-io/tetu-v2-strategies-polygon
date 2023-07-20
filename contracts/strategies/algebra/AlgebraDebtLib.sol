// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "./AlgebraLib.sol";
import "./AlgebraStrategyErrors.sol";
import "./AlgebraConverterStrategyLogicLib.sol";
import "../../libs/BorrowLib.sol";
import "../pair/PairBasedStrategyLib.sol";
import "hardhat/console.sol";

library AlgebraDebtLib {
  using SafeERC20 for IERC20;

  //////////////////////////////////////////
  //            Data types
  //////////////////////////////////////////
  struct RebalanceNoSwapsLocal {
    address tokenA;
    address tokenB;
    bool depositorSwapTokens;
    int24 newLowerTick;
    int24 newUpperTick;
    uint prop0;
    uint prop1;
  }

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint public constant SELL_GAP = 100;
  address internal constant ONEINCH = 0x1111111254EEB25477B68fb85Ed929f73A960582; // 1inch router V5
  address internal constant OPENOCEAN = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64; // OpenOceanExchangeProxy

  function calcTickRange(IAlgebraPool pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
    (, int24 tick, , , , ,) = pool.globalState();
    if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
      lowerTick = ((tick - tickRange) / tickSpacing - 1) * tickSpacing;
    } else {
      lowerTick = (tick - tickRange) / tickSpacing * tickSpacing;
    }
    upperTick = tickRange == 0 ? lowerTick + tickSpacing : lowerTick + tickRange * 2;
  }

  /// @notice Calculate proportions of the tokens for entry kind 1
  function getEntryDataProportions(
    IAlgebraPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (uint, uint) {
    address token1 = pool.token1();
    uint token1Price = AlgebraLib.getPrice(address(pool), token1);

    uint token1Decimals = IERC20Metadata(token1).decimals();

    uint token0Desired = token1Price;
    uint token1Desired = 10 ** token1Decimals;
    require(token1Desired != 0, AppErrors.ZERO_VALUE);

    // calculate proportions
    (uint consumed0, uint consumed1,) = AlgebraLib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);
    return depositorSwapTokens
      ? (consumed1 * token1Price / token1Desired, consumed0)
      : (consumed0, consumed1 * token1Price / token1Desired);
  }

  function getEntryData(
    IAlgebraPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    (uint prop0, uint prop1) = getEntryDataProportions(pool, lowerTick, upperTick, depositorSwapTokens);
    entryData = abi.encode(1, prop0, prop1);
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
    IAlgebraPool pool,
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
    AlgebraConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams,
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
    AlgebraConverterStrategyLogicLib.State storage state,
    uint liquidatorSwapSlippage,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) external {
    IAlgebraPool pool = state.pool;
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    bool depositorSwapTokens = state.depositorSwapTokens;
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

  function rebalanceDebtSwapByAgg(
    ITetuConverter tetuConverter,
    AlgebraConverterStrategyLogicLib.State storage state,
    uint liquidatorSwapSlippage,
    AlgebraConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams,
    uint profitToCover,
    uint totalAssets,
    address splitter
  ) external {
    IAlgebraPool pool = state.pool;
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
    address[2] calldata converterLiquidator,
    AlgebraConverterStrategyLogicLib.State storage state,
    uint profitToCover,
    uint totalAssets,
    address splitter,
    mapping(address => uint) storage liquidityThresholds_
  ) external {
    RebalanceNoSwapsLocal memory p;
    IAlgebraPool pool = state.pool;
    p.tokenA = state.tokenA;
    p.tokenB = state.tokenB;
    p.depositorSwapTokens = state.depositorSwapTokens;

    (p.newLowerTick, p.newUpperTick) = _calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    (p.prop0, p.prop1) = getEntryDataProportions(pool, p.newLowerTick, p.newUpperTick, p.depositorSwapTokens);

    BorrowLib.rebalanceAssets(
      ITetuConverter(converterLiquidator[0]),
      ITetuLiquidator(converterLiquidator[1]),
      p.tokenA,
      p.tokenB,
      p.prop0 * BorrowLib.SUM_PROPORTIONS / (p.prop0 + p.prop1),
      liquidityThresholds_[p.tokenA],
      liquidityThresholds_[p.tokenB],
      profitToCover
    );

    console.log("rebalanceNoSwaps");
    console.log("rebalanceNoSwaps.profitToCover", profitToCover);
    console.log("rebalanceNoSwaps.p.prop0 * BorrowLib.SUM_PROPORTIONS / (p.prop0 + p.prop1)", p.prop0 * BorrowLib.SUM_PROPORTIONS / (p.prop0 + p.prop1));
    console.log("rebalanceNoSwaps.balance.tokenA", IERC20(p.tokenA).balanceOf(address(this)));

    // we assume here, that rebalanceAssets provides profitToCover on balance and set leftovers to right proportions
    if (profitToCover > 0) {
      uint profitToSend = Math.min(profitToCover, IERC20(p.tokenA).balanceOf(address(this)));
      console.log("rebalanceNoSwaps.profitToSend", profitToSend);
      ConverterStrategyBaseLib2.sendToInsurance(p.tokenA, profitToSend, splitter, totalAssets);
    }
    console.log("rebalanceNoSwaps.balance.tokenA.2", IERC20(p.tokenA).balanceOf(address(this)));

    state.lowerTick = p.newLowerTick;
    state.upperTick = p.newUpperTick;
  }

  /// @dev Returns the total debt amount out for the given token pair.
  /// @param tetuConverter The ITetuConverter instance.
  /// @param tokenA The address of tokenA.
  /// @param tokenB The address of tokenB.
  /// @return totalDebtAmountOut The total debt amount out for the token pair.
  function getDebtTotalDebtAmountOut(ITetuConverter tetuConverter, address tokenA, address tokenB) public returns (uint totalDebtAmountOut) {
    (totalDebtAmountOut,) = tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB, true);
  }

  /// @dev we close debt only if it is more than $0.1
  function needCloseDebt(uint debtAmount, ITetuConverter tetuConverter, address tokenB) public view returns (bool) {
    IPriceOracle priceOracle = AppLib._getPriceOracle(tetuConverter);
    return debtAmount * priceOracle.getAssetPrice(tokenB) / 10 ** IERC20Metadata(tokenB).decimals() > 1e17;
  }

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
        uint needTransferB = AlgebraLib.getPrice(pool, tokenA) * needToCoverA / 10 ** IERC20Metadata(tokenA).decimals();
        uint canTransferB = Math.min(needTransferB, bB);
        IERC20(tokenB).safeTransferFrom(strategyProfitHolder, address(this), canTransferB);
        needToCoverA -= needToCoverA * canTransferB / needTransferB;
      }
      covered = loss - needToCoverA;
    }
  }

  /// @notice Calculate the new tick range for a Algebra pool.
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
    int24 fullTickRange = upperTick - lowerTick;
    (lowerTickNew, upperTickNew) = calcTickRange(pool, fullTickRange == tickSpacing ? int24(0) : fullTickRange / 2, tickSpacing);
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

  /// @notice Closes debt by liquidating tokens as necessary.
  ///         This function helps ensure that the converter strategy maintains the appropriate balances
  ///         and debt positions for token A and token B, while accounting for potential price impacts.
  function _closeDebt(
    ITetuConverter tetuConverter,
    address controller,
    IAlgebraPool pool,
    address tokenA,
    address tokenB,
    uint liquidatorSwapSlippage
  ) internal {
    uint debtAmount = getDebtTotalDebtAmountOut(tetuConverter, tokenA, tokenB);

    if (needCloseDebt(debtAmount, tetuConverter, tokenB)) {
      uint availableBalanceTokenA = AppLib.balance(tokenA);
      uint availableBalanceTokenB = AppLib.balance(tokenB);

      if (availableBalanceTokenB < debtAmount) {
        uint tokenBprice = AlgebraLib.getPrice(address(pool), tokenB);
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
    AlgebraConverterStrategyLogicLib.RebalanceSwapByAggParams memory aggParams
  ) internal {
    PairBasedStrategyLib._checkSwapRouter(aggParams.agg);

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
}