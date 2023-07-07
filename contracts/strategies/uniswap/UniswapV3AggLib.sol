// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../ConverterStrategyBaseLib.sol";
import "./UniswapV3DebtLib.sol";
import "hardhat/console.sol";

/// @notice Reimplement ConverterStrategyBaseLib.closePositionsToGetAmount with swapping through aggregators
library UniswapV3AggLib {
  uint internal constant _ASSET_LIQUIDATION_SLIPPAGE = 300;
  /// @notice In all functions below array {token} contains underlying at the first position
  uint internal constant IDX_ASSET = 0;
  /// @notice In all functions below array {token} contains not-underlying at the second position
  uint internal constant IDX_TOKEN = 1;

  uint internal constant IDX_SWAP_1 = 0;
  uint internal constant IDX_REPAY_1 = 1;
  uint internal constant IDX_SWAP_2 = 2;
  uint internal constant IDX_REPAY_2 = 3;

  //region ------------------------------------------------ Data types
  struct SwapByAggParams {
    bool useLiquidator;
    address tokenToSwap;
    /// @notice Aggregator to make swap
    address aggregator;
    uint amountToSwap;
    /// @notice Swap-data prepared off-chain (route, amounts, etc). 0 - use liquidator to make swap
    bytes swapData;
  }

  struct SwapAmountToRepay2 {
    uint x;
    uint y;
    uint c0;
    uint b0;
    uint alpha;
    int b;
  }
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ External functions

  /// @notice Get info for the swap that will be made on the next call of {withdrawStep}
  /// @param tokens Tokens used by depositor (length == 2: underlying and not-underlying)
  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  /// @param propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                           The leftovers should be swapped to get following result proportions of the assets:
  ///                           not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  /// @param amountsFromPool Amounts of {tokens} that will be received from the pool before calling withdraw
  /// @return tokenToSwap Address of the token that will be swapped on the next swap. 0 - no swap
  /// @return amountToSwap Amount that will be swapped on the next swap. 0 - no swap
  function quoteWithdrawStep(
    ITetuConverter converter_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    uint[] memory amountsFromPool,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ){
    (uint[] memory prices, uint[] memory decs) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(converter_), tokens, 2);
    ConverterStrategyBaseLib.SwapRepayPlanParams memory p = ConverterStrategyBaseLib.SwapRepayPlanParams({
      converter: converter_,
      tokens: tokens,
      liquidationThresholds: liquidationThresholds,
      propNotUnderlying18: propNotUnderlying18,
      prices: prices,
      decs: decs,
      balanceAdditions: amountsFromPool,
      planKind: planKind
    });
    return _quoteWithdrawStep(p);
  }

  /// @notice Make withdraw step with 0 or 1 swap only. The step can make one of the following actions:
  ///         1) repay direct debt 2) repay reverse debt 3) final swap leftovers of not-underlying asset
  /// @param tokens Tokens used by depositor (length == 2: underlying and not-underlying)
  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  /// @param tokenToSwap_ Address of the token that will be swapped on the next swap. 0 - no swap
  /// @param amountToSwap_ Amount that will be swapped on the next swap. 0 - no swap
  /// @param aggregator_ Aggregator that should be used for the next swap. 0 - no swap
  /// @param swapData_ Swap data to be passed to the aggregator on the next swap.
  ///                  Swap data contains swap-route, amount and all other required info for the swap.
  ///                  Swap data should be prepared on-chain on the base of data received by {quoteWithdrawStep}
  /// @param propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                           The leftovers should be swapped to get following result proportions of the assets:
  ///                           not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  /// @return completed All debts were closed, leftovers were swapped to the required proportions
  function withdrawStep(
    ITetuConverter converter_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    address tokenToSwap_,
    uint amountToSwap_,
    address aggregator_,
    bytes memory swapData_,
    bool useLiquidator_,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    bool completed
  ){
    (uint[] memory prices, uint[] memory decs) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(converter_), tokens, 2);

    ConverterStrategyBaseLib.SwapRepayPlanParams memory p = ConverterStrategyBaseLib.SwapRepayPlanParams({
      converter: converter_,
      tokens: tokens,
      liquidationThresholds: liquidationThresholds,
      propNotUnderlying18: propNotUnderlying18,
      prices: prices,
      decs: decs,
      balanceAdditions: new uint[](2), // 2 = tokens.length
      planKind: planKind
    });
    SwapByAggParams memory aggParams = SwapByAggParams({
      tokenToSwap: tokenToSwap_,
      amountToSwap: amountToSwap_,
      useLiquidator: useLiquidator_,
      aggregator: aggregator_,
      swapData: swapData_
    });
    return _withdrawStep(p, aggParams);
  }
  //endregion ------------------------------------------------ External functions

  //region ------------------------------------------------ Internal helper functions
  /// @notice Quote amount of the next swap if any.
  ///         Swaps are required if direct-borrow exists OR reverse-borrow exists or not underlying leftovers exist
  ///         Function returns info for first swap only.
  /// @return tokenToSwap What token should be swapped. Zero address if no swap is required
  /// @return amountToSwap Amount to swap. Zero if no swap is required.
  function _quoteWithdrawStep(ConverterStrategyBaseLib.SwapRepayPlanParams memory p) internal returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    uint indexTokenToSwapPlus1;
    (indexTokenToSwapPlus1, amountToSwap,) = ConverterStrategyBaseLib._buildIterationPlan(p, type(uint).max, IDX_ASSET, IDX_TOKEN);
    if (indexTokenToSwapPlus1 != 0) {
      tokenToSwap = p.tokens[indexTokenToSwapPlus1 - 1];
    }
    return (tokenToSwap, amountToSwap);
  }

  /// @notice Make one iteration of withdraw. Each iteration can make 0 or 1 swap only
  ///         We can make only 1 of the following 3 operations per single call:
  ///         1) repay direct debt 2) repay reverse debt 3) swap leftovers to underlying
  function _withdrawStep(ConverterStrategyBaseLib.SwapRepayPlanParams memory p, SwapByAggParams memory aggParams) internal returns (
    bool completed
  ) {
    console.log("_withdrawStep");
    console.log("_withdrawStep.balance.init.0", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("_withdrawStep.balance.init.1", IERC20(p.tokens[1]).balanceOf(address(this)));

    (uint idxToSwap1, uint amountToSwap, uint idxToRepay1) = ConverterStrategyBaseLib._buildIterationPlan(p, type(uint).max, IDX_ASSET, IDX_TOKEN);
    bool[4] memory actions = [
      p.planKind == IterationPlanKinds.PLAN_SWAP_ONLY || p.planKind == IterationPlanKinds.PLAN_SWAP_REPAY, // swap 1
      p.planKind == IterationPlanKinds.PLAN_REPAY_SWAP_REPAY || p.planKind == IterationPlanKinds.PLAN_SWAP_REPAY, // repay 1
      p.planKind == IterationPlanKinds.PLAN_REPAY_SWAP_REPAY, // swap 2
      p.planKind == IterationPlanKinds.PLAN_REPAY_SWAP_REPAY // repay 2
    ];

    if (idxToSwap1 != 0 && actions[IDX_SWAP_1]) {
      console.log("_withdrawStep.swap1", amountToSwap, idxToSwap1);
      _swap(p, aggParams, idxToSwap1 - 1, idxToSwap1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET, amountToSwap);
      console.log("_withdrawStep.balance.after.swap1", IERC20(p.tokens[0]).balanceOf(address(this)));
      console.log("_withdrawStep.balance.after.swap1", IERC20(p.tokens[1]).balanceOf(address(this)));
    }

    if (idxToRepay1 != 0 && actions[IDX_REPAY_1]) {
      console.log("_withdrawStep.repay", idxToRepay1, IERC20(p.tokens[idxToRepay1 - 1]).balanceOf(address(this)));
      ConverterStrategyBaseLib._repayDebt(
        p.converter,
        p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET],
        p.tokens[idxToRepay1 - 1],
        IERC20(p.tokens[idxToRepay1 - 1]).balanceOf(address(this))
      );
      console.log("_withdrawStep.balance.after.repay.0", IERC20(p.tokens[0]).balanceOf(address(this)));
      console.log("_withdrawStep.balance.after.repay.1", IERC20(p.tokens[1]).balanceOf(address(this)));
    }

    if (idxToSwap1 != 0 && actions[IDX_SWAP_2]) {
      console.log("_withdrawStep.swap2", amountToSwap, idxToSwap1);
      _swap(p, aggParams, idxToSwap1 - 1, idxToSwap1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET, amountToSwap);
      console.log("_withdrawStep.balance.after.swap2", IERC20(p.tokens[0]).balanceOf(address(this)));
      console.log("_withdrawStep.balance.after.swap2", IERC20(p.tokens[1]).balanceOf(address(this)));

      if (actions[IDX_REPAY_2]) {
        console.log("_withdrawStep.repay2", amountToSwap, idxToSwap1);
        // see calculations inside estimateSwapAmountForRepaySwapRepay
        // There are two possibilities here:
        // 1) All collateral asset available on balance was swapped.
        //   We need additional repay to get assets in right proportions
        // 2) Only part of collateral asset was swapped, so assets are already in right proportions. Repay 2 is not needed
        uint amountToRepay2 = _getAmountToRepay2(
          p,
          idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET,
          idxToRepay1 - 1
        );
        if (amountToRepay2 != 0) { // todo threshold
          ConverterStrategyBaseLib._repayDebt(
            p.converter,
            p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET],
            p.tokens[idxToRepay1 - 1],
            amountToRepay2
          );
          console.log("_withdrawStep.balance.after.repay2", IERC20(p.tokens[0]).balanceOf(address(this)));
          console.log("_withdrawStep.balance.after.repay2", IERC20(p.tokens[1]).balanceOf(address(this)));
        }
      }
    }

    console.log("_withdrawStep.balance.final.0", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("_withdrawStep.balance.final.1", IERC20(p.tokens[1]).balanceOf(address(this)));

    // Withdraw is completed on last iteration (no debts, swapping leftovers)
    return idxToRepay1 == 0;
  }

  /// @notice Calculate amount that should be repaid to get right proportions of assets on balance
  ///         Analyse only single borrow-direction: indexCollateral => indexBorrow
  ///         if borrow is required then return 0
  function _getAmountToRepay2(
    ConverterStrategyBaseLib.SwapRepayPlanParams memory p,
    uint indexCollateral,
    uint indexBorrow
  ) internal view returns (
    uint amountToRepay
  ) {
    console.log("_getAmountToRepay2");
    SwapAmountToRepay2 memory v;
    v.c0 = IERC20(p.tokens[indexCollateral]).balanceOf(address(this)) * p.prices[indexCollateral] / p.decs[indexCollateral];
    v.b0 = IERC20(p.tokens[indexBorrow]).balanceOf(address(this)) * p.prices[indexBorrow] / p.decs[indexBorrow];
    v.x = indexCollateral == IDX_ASSET ? 1e18 - p.propNotUnderlying18 : p.propNotUnderlying18;
    v.y = indexCollateral == IDX_ASSET ? p.propNotUnderlying18 : 1e18 - p.propNotUnderlying18;

    console.log("_getAmountToRepay2.v.c0", v.c0);
    console.log("_getAmountToRepay2.v.b0", v.b0);
    console.log("_getAmountToRepay2.v.x", v.x);
    console.log("_getAmountToRepay2.v.y", v.y);

    (uint needToRepay, uint collateralAmountOut) = p.converter.getDebtAmountStored(
      address(this),
      p.tokens[indexCollateral],
      p.tokens[indexBorrow],
      true
    );
    console.log("_getAmountToRepay2.needToRepay", needToRepay);
    console.log("_getAmountToRepay2.collateralAmountOut", collateralAmountOut);

    if (needToRepay != 0) {
      // initial balances: c0, b0
      // we are going to repay amount b and receive (alpha * b, b), where alpha ~ totalCollateral / totalBorrow
      // we should have x/y = (c0 + alpha * b) / (b0 - b)
      // so b = (x * b0 - y * c0) / (alpha * y + x)
      v.alpha = collateralAmountOut * p.prices[indexCollateral] * p.decs[indexBorrow] * 1e18
         / needToRepay / p.prices[indexBorrow] / p.decs[indexCollateral];
      v.b = (int(v.x * v.b0) - int(v.y * v.c0)) / (int(v.alpha * v.y / 1e18) + int(v.x));
      if (v.b > 0) {
        amountToRepay = uint(v.b);
      }
      console.log("_getAmountToRepay2.v.alpha", v.alpha);
      console.log("_getAmountToRepay2.v.b");
      console.logInt(v.b);
    }

    console.log("_getAmountToRepay2.amountToRepay", amountToRepay);
    return amountToRepay * p.decs[indexBorrow] / p.prices[indexBorrow];
  }

  function _swap(
    ConverterStrategyBaseLib.SwapRepayPlanParams memory p,
    SwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) internal returns (
    uint spentAmountIn
  ) {
    if (amountIn > ConverterStrategyBaseLib._getLiquidationThreshold(p.liquidationThresholds[indexIn])) {
      AppLib.approveIfNeeded(p.tokens[indexIn], aggParams.amountToSwap, aggParams.aggregator);

      uint balanceTokenOutBefore = AppLib.balance(p.tokens[indexOut]);

      if (aggParams.useLiquidator) {
        (spentAmountIn,) = ConverterStrategyBaseLib._liquidate(
          p.converter,
          ITetuLiquidator(aggParams.aggregator),
          p.tokens[indexIn],
          p.tokens[indexOut],
          amountIn,
          _ASSET_LIQUIDATION_SLIPPAGE,
          p.liquidationThresholds[indexIn],
          true
        );
      } else {
        UniswapV3DebtLib._checkSwapRouter(aggParams.aggregator);

        // let's ensure that "next swap" is made using correct token
        // todo probably we should check also amountToSwap?
        require(aggParams.tokenToSwap == p.tokens[indexIn], AppErrors.INCORRECT_SWAP_BY_AGG_PARAM);

        (bool success, bytes memory result) = aggParams.aggregator.call(aggParams.swapData);
        require(success, string(result));

        spentAmountIn = aggParams.amountToSwap;
      }

      require(
        p.converter.isConversionValid(
          p.tokens[indexIn],
          aggParams.amountToSwap,
          p.tokens[indexOut],
          AppLib.balance(p.tokens[indexOut]) - balanceTokenOutBefore,
          _ASSET_LIQUIDATION_SLIPPAGE
        ), AppErrors.PRICE_IMPACT);
    }

    return spentAmountIn;
  }
  //endregion ------------------------------------------------ Internal helper functions
}