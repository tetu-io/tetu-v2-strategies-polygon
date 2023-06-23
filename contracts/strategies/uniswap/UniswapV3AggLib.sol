// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../ConverterStrategyBaseLib.sol";
import "./UniswapV3DebtLib.sol";

/// @notice Reimplement ConverterStrategyBaseLib.closePositionsToGetAmount with swapping through aggregators
library UniswapV3AggLib {
  uint internal constant _ASSET_LIQUIDATION_SLIPPAGE = 300;
  /// @notice In all functions below array {token} contains underlying in the first position
  uint internal constant IDX_ASSET = 0;
  /// @notice In all functions below array {token} contains not-underlying in the second position
  uint internal constant IDX_TOKEN = 1;

  //region ------------------------------------------------ Data types
  struct SwapByAggParams {
    address tokenToSwap;
    uint amountToSwap;
    /// @notice Aggregator to make swap
    address aggregator;
    /// @notice Swap-data prepared off-chain (route, amounts, etc). 0 - use liquidator to make swap
    bytes swapData;
    bool useLiquidator;
  }

  /// @notice Set of parameters required to liquidation through aggregators
  struct InputParams {
    ITetuConverter converter;

    /// @notice Assets used by depositor stored as following way: [underlying, not-underlying]
    address[] tokens;

    /// @notice Liquidation thresholds for the {tokens}
    uint[] liquidationThresholds;

    /// @notice Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
    ///         The leftovers should be swapped to get following result proportions of the assets:
    ///         not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
    uint propNotUnderlying18;
  }

  struct CloseDebtsForRequiredAmountLocal {
    /// @notice Underlying balance
    uint assetBalance;
    /// @notice Not-underlying balance
    uint tokenBalance;

    uint totalDebt;
    uint totalCollateral;

    uint debtReverse;
    uint collateralReverse;

    /// @notice Cost of $1 in terms of the assets, decimals 18
    uint[] prices;
    /// @notice 10**decimal for the assets
    uint[] decs;

    uint toSellAssets;
    uint toSellTokens;

    uint costAssets;
    uint costTokens;
    uint targetAssets;
    uint targetTokens;
  }
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ External functions

  /// @notice Get info for the swap that will be made on the next call of {withdrawStep}
  /// @param tokens Tokens used by depositor (length == 2: underlying and not-underlying)
  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  /// @param propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                           The leftovers should be swapped to get following result proportions of the assets:
  ///                           not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  /// @return tokenToSwap Address of the token that will be swapped on the next swap. 0 - no swap
  /// @return amountToSwap Amount that will be swapped on the next swap. 0 - no swap
  function quoteWithdrawStep(
    ITetuConverter converter_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    uint propNotUnderlying18
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ){
    InputParams memory p = InputParams({
      converter: converter_,
      tokens: tokens,
      liquidationThresholds: liquidationThresholds,
      propNotUnderlying18: propNotUnderlying18
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
    uint propNotUnderlying18
  ) external returns (
    bool completed
  ){
    InputParams memory p = InputParams({
      converter: converter_,
      tokens: tokens,
      liquidationThresholds: liquidationThresholds,
      propNotUnderlying18: propNotUnderlying18
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
  function _quoteWithdrawStep(InputParams memory p) internal returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    console.log("_quoteWithdrawStep.start");
    uint indexTokenToSwapPlus1;
    (indexTokenToSwapPlus1, amountToSwap,) = _getIterationPlan(p);
    if (indexTokenToSwapPlus1 != 0) {
      tokenToSwap = p.tokens[indexTokenToSwapPlus1 - 1];
    }
    console.log("_quoteWithdrawStep.tokenToSwap", tokenToSwap);
    console.log("_quoteWithdrawStep.amountToSwap", amountToSwap);
    return (tokenToSwap, amountToSwap);
  }

  /// @notice Make one iteration of withdraw. Each iteration can make 0 or 1 swap only
  ///         We can make only 1 of the following 3 operations per single call:
  ///         1) repay direct debt 2) repay reverse debt 3) swap leftovers to underlying
  function _withdrawStep(InputParams memory p, SwapByAggParams memory aggParams) internal returns (
    bool completed
  ) {
    console.log("makeWithdrawStep.token0 initial balance", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("makeWithdrawStep.token1 initial balance", IERC20(p.tokens[1]).balanceOf(address(this)));

    (uint idxToSwap1, uint amountToSwap, uint idxToRepay1) = _getIterationPlan(p);
    console.log("makeWithdrawStep.indexTokenToSwapPlus1", idxToSwap1);
    console.log("makeWithdrawStep.amountToSwap", amountToSwap);
    console.log("makeWithdrawStep.indexRepayTokenPlus1", idxToRepay1);

    if (idxToSwap1 != 0) {
      _swap(p, aggParams, idxToSwap1 - 1, idxToSwap1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET, amountToSwap);
      console.log("makeWithdrawStep.token0 after swap", IERC20(p.tokens[0]).balanceOf(address(this)));
      console.log("makeWithdrawStep.token1 after swap", IERC20(p.tokens[1]).balanceOf(address(this)));
    }

    if (idxToRepay1 != 0) {
      console.log("makeWithdrawStep._repayDebt.amount", IERC20(p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET]).balanceOf(address(this)));
      ConverterStrategyBaseLib._repayDebt(
        p.converter,
        p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET],
        p.tokens[idxToRepay1 - 1],
        IERC20(p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET]).balanceOf(address(this))
      );
    }

    console.log("makeWithdrawStep.token0 final balance", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("makeWithdrawStep.token1 final balance", IERC20(p.tokens[1]).balanceOf(address(this)));
    console.log("completed", idxToRepay1 == 0);

    // Withdraw is completed on last iteration (no debts, swapping leftovers)
    return idxToRepay1 == 0;
  }

  /// @notice Generate plan for next withdraw transaction: 1) swap direction/amount 2) direction of repay (after swap)
  /// @return indexTokenToSwapPlus1 Index of the token to be swapped + 1. 0 - no swap
  /// @return amountToSwap Amount to be swapped. 0 - no swap
  /// @return indexRepayTokenPlus1 Index of the token that should be used to repay borrow in converter + 1.
  ///                              0 - no repay is required - it means that this is a last step with swapping leftovers.
  function _getIterationPlan(InputParams memory p) internal returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap,
    uint indexRepayTokenPlus1
  ) {
    CloseDebtsForRequiredAmountLocal memory v;

    v.assetBalance = IERC20(p.tokens[IDX_ASSET]).balanceOf(address(this));
    v.tokenBalance = IERC20(p.tokens[IDX_TOKEN]).balanceOf(address(this));
    console.log("makeWithdrawStep.v.tokenBalance", v.tokenBalance);

    if (v.tokenBalance != 0) {
      //lazy initialization of the prices and decs
      if (v.prices.length == 0) {
        (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(
          IPriceOracle(IConverterController(p.converter.controller()).priceOracle()),
          p.tokens,
          2 // p.tokens length
        );
      }
      console.log("makeWithdrawStep.prices", v.prices[0], v.prices[1]);

      // we need to increase balance on the following amount: requestedAmount - v.balance;
      // we can have two possible borrows:
      // 1) direct (p.tokens[INDEX_ASSET] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[INDEX_ASSET])
      // normally we can have only one of them, not both..
      // but better to take into account possibility to have two debts simultaneously

      // reverse debt
      (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(
        address(this),
        p.tokens[IDX_TOKEN],
        p.tokens[IDX_ASSET],
        true
      );
      console.log("makeWithdrawStep.v.debtReverse", v.debtReverse);
      console.log("makeWithdrawStep.v.collateralReverse", v.collateralReverse);

      if (v.debtReverse == 0) {
        // direct debt
        (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(
          address(this),
          p.tokens[IDX_ASSET],
          p.tokens[IDX_TOKEN],
          true
        );
        console.log("makeWithdrawStep.v.totalDebt", v.totalDebt);
        console.log("makeWithdrawStep.v.totalCollateral", v.totalCollateral);

        if (v.totalDebt == 0) {
          // directly swap leftovers
          // The leftovers should be swapped to get following result proportions of the assets:
          //      underlying : not-underlying === 1e18 - propNotUnderlying18 : propNotUnderlying18
          (v.targetAssets, v.targetTokens) = _getTargetAmounts(
            v.prices,
            v.decs,
            v.assetBalance,
            v.tokenBalance,
            p.propNotUnderlying18
          );

          if (v.assetBalance < v.targetAssets) {
            // we need to swap not-underlying to underlying
            indexTokenToSwapPlus1 = IDX_TOKEN + 1;
            amountToSwap = v.tokenBalance - v.targetTokens;
          } else {
            // we need to swap underlying to not-underlying
            indexTokenToSwapPlus1 = IDX_ASSET + 1;
            amountToSwap = v.assetBalance - v.targetAssets;
          }
        } else {
          // repay direct debt

          // what amount of underlying we should sell to pay the debt
          v.toSellAssets = ConverterStrategyBaseLib._getAmountToSell(
            type(uint).max,
            v.totalDebt,
            v.totalCollateral,
            v.prices,
            v.decs,
            IDX_ASSET,
            IDX_TOKEN,
            v.tokenBalance
          );
          console.log("makeWithdrawStep.toSellAssets.4", v.toSellAssets);

          // convert {toSell} amount of underlying to token
          if (v.toSellAssets != 0 && v.assetBalance != 0) {
            v.toSellAssets = Math.min(v.toSellAssets, v.assetBalance);
            indexTokenToSwapPlus1 = IDX_ASSET + 1;
            amountToSwap = v.toSellAssets;
          }
          indexRepayTokenPlus1 = IDX_TOKEN + 1;
        }
      } else {
        // repay reverse debt

        // what amount of tokens[i] we should sell to pay the debt
        v.toSellTokens = ConverterStrategyBaseLib._getAmountToSell(
          type(uint).max,
          v.debtReverse,
          v.collateralReverse,
          v.prices,
          v.decs,
          IDX_TOKEN,
          IDX_ASSET,
          v.assetBalance
        );
        console.log("makeWithdrawStep.toSellTokens.1", v.toSellTokens);

        // convert {toSell} amount of main asset to tokens[i]
        if (v.toSellTokens != 0 && v.tokenBalance != 0) {
          v.toSellTokens = Math.min(v.toSellTokens, v.tokenBalance);
          indexTokenToSwapPlus1 = IDX_TOKEN + 1;
          amountToSwap = v.toSellTokens;
        }
        console.log("makeWithdrawStep.toSellTokens.2");

        // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
        // we don't check expectedAmount explicitly - we assume, that the amount received after repaying of the debt
        // will be checked below as a part of result expectedAmount
        indexRepayTokenPlus1 = IDX_ASSET + 1;
        console.log("makeWithdrawStep.toSellTokens.3");
      }
    }

    console.log("getIterationPlan.indexTokenToSwapPlus1, amountToSwap, indexRepayTokenPlus1", indexTokenToSwapPlus1, amountToSwap, indexRepayTokenPlus1);
    return (indexTokenToSwapPlus1, amountToSwap, indexRepayTokenPlus1);
  }

  /// @notice Calculate what balances of underlying and not-underlying we need to fit {propNotUnderlying18}
  /// @param prices Prices of underlying and not underlying
  /// @param decs 10**decimals for underlying and not underlying
  /// @param assetBalance Current balance of underlying
  /// @param tokenBalance Current balance of not-underlying
  /// @param propNotUnderlying18 Required proportion of not-underlying [0..1e18]
  ///                            Proportion of underlying would be (1e18 - propNotUnderlying18)
  function _getTargetAmounts(
    uint[] memory prices,
    uint[] memory decs,
    uint assetBalance,
    uint tokenBalance,
    uint propNotUnderlying18
  ) internal pure returns (
    uint targetAssets,
    uint targetTokens
  ) {
    uint costAssets = assetBalance * prices[0] / decs[0];
    uint costTokens = tokenBalance * prices[1] / decs[1];
    targetTokens = propNotUnderlying18 == 0
      ? 0
      : ((costAssets + costTokens) * propNotUnderlying18 / 1e18);
    targetAssets = ((costAssets + costTokens) - targetTokens) * decs[1] / prices[1];
    targetTokens *= decs[0] / prices[0];
//    console.log("_getTargetAmounts.assetBalance", assetBalance);
//    console.log("_getTargetAmounts.tokenBalance", tokenBalance);
//    console.log("_getTargetAmounts.costAssets", costAssets);
//    console.log("_getTargetAmounts.costTokens", costTokens);
//    console.log("_getTargetAmounts.targetAssets", targetAssets);
//    console.log("_getTargetAmounts.targetTokens", targetTokens);
  }

  function _swap(
    InputParams memory p,
    SwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) internal returns (
    uint spentAmountIn
  ) {
    console.log("_swap");
    if (amountIn > p.liquidationThresholds[indexIn]) {
      console.log("_swap.amountIn", amountIn);
      console.log("_swap.aggParams.amount", aggParams.amountToSwap);
      AppLib.approveIfNeeded(p.tokens[indexIn], aggParams.amountToSwap, aggParams.aggregator);

      uint availableBalanceTokenOutBefore = AppLib.balance(p.tokens[indexOut]);
      console.log("_swap.availableBalanceTokenIn.before", AppLib.balance(p.tokens[indexIn]));
      console.log("_swap.availableBalanceTokenOut.before", availableBalanceTokenOutBefore);
      console.log("_swap.indexIn", indexIn);
      console.log("_swap.INDEX_ASSET", IDX_ASSET);
      console.log("_swap.indexOut", indexOut);

      if (aggParams.useLiquidator) {
        console.log("Swap using liquidator");
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
        console.log("Swap using aggregator");
        UniswapV3DebtLib._checkSwapRouter(aggParams.aggregator);

        // let's ensure that "next swap" is made using correct token
        // todo probably we should check also amountToSwap?
        require(aggParams.tokenToSwap == p.tokens[indexIn], AppErrors.INCORRECT_SWAP_BY_AGG_PARAM);

        (bool success, bytes memory result) = aggParams.aggregator.call(aggParams.swapData);
        console.log("_swap.call.made", success);
        require(success, string(result));

        spentAmountIn = aggParams.amountToSwap;
      }

      console.log("_swap.availableBalanceTokenIn.after", AppLib.balance(p.tokens[indexIn]));
      console.log("_swap.availableBalanceTokenOut.after", AppLib.balance(p.tokens[indexOut]));

      require(
        p.converter.isConversionValid(
          p.tokens[indexIn],
          aggParams.amountToSwap,
          p.tokens[indexOut],
          AppLib.balance(p.tokens[indexOut]) - availableBalanceTokenOutBefore,
          _ASSET_LIQUIDATION_SLIPPAGE
        ), AppErrors.PRICE_IMPACT);
    }

    return spentAmountIn;
  }
  //endregion ------------------------------------------------ Internal helper functions
}