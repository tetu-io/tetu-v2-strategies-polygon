// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../ConverterStrategyBaseLib.sol";

/// @notice Reimplement ConverterStrategyBaseLib.closePositionsToGetAmount with swapping through aggregators
contract UniswapV3AggLib {
  uint internal constant _ASSET_LIQUIDATION_SLIPPAGE = 300;

  enum AggKinds {
    AGG_KIND_UNKNOWN_0,
    /// @notice For tests: ITetuLiquidator
    AGG_KIND_LIQUIDATOR_1
  }

  /// @notice Set of parameters required to liquidation through aggregators
  struct InputParams {
    ITetuConverter converter;

    AggKinds aggKind;
    address aggAddress;

    /// @notice Assets used by depositor
    address[] tokens;
    /// @notice Index of underlying in {tokens}
    uint indexAsset;
    /// @notice Liquidation thresholds for the {tokens}
    uint[] liquidationThresholds;
  }

  struct CloseDebtsForRequiredAmountLocal {
    uint len;
    address asset;
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

  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  function withdrawByAgg(
    ITetuConverter converter_,
    uint aggKind,
    address agg,
    address[] memory tokens,
    uint indexAsset,
    uint[] memory liquidationThresholds
  ) external {
    InputParams memory p = InputParams({
      converter: converter_,
      aggKind: AggKinds(aggKind),
      aggAddress: agg,
      tokens: tokens,
      indexAsset: indexAsset,
      liquidationThresholds: liquidationThresholds
    });

    bool noDebtsLeft = false;
    while (! noDebtsLeft) {
      console.log("UniswapV3AggLib.withdrawByAgg.closePositionsToGetAmount.gasleft", gasleft());
      (, noDebtsLeft) = _closePositionsToGetAmount(p, type(uint).max);
    }
  }

  /// @notice Close debts (if it's allowed) in converter until we don't have {requestedAmount} on balance
  /// @param requestedAmount Requested amount of main asset that should be added to the current balance
  /// @return expectedAmount Main asset amount expected to be received on balance after all conversions and swaps
  /// @return noDebtsLeft ALl debts were completely repaid
  function _closePositionsToGetAmount(InputParams memory p, uint requestedAmount) internal returns (
    uint expectedAmount,
    bool noDebtsLeft
  ) {
    console.log("closePositionsToGetAmount.requestedAmount", requestedAmount);
    if (requestedAmount != 0) {
      CloseDebtsForRequiredAmountLocal memory v;
      v.asset = p.tokens[p.indexAsset];
      v.len = p.tokens.length;
      v.balance = IERC20(v.asset).balanceOf(address(this));

      for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
        if (i == p.indexAsset) continue;

        // we need to increase balance on the following amount: requestedAmount - v.balance;
        // we can have two possible borrows: 1) direct (v.asset => tokens[i]) and 2) reverse (tokens[i] => v.asset)
        // normally we can have only one of them, not both.. but better to take into account possibility to have two debts simultaneously

        // reverse debt
        (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(address(this), p.tokens[i], v.asset, true);
        console.log("_closePositionsToGetAmount.v.debtReverse", v.debtReverse);
        console.log("_closePositionsToGetAmount.v.collateralReverse", v.collateralReverse);

        // direct debt
        (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(address(this), v.asset, p.tokens[i], true);
        console.log("_closePositionsToGetAmount.v.totalDebt", v.totalDebt);
        console.log("_closePositionsToGetAmount.v.totalCollateral", v.totalCollateral);

        v.tokenBalance = IERC20(p.tokens[i]).balanceOf(address(this));
        console.log("_closePositionsToGetAmount.v.tokenBalance", v.tokenBalance);

        if (v.totalDebt != 0 || v.tokenBalance != 0 || v.debtReverse != 0) {
          //lazy initialization of the prices and decs
          if (v.prices.length == 0) {
            (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(
              IPriceOracle(IConverterController(p.converter.controller()).priceOracle()),
              p.tokens,
              v.len
            );
          }
          console.log("_closePositionsToGetAmount.prices", v.prices[0], v.prices[1]);

          // repay reverse debt if any
          if (v.debtReverse != 0) {
            // what amount of tokens[i] we should sell to pay the debt
            uint toSell = ConverterStrategyBaseLib._getAmountToSell(
            // {requestedAmount} recalculated to tokens[i]
              requestedAmount == type(uint).max
                ? requestedAmount
                : requestedAmount * v.prices[p.indexAsset] * v.decs[i] / v.prices[i] / v.decs[p.indexAsset],
              v.debtReverse,
              v.collateralReverse,
              v.prices,
              v.decs,
              i,
              p.indexAsset,
              v.balance
            );
            console.log("_closePositionsToGetAmount.toSell.1", toSell);

            // convert {toSell} amount of main asset to tokens[i]
            if (toSell != 0 && v.tokenBalance != 0) {
              toSell = Math.min(toSell, v.tokenBalance);
              (toSell,) = _liquidateUni(
                p,
                p.tokens[i],
                v.asset,
                toSell,
                _ASSET_LIQUIDATION_SLIPPAGE,
                p.liquidationThresholds[p.indexAsset],
                false
              );
              v.balance = IERC20(v.asset).balanceOf(address(this));
              console.log("_closePositionsToGetAmount.v.toSell.2", toSell);
            }
            console.log("_closePositionsToGetAmount.v.balance.2", v.balance);

            // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
            // we don't check expectedAmount explicitly - we assume, that the amount received after repaying of the debt
            // will be checked below as a part of result expectedAmount
            ConverterStrategyBaseLib._repayDebt(p.converter, p.tokens[i], v.asset, v.balance);
            noDebtsLeft = noDebtsLeft || (v.balance >= v.debtReverse);
            console.log("_closePositionsToGetAmount.noDebtsLeft.1", noDebtsLeft);

            // we can have some leftovers after closing the debt
            v.balance = IERC20(v.asset).balanceOf(address(this));
            v.tokenBalance = IERC20(p.tokens[i]).balanceOf(address(this));
            console.log("_closePositionsToGetAmount.v.balance.3", v.balance);
            console.log("_closePositionsToGetAmount.tokenBalance.3", v.tokenBalance);
          }

          // repay direct debt if any
          if (v.totalDebt != 0) {
            // what amount of main asset we should sell to pay the debt
            uint toSell = ConverterStrategyBaseLib._getAmountToSell(
              requestedAmount,
              v.totalDebt,
              v.totalCollateral,
              v.prices,
              v.decs,
              p.indexAsset,
              i,
              v.tokenBalance
            );
            console.log("_closePositionsToGetAmount.toSell.4", toSell);

            // convert {toSell} amount of main asset to tokens[i]
            if (toSell != 0 && v.balance != 0) {
              toSell = Math.min(toSell, v.balance);
              (toSell,) = _liquidateUni(
                p,
                v.asset,
                p.tokens[i],
                toSell,
                _ASSET_LIQUIDATION_SLIPPAGE,
                p.liquidationThresholds[i],
                false
              );
              v.tokenBalance = IERC20(p.tokens[i]).balanceOf(address(this));
            }
            console.log("_closePositionsToGetAmount.tokenBalance.5", v.tokenBalance);
            console.log("_closePositionsToGetAmount.toSell.5", toSell);

            // sell {toSell}, repay the debt, return collateral back; we should receive amount > toSell
            expectedAmount += ConverterStrategyBaseLib._repayDebt(p.converter, v.asset, p.tokens[i], v.tokenBalance) - toSell;
            noDebtsLeft = noDebtsLeft || (v.tokenBalance >= v.totalDebt);
            console.log("_closePositionsToGetAmount.noDebtsLeft.2", noDebtsLeft);

            // we can have some leftovers after closing the debt
            v.tokenBalance = IERC20(p.tokens[i]).balanceOf(address(this));
            console.log("_closePositionsToGetAmount.v.balance.6", v.balance);
            console.log("_closePositionsToGetAmount.tokenBalance.6", v.tokenBalance);
          }

          // directly swap leftovers
          if (v.tokenBalance != 0) {
            (uint spentAmountIn,) = _liquidateUni(
              p,
              p.tokens[i],
              v.asset,
              v.tokenBalance,
              _ASSET_LIQUIDATION_SLIPPAGE,
              p.liquidationThresholds[p.indexAsset],
              false
            );
            console.log("_closePositionsToGetAmount.tokenBalance.7", IERC20(p.tokens[i]).balanceOf(address(this)));
            if (spentAmountIn != 0) {
              // spentAmountIn can be zero if token balance is less than liquidationThreshold
              expectedAmount += spentAmountIn * v.prices[i] * v.decs[p.indexAsset] / v.prices[p.indexAsset] / v.decs[i];
            }
          }

          // reduce of requestedAmount on the balance increment
          v.newBalance = IERC20(v.asset).balanceOf(address(this));
          require(v.newBalance >= v.balance, AppErrors.BALANCE_DECREASE);
          console.log("_closePositionsToGetAmount.v.newBalance.8", v.newBalance);

          if (requestedAmount > v.newBalance - v.balance) {
            requestedAmount -= (v.newBalance - v.balance);
            v.balance = v.newBalance;
          } else {
            // we get requestedAmount on the balance and don't need to make any other conversions
            break;
          }
        }
      }
    }

    console.log("expectedAmount", expectedAmount);
    return (expectedAmount, noDebtsLeft);
  }

  /// @notice Make liquidation if estimated amountOut exceeds the given threshold
  /// @param spentAmountIn Amount of {tokenIn} has been consumed by the liquidator (== 0 | amountIn_)
  /// @param receivedAmountOut Amount of {tokenOut_} has been returned by the liquidator
  /// @param skipValidation Don't check correctness of conversion using TetuConverter's oracle (i.e. for reward tokens)
  function _liquidateUni(
    InputParams memory p,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenOut_,
    bool skipValidation
  ) internal returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    if (p.aggKind == AggKinds.AGG_KIND_LIQUIDATOR_1) {
      return ConverterStrategyBaseLib.liquidate(
        p.converter,
        ITetuLiquidator(p.aggAddress),
        tokenIn_,
        tokenOut_,
        amountIn_,
        slippage_,
        liquidationThresholdForTokenOut_,
        skipValidation
      );
    }
    return (spentAmountIn, receivedAmountOut);
  }
}