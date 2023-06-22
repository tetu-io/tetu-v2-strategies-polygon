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

  struct RebalanceSwapByAggParams {
    address tokenToSwap;
    uint amount;
    address agg;
    bytes swapData;
  }

  /// @notice Set of parameters required to liquidation through aggregators
  struct InputParams {
    ITetuConverter converter;

    /// @notice Assets used by depositor
    address[] tokens;
    /// @notice Index of underlying in {tokens}
    uint indexAsset;
    /// @notice Liquidation thresholds for the {tokens}
    uint[] liquidationThresholds;
  }

  struct CloseDebtsForRequiredAmountLocal {
    uint collateral;
    uint spentAmountIn;
    uint receivedAmount;
    uint balance;
    uint[] tokensBalancesBefore;

    uint totalDebt;
    uint totalCollateral;

    /// @notice Cost of $1 in terms of the assets, decimals 18
    uint[] prices;
    /// @notice 10**decimal for the assets
    uint[] decs;

    uint newBalance;

    uint debtReverse;
    uint collateralReverse;

    uint tokenBalance;
  }

  function quoteWithdrawByAgg(ITetuConverter converter_, address[] memory tokens, uint indexAsset) external returns (
    address tokenToSwap,
    uint amountToSwap
  ){
    InputParams memory p = InputParams({
      converter: converter_,
      tokens: tokens,
      indexAsset: indexAsset,
      liquidationThresholds: new uint[](0)
    });
    return quoteCloseDebtUsingSwapAgg(p, type(uint).max);
  }

  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  function withdrawByAgg(
    ITetuConverter converter_,
    address[] memory tokens,
    uint indexAsset,
    uint[] memory liquidationThresholds,
    address tokenToSwap,
    uint amount,
    address agg,
    bytes memory swapData
  ) external returns (
    bool completed,
    uint[] memory expectedAmounts
  ){
    InputParams memory p = InputParams({
      converter: converter_,
      tokens: tokens,
      indexAsset: indexAsset,
      liquidationThresholds: liquidationThresholds
    });
    RebalanceSwapByAggParams memory aggParams = RebalanceSwapByAggParams({
      tokenToSwap: tokenToSwap,
      amount: amount,
      agg: agg,
      swapData: swapData
    });
    return closeDebtUsingSwapAgg(p, type(uint).max, aggParams);
  }

  /// @notice Quote amount of the next swap if any.
  ///         Swaps are required if direct-borrow exists OR reverse-borrow exists or not underlying leftovers exist
  ///         Function returns info for first swap only.
  /// @return tokenToSwap What token should be swapped. Zero address if no swap is required
  /// @return amountToSwap Amount to swap. Zero if no swap is required.
  function quoteCloseDebtUsingSwapAgg(InputParams memory p, uint requestedAmount) internal returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    console.log("closePositionsToGetAmount.requestedAmount", requestedAmount);
    if (requestedAmount != 0) {
      CloseDebtsForRequiredAmountLocal memory v;
      uint indexToken = p.indexAsset == 0 ? 1 : 0;
      v.balance = IERC20(p.tokens[p.indexAsset]).balanceOf(address(this));

      v.tokenBalance = IERC20(p.tokens[indexToken]).balanceOf(address(this));
      console.log("closeDebtUsingSwapAgg.v.tokenBalance", v.tokenBalance);

      if (v.tokenBalance != 0) {
        //lazy initialization of the prices and decs
        if (v.prices.length == 0) {
          (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(
            IPriceOracle(IConverterController(p.converter.controller()).priceOracle()),
            p.tokens,
            2 // tokens length
          );
        }
        console.log("closeDebtUsingSwapAgg.prices", v.prices[0], v.prices[1]);

        // we need to increase balance on the following amount: requestedAmount - v.balance;
        // we can have two possible borrows: 1) direct (p.tokens[p.indexAsset] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[p.indexAsset])
        // normally we can have only one of them, not both.. but better to take into account possibility to have two debts simultaneously

        // reverse debt
        (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(address(this), p.tokens[indexToken], p.tokens[p.indexAsset], true);
        console.log("closeDebtUsingSwapAgg.v.debtReverse", v.debtReverse);
        console.log("closeDebtUsingSwapAgg.v.collateralReverse", v.collateralReverse);

        if (v.debtReverse == 0) {
          // direct debt
          (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(address(this), p.tokens[p.indexAsset], p.tokens[indexToken], true);
          console.log("closeDebtUsingSwapAgg.v.totalDebt", v.totalDebt);
          console.log("closeDebtUsingSwapAgg.v.totalCollateral", v.totalCollateral);

          if (v.totalDebt == 0) {
            // directly swap leftovers
            tokenToSwap = p.tokens[indexToken];
            amountToSwap = v.tokenBalance;
            console.log("amountToSwap leftovers", amountToSwap);
          } else {
            // what amount of main asset we should sell to pay the debt
            uint toSell = ConverterStrategyBaseLib._getAmountToSell(
              requestedAmount,
              v.totalDebt,
              v.totalCollateral,
              v.prices,
              v.decs,
              p.indexAsset,
              indexToken,
              v.tokenBalance
            );
            console.log("closeDebtUsingSwapAgg.toSell.4", toSell);

            // convert {toSell} amount of main asset to tokens[i]
            if (toSell != 0 && v.balance != 0) {
              toSell = Math.min(toSell, v.balance);
              tokenToSwap = p.tokens[p.indexAsset];
              amountToSwap = toSell;
              console.log("amountToSwap direct borrow", amountToSwap);
            }
          }
        } else {
          // what amount of tokens[i] we should sell to pay the debt
          uint toSell = ConverterStrategyBaseLib._getAmountToSell(
          // {requestedAmount} recalculated to tokens[i]
            requestedAmount == type(uint).max
              ? requestedAmount
              : requestedAmount * v.prices[p.indexAsset] * v.decs[indexToken] / v.prices[indexToken] / v.decs[p.indexAsset],
            v.debtReverse,
            v.collateralReverse,
            v.prices,
            v.decs,
            indexToken,
            p.indexAsset,
            v.balance
          );
          console.log("closeDebtUsingSwapAgg.toSell.1", toSell);

          // convert {toSell} amount of main asset to tokens[i]
          if (toSell != 0 && v.tokenBalance != 0) {
            toSell = Math.min(toSell, v.tokenBalance);
            tokenToSwap = p.tokens[indexToken];
            amountToSwap = toSell;
            console.log("amountToSwap reverse borrow", amountToSwap);
          }
        }
      }
    }

    return (tokenToSwap, amountToSwap);
  }


  /// @notice Make one iteration of withdraw. Each iteration can make 0 or 1 swap only
  ///         We can make only 1 of the following 3 operations per single call:
  ///         1) repay direct debt 2) repay reverse debt 3) swap leftovers to underlying
  function closeDebtUsingSwapAgg(InputParams memory p, uint requestedAmount, RebalanceSwapByAggParams memory aggParams) internal returns (
    bool completed,
    uint[] memory expectedAmounts
  ) {
    console.log("token0 initial balance", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("token1 initial balance", IERC20(p.tokens[1]).balanceOf(address(this)));

    expectedAmounts = new uint[](2);

    console.log("closePositionsToGetAmount.requestedAmount", requestedAmount);
    if (requestedAmount != 0) {
      CloseDebtsForRequiredAmountLocal memory v;
      uint indexToken = p.indexAsset == 0 ? 1 : 0;

      v.balance = IERC20(p.tokens[p.indexAsset]).balanceOf(address(this));
      v.tokenBalance = IERC20(p.tokens[indexToken]).balanceOf(address(this));
      console.log("closeDebtUsingSwapAgg.v.tokenBalance", v.tokenBalance);

      if (v.tokenBalance != 0) {
        //lazy initialization of the prices and decs
        if (v.prices.length == 0) {
          (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(
            IPriceOracle(IConverterController(p.converter.controller()).priceOracle()),
            p.tokens,
            2 // p.tokens length
          );
        }
        console.log("closeDebtUsingSwapAgg.prices", v.prices[0], v.prices[1]);

        // we need to increase balance on the following amount: requestedAmount - v.balance;
        // we can have two possible borrows: 1) direct (p.tokens[p.indexAsset] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[p.indexAsset])
        // normally we can have only one of them, not both.. but better to take into account possibility to have two debts simultaneously

        // reverse debt
        (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(address(this), p.tokens[indexToken], p.tokens[p.indexAsset], true);
        console.log("closeDebtUsingSwapAgg.v.debtReverse", v.debtReverse);
        console.log("closeDebtUsingSwapAgg.v.collateralReverse", v.collateralReverse);

        if (v.debtReverse == 0) {
          // direct debt
          (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(address(this), p.tokens[p.indexAsset], p.tokens[indexToken], true);
          console.log("closeDebtUsingSwapAgg.v.totalDebt", v.totalDebt);
          console.log("closeDebtUsingSwapAgg.v.totalCollateral", v.totalCollateral);

          if (v.totalDebt == 0) {
            // directly swap leftovers
            uint spentAmountIn = _swapByAgg(p, aggParams, indexToken, p.indexAsset, v.tokenBalance);
            if (spentAmountIn != 0) {
              // spentAmountIn can be zero if token balance is less than liquidationThreshold
              expectedAmounts[p.indexAsset] = spentAmountIn * v.prices[indexToken] * v.decs[p.indexAsset] / v.prices[p.indexAsset] / v.decs[indexToken];
            }
            // this is last step, there are no more leftovers and opened debts
            completed = true;
          } else {
            // repay direct debt

            // what amount of underlying we should sell to pay the debt
            uint toSell = ConverterStrategyBaseLib._getAmountToSell(
              requestedAmount,
              v.totalDebt,
              v.totalCollateral,
              v.prices,
              v.decs,
              p.indexAsset,
              indexToken,
              v.tokenBalance
            );
            console.log("closeDebtUsingSwapAgg.toSell.4", toSell);

            // convert {toSell} amount of underlying to token
            if (toSell != 0 && v.balance != 0) {
              toSell = Math.min(toSell, v.balance);
              toSell = _swapByAgg(p, aggParams, p.indexAsset, indexToken, toSell);
              v.tokenBalance = IERC20(p.tokens[indexToken]).balanceOf(address(this));
            }
            console.log("closeDebtUsingSwapAgg.tokenBalance.5", v.tokenBalance);
            console.log("closeDebtUsingSwapAgg.toSell.5", toSell);

            // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
            expectedAmounts[p.indexAsset] = ConverterStrategyBaseLib._repayDebt(
              p.converter,
              p.tokens[p.indexAsset],
              p.tokens[indexToken],
              v.tokenBalance
            ) - toSell;
          }
        } else {
          // repay reverse debt

          // what amount of tokens[i] we should sell to pay the debt
          uint toSell = ConverterStrategyBaseLib._getAmountToSell(
          // {requestedAmount} recalculated to tokens[i]
            requestedAmount == type(uint).max
              ? requestedAmount
              : requestedAmount * v.prices[p.indexAsset] * v.decs[indexToken] / v.prices[indexToken] / v.decs[p.indexAsset],
            v.debtReverse,
            v.collateralReverse,
            v.prices,
            v.decs,
            indexToken,
            p.indexAsset,
            v.balance
          );
          console.log("closeDebtUsingSwapAgg.toSell.1", toSell);

          // convert {toSell} amount of main asset to tokens[i]
          if (toSell != 0 && v.tokenBalance != 0) {
            toSell = Math.min(toSell, v.tokenBalance);
            toSell = _swapByAgg(p, aggParams, indexToken, p.indexAsset, toSell);
            v.balance = IERC20(p.tokens[p.indexAsset]).balanceOf(address(this));
            console.log("closeDebtUsingSwapAgg.v.toSell.2", toSell);
          }
          console.log("closeDebtUsingSwapAgg.v.balance.2", v.balance);

          // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
          // we don't check expectedAmount explicitly - we assume, that the amount received after repaying of the debt
          // will be checked below as a part of result expectedAmount
          expectedAmounts[indexToken] = ConverterStrategyBaseLib._repayDebt(p.converter, p.tokens[indexToken], p.tokens[p.indexAsset], v.balance);
          console.log("closeDebtUsingSwapAgg.expectedAmounts[indexToken]", expectedAmounts[indexToken]);
        }
      }
    }

    console.log("token0 final balance", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("token1 final balance", IERC20(p.tokens[1]).balanceOf(address(this)));
    console.log("completed", completed);
    console.log("expectedAmounts", expectedAmounts[0], expectedAmounts[1]);

    return (completed, expectedAmounts);
  }

  function _swapByAgg(
    InputParams memory p,
    RebalanceSwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) internal returns (uint spentAmountIn) {
    UniswapV3DebtLib._checkSwapRouter(aggParams.agg);

    console.log("_swapByAgg");
    if (amountIn > p.liquidationThresholds[indexIn]) {
      console.log("_swapByAgg.amountIn", amountIn);
      console.log("_swapByAgg.aggParams.amount", aggParams.amount);
      AppLib.approveIfNeeded(p.tokens[indexIn], aggParams.amount, aggParams.agg);

      uint availableBalanceTokenOutBefore = AppLib.balance(p.tokens[indexOut]);
      console.log("_swapByAgg.availableBalanceTokenOutBefore", availableBalanceTokenOutBefore);
      console.log("_swapByAgg.availableBalanceTokenInBefore", AppLib.balance(p.tokens[indexIn]));
      console.log("_swapByAgg.indexIn", indexIn);
      console.log("_swapByAgg.p.indexAsset", p.indexAsset);
      console.log("_swapByAgg.indexOut", indexOut);

      {
        (bool success, bytes memory result) = aggParams.agg.call(aggParams.swapData);
        console.log("_swapByAgg.call.made", success);
        require(success, string(result));
        require(aggParams.tokenToSwap == p.tokens[indexIn], AppErrors.INCORRECT_SWAP_BY_AGG_PARAM);
        spentAmountIn = aggParams.amount;
      }

      uint availableBalanceTokenOut = AppLib.balance(p.tokens[indexOut]);
      console.log("_swapByAgg.availableBalanceTokenOut", availableBalanceTokenOut);

      require(
        p.converter.isConversionValid(
          p.tokens[indexIn],
          aggParams.amount,
          p.tokens[indexOut],
          availableBalanceTokenOut - availableBalanceTokenOutBefore,
          _ASSET_LIQUIDATION_SLIPPAGE
        ), AppErrors.PRICE_IMPACT);
    }

    return spentAmountIn;
  }
}