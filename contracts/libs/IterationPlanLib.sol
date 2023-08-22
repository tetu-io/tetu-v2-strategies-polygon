// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "./AppErrors.sol";
import "./AppLib.sol";

/// @notice Support of withdraw iteration plans
library IterationPlanLib {

//region ------------------------------------------------ Constants
  /// @notice Swap collateral asset to get required amount-to-repay, then repay and get more collateral back.
  ///         It tries to minimizes count of repay-operations.
  ///         If there are no debts, swap leftovers to get required proportions of the asset.
  ///         This mode is intended i.e. for "withdraw all"
  ///         (uint256, uint256) - (entry kind, propNotUnderlying18)
  /// propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                     The assets should be swapped to get following result proportions:
  ///                     not-underlying : underlying === propNotUnderlying18 : (1e18 - propNotUnderlying18)
  ///                     Pass type(uint).max to read proportions from the pool.
  uint constant public PLAN_SWAP_REPAY = 0;

  /// @notice Repay available amount-to-repay, swap all or part of collateral to borrowed-asset, make one repay if needed.
  ///         Swap + second repay tries to make asset balances to proportions required by the pool.
  ///         Proportions are read from pool through IPoolProportionsProvider(this) and re-read after swapping.
  ///         This mode is intended i.e. for rebalancing debts using single iteration.
  ///         (uint256, uint256) - (entry kind, propNotUnderlying18)
  /// propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                     The assets should be swapped to get following result proportions:
  ///                     not-underlying : underlying === propNotUnderlying18 : (1e18 - propNotUnderlying18)
  ///                     Pass type(uint).max to read proportions from the pool.
  uint constant public PLAN_REPAY_SWAP_REPAY = 1;

  /// @notice Swap leftovers to required proportions, don't repay any debts
  ///         (uint256, uint256) - (entry kind, propNotUnderlying18)
  /// propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                     The assets should be swapped to get following result proportions:
  ///                     not-underlying : underlying === propNotUnderlying18 : (1e18 - propNotUnderlying18)
  ///                     Pass type(uint).max to read proportions from the pool.
  uint constant public PLAN_SWAP_ONLY = 2;
//endregion ------------------------------------------------ Constants

//region ------------------------------------------------ Data types
  /// @notice Set of parameters required to liquidation through aggregators
  struct SwapRepayPlanParams {
    ITetuConverter converter;
    ITetuLiquidator liquidator;

    /// @notice Assets used by depositor stored as following way: [underlying, not-underlying]
    address[] tokens;

    /// @notice Liquidation thresholds for the {tokens}
    uint[] liquidationThresholds;

    /// @notice Cost of $1 in terms of the assets, decimals 18
    uint[] prices;
    /// @notice 10**decimal for the assets
    uint[] decs;

    /// @notice Amounts that will be received on balance before execution of the plan.
    uint[] balanceAdditions;

    /// @notice Plan kind extracted from entry data, see {IterationPlanKinds}
    uint planKind;

    /// @notice Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
    ///         The leftovers should be swapped to get following result proportions of the assets:
    ///         not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
    uint propNotUnderlying18;

    /// @notice proportions should be taken from the pool and re-read from the pool after each swap
    bool usePoolProportions;
  }

  struct GetIterationPlanLocal {
    /// @notice Underlying balance
    uint assetBalance;
    /// @notice Not-underlying balance
    uint tokenBalance;

    uint totalDebt;
    uint totalCollateral;

    uint debtReverse;
    uint collateralReverse;

    address asset;
    address token;

    bool swapLeftoversNeeded;
  }

  struct EstimateSwapAmountForRepaySwapRepayLocal {
    uint x;
    uint y;
    uint bA1;
    uint bB1;
    uint alpha;
    uint swapRatio;
    uint aB3;
    uint cA1;
    uint cB1;
    uint aA2;
  }
//endregion ------------------------------------------------ Data types

  /// @notice Decode entryData, extract first uint - entry kind
  ///         Valid values of entry kinds are given by ENTRY_KIND_XXX constants above
  function getEntryKind(bytes memory entryData_) internal pure returns (uint) {
    if (entryData_.length == 0) {
      return PLAN_SWAP_REPAY;
    }
    return abi.decode(entryData_, (uint));
  }

//region ------------------------------------------------ Build plan
  /// @notice Build plan to make single iteration of withdraw according to the selected plan
  ///         The goal is to withdraw {requestedAmount} and receive {asset}:{token} in proper proportions on the balance
  /// @param converterLiquidator [TetuConverter, TetuLiquidator]
  /// @param tokens List of the pool tokens. One of them is underlying and one of then is not-underlying
  ///               that we are going to withdraw
  /// @param liquidationThresholds Liquidation thresholds for the {tokens}. If amount is less then the threshold,
  ///                              we cannot swap it.
  /// @param prices Prices of the {tokens}, decimals 18, [$/token]
  /// @param decs 10**decimal for each token of the {tokens}
  /// @param balanceAdditions Amounts that will be added to the current balances of the {tokens}
  ///                         to the moment of the plan execution
  /// @param packedData Several values packed to fixed-size array (to reduce number of params)
  ///    0: usePoolProportions: 1 - read proportions from the pool through IPoolProportionsProvider(this)
  ///    1: planKind: selected plan, one of PLAN_XXX
  ///    2: propNotUnderlying18: value of not-underlying proportion [0..1e18] if usePoolProportions == 0
  ///    3: requestedAmount: total amount that should be withdrawn, it can be type(uint).max
  ///    4: indexAsset: index of the underlying in {tokens} array
  ///    5: indexToken: index of the token in {tokens} array. We are going to withdraw the token and convert it to the asset
  function buildIterationPlan(
    address[2] memory converterLiquidator,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    uint[] memory prices,
    uint[] memory decs,
    uint[] memory balanceAdditions,
    uint[6] memory packedData
  ) external returns (
    uint indexToSwapPlus1,
    uint amountToSwap,
    uint indexToRepayPlus1
  ) {
    return _buildIterationPlan(
      SwapRepayPlanParams({
        converter: ITetuConverter(converterLiquidator[0]),
        liquidator: ITetuLiquidator(converterLiquidator[1]),
        tokens: tokens,
        liquidationThresholds: liquidationThresholds,
        prices: prices,
        decs: decs,
        balanceAdditions: balanceAdditions,
        planKind: packedData[1],
        propNotUnderlying18: packedData[2],
        usePoolProportions: packedData[0] != 0
      }),
      packedData[3],
      packedData[4],
      packedData[5]
    );
  }

  /// @notice Generate plan for next withdraw iteration. We can do only one swap per iteration.
  ///         In general, we cam make 1) single swap (direct or reverse) and 2) repay
  ///         Swap is required to get required repay-amount OR to swap leftovers on final iteration.
  /// @param requestedAmount Amount of underlying that we need to get on balance finally.
  /// @param indexAsset Index of the underlying in {p.tokens} array
  /// @param indexToken Index of the not-underlying in {p.tokens} array
  /// @return indexToSwapPlus1 1-based index of the token to be swapped; 0 means swap is not required.
  /// @return amountToSwap Amount to be swapped. 0 - no swap
  /// @return indexToRepayPlus1 1-based index of the token that should be used to repay borrow in converter.
  ///                            0 - no repay is required - it means that this is a last step with swapping leftovers.
  function _buildIterationPlan(
    SwapRepayPlanParams memory p,
    uint requestedAmount,
    uint indexAsset,
    uint indexToken
  ) internal returns (
    uint indexToSwapPlus1,
    uint amountToSwap,
    uint indexToRepayPlus1
  ) {
    GetIterationPlanLocal memory v;
    v.asset = p.tokens[indexAsset];
    v.token = p.tokens[indexToken];

    v.assetBalance = IERC20(v.asset).balanceOf(address(this)) + p.balanceAdditions[indexAsset];
    v.tokenBalance = IERC20(p.tokens[indexToken]).balanceOf(address(this)) + p.balanceAdditions[indexToken];

    if (p.planKind == IterationPlanLib.PLAN_SWAP_ONLY) {
      v.swapLeftoversNeeded = true;
    } else {
      if (requestedAmount < p.liquidationThresholds[indexAsset]) {
        // we don't need to repay any debts anymore, but we should swap leftovers
        v.swapLeftoversNeeded = true;
      } else {
        // we need to increase balance on the following amount: requestedAmount - v.balance;
        // we can have two possible borrows:
        // 1) direct (p.tokens[INDEX_ASSET] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[INDEX_ASSET])
        // normally we can have only one of them, not both..
        // but better to take into account possibility to have two debts simultaneously

        // reverse debt
        (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(address(this), v.token, v.asset, true);

        if (v.debtReverse < AppLib.DUST_AMOUNT_TOKENS) { // there is reverse debt or the reverse debt is dust debt
          // direct debt
          (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(address(this), v.asset, v.token, true);

          if (v.totalDebt < AppLib.DUST_AMOUNT_TOKENS) { // there is direct debt or the direct debt is dust debt
            // This is final iteration - we need to swap leftovers and get amounts on balance in proper proportions.
            // The leftovers should be swapped to get following result proportions of the assets:
            //      underlying : not-underlying === 1e18 - propNotUnderlying18 : propNotUnderlying18
            v.swapLeftoversNeeded = true;
          } else {
            // repay direct debt
            if (p.planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY) {
              (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanRepaySwapRepay(
                p,
                [v.assetBalance, v.tokenBalance],
                [indexAsset, indexToken],
                p.propNotUnderlying18,
                v.totalCollateral,
                v.totalDebt
              );
            } else {
              (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanForSellAndRepay(
                requestedAmount,
                p,
                v.totalCollateral,
                v.totalDebt,
                indexAsset,
                indexToken,
                v.assetBalance,
                v.tokenBalance
              );
            }
          }
        } else {
          // repay reverse debt
          if (p.planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY) {
            (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanRepaySwapRepay(
              p,
              [v.tokenBalance, v.assetBalance],
              [indexToken, indexAsset],
              1e18 - p.propNotUnderlying18,
              v.collateralReverse,
              v.debtReverse
            );
          } else {
            (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanForSellAndRepay(
              requestedAmount == type(uint).max
                ? type(uint).max
                : requestedAmount * p.prices[indexAsset] * p.decs[indexToken] / p.prices[indexToken] / p.decs[indexAsset],
              p,
              v.collateralReverse,
              v.debtReverse,
              indexToken,
              indexAsset,
              v.tokenBalance,
              v.assetBalance
            );
          }
        }
      }
    }

    if (v.swapLeftoversNeeded) {
      (indexToSwapPlus1, amountToSwap) = _buildPlanForLeftovers(p, v.assetBalance, v.tokenBalance, indexAsset, indexToken, p.propNotUnderlying18);
    }

    return (indexToSwapPlus1, amountToSwap, indexToRepayPlus1);
  }

  /// @notice Repay B, get collateral A, then swap A => B, [make one more repay B] => get A:B in required proportions
  /// @param balancesAB [balanceA, balanceB]
  /// @param idxAB [indexA, indexB]
  function _buildPlanRepaySwapRepay(
    SwapRepayPlanParams memory p,
    uint[2] memory balancesAB,
    uint[2] memory idxAB,
    uint propB,
    uint totalCollateralA,
    uint totalBorrowB
  ) internal returns (
    uint indexToSwapPlus1,
    uint amountToSwap,
    uint indexToRepayPlus1
  ) {
    // use all available tokenB to repay debt and receive as much as possible tokenA
    uint amountToRepay = Math.min(balancesAB[1], totalBorrowB);

    uint collateralAmount;
    if (amountToRepay >= AppLib.DUST_AMOUNT_TOKENS) {
      (collateralAmount,) = p.converter.quoteRepay(address(this), p.tokens[idxAB[0]], p.tokens[idxAB[1]], amountToRepay);
    } else {
      amountToRepay = 0;
    }

    // swap A to B: full or partial
    amountToSwap = estimateSwapAmountForRepaySwapRepay(
      p,
      balancesAB[0],
      balancesAB[1],
      idxAB[0],
      idxAB[1],
      propB,
      totalCollateralA,
      totalBorrowB,
      collateralAmount,
      amountToRepay
    );

    return (idxAB[0] + 1, amountToSwap, idxAB[1] + 1);
  }

  /// @notice Estimate swap amount for iteration "repay-swap-repay"
  ///         The iteration should give us amounts of assets in required proportions.
  ///         There are two cases here: full swap and partial swap. Second repay is not required if the swap is partial.
  /// @param collateralA Estimated value of collateral A received after repay balanceB
  /// @return amount of token A to be swapped
  function estimateSwapAmountForRepaySwapRepay(
    SwapRepayPlanParams memory p,
    uint balanceA,
    uint balanceB,
    uint indexA,
    uint indexB,
    uint propB,
    uint totalCollateralA,
    uint totalBorrowB,
    uint collateralA,
    uint amountToRepayB
  ) internal pure returns(uint) {
    // N - number of the state
    // bAN, bBN - balances of A and B; aAN, aBN - amounts of A and B; cAN, cBN - collateral/borrow amounts of A/B
    // alpha ~ cAN/cBN - estimated ratio of collateral/borrow
    // s = swap ratio, aA is swapped to aB, so aA = s * aB
    // g = split ratio, bA1 is divided on two parts: bA1 * gamma, bA1 * (1 - gamma). First part is swapped.
    // X = proportion of A, Y = proportion of B

    // Formulas
    // aB3 = (x * bB2 - y * bA2) / (alpha * y + x)
    // gamma = (y * bA1 - x * bB1) / (bA1 * (x * s + y))

    // There are following stages:
    // 0. init (we have at least not zero amount of B and not zero debt of B)
    // 1. repay 1 (repay all available amount of B OR all available debt)
    // 2. swap (swap A fully or partially to B)
    // 3. repay 2 (optional: we need this stage if full swap produces amount of B that is <= available debt)
    // 4. final (we have assets in right proportion on the balance)
    EstimateSwapAmountForRepaySwapRepayLocal memory v;
    v.x = 1e18 - propB;
    v.y = propB;

// 1. repay 1
    // convert amounts A, amounts B to cost A, cost B in USD
    v.bA1 = (balanceA + collateralA) * p.prices[indexA] / p.decs[indexA];
    v.bB1 = (balanceB - amountToRepayB) * p.prices[indexB] / p.decs[indexB];
    v.cB1 = (totalBorrowB - amountToRepayB) * p.prices[indexB] / p.decs[indexB];
    v.alpha = 1e18 * totalCollateralA * p.prices[indexA] * p.decs[indexB]
      / p.decs[indexA] / p.prices[indexB] / totalBorrowB; // (!) approx estimation

// 2. full swap
    v.aA2 = v.bA1;
    v.swapRatio = 1e18; // we assume swap ratio 1:1

// 3. repay 2
    // aB3 = (x * bB2 - Y * bA2) / (alpha * y + x)
    v.aB3 = (
      v.x * (v.bB1 + v.aA2 * v.swapRatio / 1e18)    // bB2 = v.bB1 + v.aA2 * v.s / 1e18
      - v.y * (v.bA1 - v.aA2)                       // bA2 = v.bA1 - v.aA2;
    ) / (v.y * v.alpha / 1e18 + v.x);

    if (v.aB3 > v.cB1) {
      // there is not enough debt to make second repay
      // we need to make partial swap and receive assets in right proportions in result
      // v.gamma = 1e18 * (v.y * v.bA1 - v.x * v.bB1) / (v.bA1 * (v.x * v.s / 1e18 + v.y));
      v.aA2 = v.bA1 * (v.y * v.bA1 - v.x * v.bB1) / (v.bA1 * (v.x * v.swapRatio / 1e18 + v.y));
    }

    return v.aA2 * p.decs[indexA] / p.prices[indexA];
  }

  /// @notice Prepare a plan to swap leftovers to required proportion
  /// @param balanceA Balance of token A, i.e. underlying
  /// @param balanceB Balance of token B, i.e. not-underlying
  /// @param indexA Index of the token A, i.e. underlying, in {p.prices} and {p.decs}
  /// @param indexB Index of the token B, i.e. not-underlying, in {p.prices} and {p.decs}
  /// @param propB Required proportion of TokenB [0..1e18]. Proportion of token A is (1e18-propB)
  /// @return indexTokenToSwapPlus1 Index of the token to be swapped. 0 - no swap is required
  /// @return amountToSwap Amount to be swapped. 0 - no swap is required
  function _buildPlanForLeftovers(
    SwapRepayPlanParams memory p,
    uint balanceA,
    uint balanceB,
    uint indexA,
    uint indexB,
    uint propB
  ) internal pure returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap
  ) {
    (uint targetA, uint targetB) = _getTargetAmounts(p.prices, p.decs, balanceA, balanceB, propB, indexA, indexB);
    if (balanceA < targetA) {
      // we need to swap not-underlying to underlying
      if (balanceB - targetB > p.liquidationThresholds[indexB]) {
        amountToSwap = balanceB - targetB;
        indexTokenToSwapPlus1 = indexB + 1;
      }
    } else {
      // we need to swap underlying to not-underlying
      if (balanceA - targetA > p.liquidationThresholds[indexA]) {
        amountToSwap = balanceA - targetA;
        indexTokenToSwapPlus1 = indexA + 1;
      }
    }
    return (indexTokenToSwapPlus1, amountToSwap);
  }

  /// @notice Prepare a plan to swap some amount of collateral to get required repay-amount and make repaying
  ///         1) Sell collateral-asset to get missed amount-to-repay 2) make repay and get more collateral back
  /// @param requestedAmount Amount of underlying that we need to get on balance finally.
  /// @param totalCollateral Total amount of collateral used in the borrow
  /// @param totalDebt Total amount of debt that should be repaid to receive {totalCollateral}
  /// @param indexCollateral Index of collateral asset in {p.prices}, {p.decs}
  /// @param indexBorrow Index of borrow asset in {p.prices}, {p.decs}
  /// @param balanceCollateral Current balance of the collateral asset
  /// @param balanceBorrow Current balance of the borrowed asset
  /// @param indexTokenToSwapPlus1 1-based index of the token to be swapped. Swap of amount of collateral asset can be required
  ///                              to receive missed amount-to-repay. 0 - no swap is required
  /// @param amountToSwap Amount to be swapped. 0 - no swap is required
  /// @param indexRepayTokenPlus1 1-based index of the token to be repaied. 0 - no repaying is required
  function _buildPlanForSellAndRepay(
    uint requestedAmount,
    SwapRepayPlanParams memory p,
    uint totalCollateral,
    uint totalDebt,
    uint indexCollateral,
    uint indexBorrow,
    uint balanceCollateral,
    uint balanceBorrow
  ) internal pure returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap,
    uint indexRepayTokenPlus1
  ) {
    // what amount of collateral we should sell to get required amount-to-pay to pay the debt
    uint toSell = _getAmountToSell(
      requestedAmount,
      totalDebt,
      totalCollateral,
      p.prices,
      p.decs,
      indexCollateral,
      indexBorrow,
      balanceBorrow
    );

    // convert {toSell} amount of underlying to token
    if (toSell != 0 && balanceCollateral != 0) {
      toSell = Math.min(toSell, balanceCollateral);
      uint threshold = p.liquidationThresholds[indexCollateral];
      if (toSell > threshold) {
        amountToSwap = toSell;
        indexTokenToSwapPlus1 = indexCollateral + 1;
      } else {
        // we need to sell amount less than the threshold, it's not allowed
        // but it's dangerous to just ignore the selling because there is a chance to have error 35
        // (There is a debt $3.29, we make repay $3.27 => error 35)
        // it would be safer to sell a bit more amount if it's possible
        if (balanceCollateral >= threshold + 1) {
          amountToSwap = threshold + 1;
          indexTokenToSwapPlus1 = indexCollateral + 1;
        }
      }
    }


    return (indexTokenToSwapPlus1, amountToSwap, indexBorrow + 1);
  }

  /// @notice Calculate what balances of underlying and not-underlying we need to fit {propNotUnderlying18}
  /// @param prices Prices of underlying and not underlying
  /// @param decs 10**decimals for underlying and not underlying
  /// @param assetBalance Current balance of underlying
  /// @param tokenBalance Current balance of not-underlying
  /// @param propNotUnderlying18 Required proportion of not-underlying [0..1e18]
  ///                            Proportion of underlying would be (1e18 - propNotUnderlying18)
  /// @param targetAssets What result balance of underlying is required to fit to required proportions
  /// @param targetTokens What result balance of not-underlying is required to fit to required proportions
  function _getTargetAmounts(
    uint[] memory prices,
    uint[] memory decs,
    uint assetBalance,
    uint tokenBalance,
    uint propNotUnderlying18,
    uint indexAsset,
    uint indexToken
  ) internal pure returns (
    uint targetAssets,
    uint targetTokens
  ) {
    uint costAssets = assetBalance * prices[indexAsset] / decs[indexAsset];
    uint costTokens = tokenBalance * prices[indexToken] / decs[indexToken];
    targetTokens = propNotUnderlying18 == 0
      ? 0
      : ((costAssets + costTokens) * propNotUnderlying18 / 1e18);
    targetAssets = ((costAssets + costTokens) - targetTokens) * decs[indexAsset] / prices[indexAsset];
    targetTokens = targetTokens * decs[indexToken] / prices[indexToken];
  }

  /// @notice What amount of collateral should be sold to pay the debt and receive {requestedAmount}
  /// @dev It doesn't allow to sell more than the amount of total debt in the borrow
  /// @param requestedAmount We need to increase balance (of collateral asset) on this amount
  /// @param totalDebt Total debt of the borrow in terms of borrow asset
  /// @param totalCollateral Total collateral of the borrow in terms of collateral asset
  /// @param prices Cost of $1 in terms of the asset, decimals 18
  /// @param decs 10**decimals for each asset
  /// @param indexCollateral Index of the collateral asset in {prices} and {decs}
  /// @param indexBorrowAsset Index of the borrow asset in {prices} and {decs}
  /// @param balanceBorrowAsset Available balance of the borrow asset, it will be used to cover the debt
  /// @return amountOut Amount of collateral-asset that should be sold
  function _getAmountToSell(
    uint requestedAmount,
    uint totalDebt,
    uint totalCollateral,
    uint[] memory prices,
    uint[] memory decs,
    uint indexCollateral,
    uint indexBorrowAsset,
    uint balanceBorrowAsset
  ) internal pure returns (
    uint amountOut
  ) {
    if (totalDebt != 0) {
      if (balanceBorrowAsset != 0) {
        // there is some borrow asset on balance
        // it will be used to cover the debt
        // let's reduce the size of totalDebt/Collateral to exclude balanceBorrowAsset
        uint sub = Math.min(balanceBorrowAsset, totalDebt);
        totalCollateral -= totalCollateral * sub / totalDebt;
        totalDebt -= sub;
      }

      // for definiteness: usdc - collateral asset, dai - borrow asset
      // Pc = price of the USDC, Pb = price of the DAI, alpha = Pc / Pb [DAI / USDC]
      // S [USDC] - amount to sell, R [DAI] = alpha * S - amount to repay
      // After repaying R we get: alpha * S * C / R
      // Balance should be increased on: requestedAmount = alpha * S * C / R - S
      // So, we should sell: S = requestedAmount / (alpha * C / R - 1))
      // We can lost some amount on liquidation of S => R, so we need to use some gap = {GAP_AMOUNT_TO_SELL}
      // Same formula: S * h = S + requestedAmount, where h = health factor => s = requestedAmount / (h - 1)
      // h = alpha * C / R
      uint alpha18 = prices[indexCollateral] * decs[indexBorrowAsset] * 1e18
        / prices[indexBorrowAsset] / decs[indexCollateral];

      // if totalCollateral is zero (liquidation happens) we will have zero amount (the debt shouldn't be paid)
      amountOut = totalDebt != 0 && alpha18 * totalCollateral / totalDebt > 1e18
        ? Math.min(requestedAmount, totalCollateral) * 1e18 / (alpha18 * totalCollateral / totalDebt - 1e18)
        : 0;

      if (amountOut != 0) {
        // we shouldn't try to sell amount greater than amount of totalDebt in terms of collateral asset
        // but we always asks +1% because liquidation results can be different a bit from expected
        amountOut = (AppLib.GAP_CONVERSION + AppLib.DENOMINATOR) * Math.min(amountOut, totalDebt * 1e18 / alpha18) / AppLib.DENOMINATOR;
      }
    }

    return amountOut;
  }
//endregion ------------------------------------------------ Build plan
}
