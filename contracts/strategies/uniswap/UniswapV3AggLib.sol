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
    address aggregator;
    bytes swapData;
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
    return _quoteWithdrawStep(p, type(uint).max);
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
  function withdrawStep(
    ITetuConverter converter_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    address tokenToSwap_,
    uint amountToSwap_,
    address aggregator_,
    bytes memory swapData_,
    uint propNotUnderlying18
  ) external returns (
    bool completed,
    uint[] memory expectedAmounts,
    uint[] memory amountsOut
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
      aggregator: aggregator_,
      swapData: swapData_
    });
    return _withdrawStep(p, type(uint).max, aggParams);
  }
  //endregion ------------------------------------------------ External functions


  //region ------------------------------------------------ Internal helper functions

  /// @notice Quote amount of the next swap if any.
  ///         Swaps are required if direct-borrow exists OR reverse-borrow exists or not underlying leftovers exist
  ///         Function returns info for first swap only.
  /// @return tokenToSwap What token should be swapped. Zero address if no swap is required
  /// @return amountToSwap Amount to swap. Zero if no swap is required.
  function _quoteWithdrawStep(InputParams memory p, uint requestedAmount) internal returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    console.log("quoteWithdrawStep.requestedAmount", requestedAmount);
    if (requestedAmount != 0) {
      CloseDebtsForRequiredAmountLocal memory v;
      v.assetBalance = IERC20(p.tokens[IDX_ASSET]).balanceOf(address(this));

      v.tokenBalance = IERC20(p.tokens[IDX_TOKEN]).balanceOf(address(this));
      console.log("quoteWithdrawStep.v.tokenBalance", v.tokenBalance);

      if (v.tokenBalance != 0) {
        //lazy initialization of the prices and decs
        if (v.prices.length == 0) {
          (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(
            IPriceOracle(IConverterController(p.converter.controller()).priceOracle()),
            p.tokens,
            2 // tokens length
          );
        }
        console.log("quoteWithdrawStep.prices", v.prices[0], v.prices[1]);

        // we need to increase balance on the following amount: requestedAmount - v.balance;
        // we can have two possible borrows: 1) direct (p.tokens[INDEX_ASSET] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[INDEX_ASSET])
        // normally we can have only one of them, not both.. but better to take into account possibility to have two debts simultaneously

        // reverse debt
        (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(address(this), p.tokens[IDX_TOKEN], p.tokens[IDX_ASSET], true);
        console.log("quoteWithdrawStep.v.debtReverse", v.debtReverse);
        console.log("quoteWithdrawStep.v.collateralReverse", v.collateralReverse);

        if (v.debtReverse == 0) {
          // direct debt
          (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(address(this), p.tokens[IDX_ASSET], p.tokens[IDX_TOKEN], true);
          console.log("quoteWithdrawStep.v.totalDebt", v.totalDebt);
          console.log("quoteWithdrawStep.v.totalCollateral", v.totalCollateral);

          if (v.totalDebt == 0) {
            // directly swap leftovers
            // The leftovers should be swapped to get following result proportions of the assets:
            //      underlying : not-underlying === 1e18 - propNotUnderlying18 : propNotUnderlying18
            v.costAssets = v.assetBalance * v.prices[0] / v.decs[0];
            v.costTokens = v.tokenBalance * v.prices[1] / v.decs[1];
            v.targetTokens = p.propNotUnderlying18 == 0
              ? 0
              : ((v.costAssets + v.costTokens) * p.propNotUnderlying18 / 1e18);
            v.targetAssets = ((v.costAssets + v.costTokens) - v.targetTokens) * v.decs[1] / v.prices[1];
            v.targetTokens *= v.decs[0] / v.prices[0];
            console.log("quoteWithdrawStep.assetBalance", v.assetBalance);
            console.log("quoteWithdrawStep.tokenBalance", v.tokenBalance);
            console.log("quoteWithdrawStep.costAssets", v.costAssets);
            console.log("quoteWithdrawStep.costTokens", v.costTokens);
            console.log("quoteWithdrawStep.targetAssets", v.targetAssets);
            console.log("quoteWithdrawStep.targetTokens", v.targetTokens);

            if (v.assetBalance < v.targetAssets) {
              // we need to swap not-underlying to underlying
              if (v.targetTokens - v.tokenBalance > p.liquidationThresholds[IDX_TOKEN]) {
                tokenToSwap = p.tokens[IDX_TOKEN];
                amountToSwap = v.targetTokens - v.tokenBalance;
                console.log("quoteWithdrawStep.amountToSwap.NU=>U.amountToSwap", amountToSwap, tokenToSwap);
              }
            } else {
              // we need to swap underlying to not-underlying
              if (v.targetAssets - v.assetBalance > p.liquidationThresholds[IDX_ASSET]) {
                tokenToSwap = p.tokens[IDX_ASSET];
                amountToSwap = v.targetAssets - v.assetBalance;
                console.log("quoteWithdrawStep.amountToSwap.U=>NU.amountToSwap", amountToSwap, tokenToSwap);
              }
            }
          } else {
            // what amount of main asset we should sell to pay the debt
            v.toSellAssets = ConverterStrategyBaseLib._getAmountToSell(
              requestedAmount,
              v.totalDebt,
              v.totalCollateral,
              v.prices,
              v.decs,
              IDX_ASSET,
              IDX_TOKEN,
              v.tokenBalance
            );
            console.log("quoteWithdrawStep.toSellAssets.4", v.toSellAssets);

            // convert {toSell} amount of main asset to tokens[i]
            if (v.toSellAssets != 0 && v.assetBalance != 0) {
              v.toSellAssets = Math.min(v.toSellAssets, v.assetBalance);
              if (v.toSellAssets > p.liquidationThresholds[IDX_ASSET]) {
                tokenToSwap = p.tokens[IDX_ASSET];
                amountToSwap = v.toSellAssets;
                console.log("quoteWithdrawStep.amountToSwap direct borrow", amountToSwap);
              }
            }
          }
        } else {
          // what amount of tokens[i] we should sell to pay the debt
          v.toSellTokens = ConverterStrategyBaseLib._getAmountToSell(
          // {requestedAmount} recalculated to tokens[i]
            requestedAmount == type(uint).max
              ? requestedAmount
              : requestedAmount * v.prices[IDX_ASSET] * v.decs[IDX_TOKEN] / v.prices[IDX_TOKEN] / v.decs[IDX_ASSET],
            v.debtReverse,
            v.collateralReverse,
            v.prices,
            v.decs,
            IDX_TOKEN,
            IDX_ASSET,
            v.assetBalance
          );
          console.log("quoteWithdrawStep.toSellTokens.1", v.toSellTokens);

          // convert {toSell} amount of main asset to tokens[i]
          if (v.toSellTokens != 0 && v.tokenBalance != 0) {
            v.toSellTokens = Math.min(v.toSellTokens, v.tokenBalance);
            if (v.toSellTokens > p.liquidationThresholds[IDX_TOKEN]) {
              tokenToSwap = p.tokens[IDX_TOKEN];
              amountToSwap = v.toSellTokens;
              console.log("quoteWithdrawStep.amountToSwap reverse borrow", amountToSwap);
            }
          }
        }
      }
    }

    console.log("quoteWithdrawStep.final", tokenToSwap, amountToSwap);
    return (tokenToSwap, amountToSwap);
  }

  /// @notice Make one iteration of withdraw. Each iteration can make 0 or 1 swap only
  ///         We can make only 1 of the following 3 operations per single call:
  ///         1) repay direct debt 2) repay reverse debt 3) swap leftovers to underlying
  function _withdrawStep(InputParams memory p, uint requestedAmount, SwapByAggParams memory aggParams) internal returns (
    bool completed,
    uint[] memory expectedAmounts,
    uint[] memory amountsOut
  ) {
    console.log("makeWithdrawStep.token0 initial balance", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("makeWithdrawStep.token1 initial balance", IERC20(p.tokens[1]).balanceOf(address(this)));

    expectedAmounts = new uint[](2);
    amountsOut = new uint[](2);

    console.log("makeWithdrawStep.requestedAmount", requestedAmount);
    if (requestedAmount != 0) {
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
            v.costAssets = v.assetBalance * v.prices[0] / v.decs[0];
            v.costTokens = v.tokenBalance * v.prices[1] / v.decs[1];
            v.targetTokens = p.propNotUnderlying18 == 0
              ? 0
              : ((v.costAssets + v.costTokens) * p.propNotUnderlying18 / 1e18);
            v.targetAssets = ((v.costAssets + v.costTokens) - v.targetTokens) * v.decs[1] / v.prices[1];
            v.targetTokens *= v.decs[0] / v.prices[0];
            console.log("makeWithdrawStep.assetBalance", v.assetBalance);
            console.log("makeWithdrawStep.tokenBalance", v.tokenBalance);
            console.log("makeWithdrawStep.costAssets", v.costAssets);
            console.log("makeWithdrawStep.costTokens", v.costTokens);
            console.log("makeWithdrawStep.targetAssets", v.targetAssets);
            console.log("makeWithdrawStep.targetTokens", v.targetTokens);

            if (v.assetBalance < v.targetAssets) {
              // we need to swap not-underlying to underlying
              uint spentAmountIn = _swapByAgg(p, aggParams, IDX_TOKEN, IDX_ASSET, v.targetTokens - v.tokenBalance);
              if (spentAmountIn != 0) {
                // spentAmountIn can be zero if token balance is less than liquidationThreshold
                expectedAmounts[IDX_ASSET] = spentAmountIn
                  * v.prices[IDX_TOKEN] * v.decs[IDX_ASSET]
                  / v.prices[IDX_ASSET] / v.decs[IDX_TOKEN];
                amountsOut[IDX_ASSET] = IERC20(p.tokens[IDX_ASSET]).balanceOf(address(this)) - v.assetBalance;
              }
              console.log("makeWithdrawStep.expectedAmounts[IDX_ASSET]", expectedAmounts[IDX_ASSET]);
              console.log("makeWithdrawStep.amountsOut[IDX_ASSET]", amountsOut[IDX_ASSET]);
            } else {
              // we need to swap underlying to not-underlying
              uint spentAmountIn = _swapByAgg(p, aggParams, IDX_ASSET, IDX_TOKEN, v.targetAssets - v.assetBalance);
              if (spentAmountIn != 0) {
                // spentAmountIn can be zero if token balance is less than liquidationThreshold
                expectedAmounts[IDX_TOKEN] = spentAmountIn
                  * v.prices[IDX_ASSET] * v.decs[IDX_TOKEN]
                  / v.prices[IDX_TOKEN] / v.decs[IDX_ASSET];
                amountsOut[IDX_TOKEN] = IERC20(p.tokens[IDX_TOKEN]).balanceOf(address(this)) - v.tokenBalance;
              }
              console.log("makeWithdrawStep.expectedAmounts[IDX_TOKEN]", expectedAmounts[IDX_TOKEN]);
              console.log("makeWithdrawStep.amountsOut[IDX_TOKEN]", amountsOut[IDX_TOKEN]);
            }

            // this is last step, there are no more leftovers and opened debts
            completed = true;
          } else {
            // repay direct debt

            // what amount of underlying we should sell to pay the debt
            v.toSellAssets = ConverterStrategyBaseLib._getAmountToSell(
              requestedAmount,
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
              v.toSellAssets = _swapByAgg(p, aggParams, IDX_ASSET, IDX_TOKEN, v.toSellAssets);
              v.tokenBalance = IERC20(p.tokens[IDX_TOKEN]).balanceOf(address(this));
            }
            console.log("makeWithdrawStep.tokenBalance.5", v.tokenBalance);
            console.log("makeWithdrawStep.v.toSellAssets.5", v.toSellAssets);

            // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
            expectedAmounts[IDX_ASSET] = ConverterStrategyBaseLib._repayDebt(
              p.converter,
              p.tokens[IDX_ASSET],
              p.tokens[IDX_TOKEN],
              v.tokenBalance
            ) - v.toSellAssets;

            // token's balance can only decrease, asset's balance can only increase
            amountsOut[IDX_ASSET] = IERC20(p.tokens[IDX_ASSET]).balanceOf(address(this)) - v.assetBalance;
          }
        } else {
          // repay reverse debt

          // what amount of tokens[i] we should sell to pay the debt
          v.toSellTokens = ConverterStrategyBaseLib._getAmountToSell(
          // {requestedAmount} recalculated to tokens[i]
            requestedAmount == type(uint).max
              ? requestedAmount
              : requestedAmount * v.prices[IDX_ASSET] * v.decs[IDX_TOKEN] / v.prices[IDX_TOKEN] / v.decs[IDX_ASSET],
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
            v.toSellTokens = _swapByAgg(p, aggParams, IDX_TOKEN, IDX_ASSET, v.toSellTokens);
            v.assetBalance = IERC20(p.tokens[IDX_ASSET]).balanceOf(address(this));
            console.log("makeWithdrawStep.v.toSellTokens.2", v.toSellTokens);
          }
          console.log("makeWithdrawStep.v.balance.2", v.assetBalance);

          // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
          // we don't check expectedAmount explicitly - we assume, that the amount received after repaying of the debt
          // will be checked below as a part of result expectedAmount
          expectedAmounts[IDX_TOKEN] = ConverterStrategyBaseLib._repayDebt(
            p.converter,
            p.tokens[IDX_TOKEN],
            p.tokens[IDX_ASSET],
            v.assetBalance
          );
          // token's balance can only increase, asset's balance can only decrease
          amountsOut[IDX_TOKEN] = IERC20(p.tokens[IDX_TOKEN]).balanceOf(address(this)) - v.tokenBalance;
        }
      }
    }

    console.log("makeWithdrawStep.token0 final balance", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("makeWithdrawStep.token1 final balance", IERC20(p.tokens[1]).balanceOf(address(this)));
    console.log("makeWithdrawStep.completed", completed);
    console.log("makeWithdrawStep.expectedAmounts", expectedAmounts[0], expectedAmounts[1]);
    console.log("makeWithdrawStep.amountsOut", amountsOut[0], amountsOut[1]);

    return (completed, expectedAmounts, amountsOut);
  }

  function _swapByAgg(
    InputParams memory p,
    SwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) internal returns (
    uint spentAmountIn
  ) {
    UniswapV3DebtLib._checkSwapRouter(aggParams.aggregator);

    console.log("_swapByAgg");
    if (amountIn > p.liquidationThresholds[indexIn]) {
      console.log("_swapByAgg.amountIn", amountIn);
      console.log("_swapByAgg.aggParams.amount", aggParams.amountToSwap);
      AppLib.approveIfNeeded(p.tokens[indexIn], aggParams.amountToSwap, aggParams.aggregator);

      uint availableBalanceTokenOutBefore = AppLib.balance(p.tokens[indexOut]);
      console.log("_swapByAgg.availableBalanceTokenIn.before", AppLib.balance(p.tokens[indexIn]));
      console.log("_swapByAgg.availableBalanceTokenOut.before", availableBalanceTokenOutBefore);
      console.log("_swapByAgg.indexIn", indexIn);
      console.log("_swapByAgg.INDEX_ASSET", IDX_ASSET);
      console.log("_swapByAgg.indexOut", indexOut);

      {
        // let's ensure that "next swap" is made using correct token
        // todo probably we should check also amountToSwap?
        require(aggParams.tokenToSwap == p.tokens[indexIn], AppErrors.INCORRECT_SWAP_BY_AGG_PARAM);

        (bool success, bytes memory result) = aggParams.aggregator.call(aggParams.swapData);
        console.log("_swapByAgg.call.made", success);
        require(success, string(result));

        spentAmountIn = aggParams.amountToSwap;
      }

      console.log("_swapByAgg.availableBalanceTokenIn.after", AppLib.balance(p.tokens[indexIn]));
      console.log("_swapByAgg.availableBalanceTokenOut.after", AppLib.balance(p.tokens[indexOut]));

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