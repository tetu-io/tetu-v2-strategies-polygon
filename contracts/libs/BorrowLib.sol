// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../strategies/ConverterStrategyBaseLib.sol";
import "hardhat/console.sol";

/// @notice Library to make new borrow, extend/reduce exist borrows and repay to keep proper assets proportions
/// @dev Swap through liquidator is still allowed to be able to get required profitToCover, but this amount is small
library BorrowLib {
  /// @notice prop0 + prop1
  uint constant public SUM_PROPORTIONS = 1e18;

  //region -------------------------------------------------- Data types
  struct PricesDecs {
    /// @notice Asset prices in USD, decimals 18
    uint[] prices;
    /// @notice decs 10**decimals
    uint[] decs;
  }

  struct ConverterLiquidator {
    ITetuConverter converter;
    ITetuLiquidator liquidator;
  }

  struct RebalanceAssetsLocal {
    // ------- constant values
    address asset0;
    address asset1;
    /// @notice Proportion of {asset0}, > 0; proportion of {asset1} is SUM_PROPORTIONS - prop0
    uint prop0;
    /// @notice Min allowed amount of {asset0}-collateral, 0 - use default min value
    uint threshold0;
    /// @ntoice Min allowed amount of {asset1}-collateral, 0 - use default min value
    uint threshold1;

    PricesDecs pd;
    // ------- refreshable values

    // @notice Current balance of {asset0}
    uint amount0;
    // @notice Current balance of {asset1}
    uint amount1;

    /// @notice Borrowed amount of not-underlying
    uint directDebt;
    /// @notice Borrowed amount of underlying
    uint reverseDebt;

    uint addition0;
  }

  /// @notice Params required to borrow {assetB} under {assetA}
  struct RebalanceAssetsCore {
    ConverterLiquidator converterLiquidator;
    address assetA;
    address assetB;
    uint propA;
    uint propB;
    /// @notice {assetA} to {assetB} ratio; {amountB} * {alpha} => {amountA}, decimals 18
    uint alpha18;
    /// @notice Min allowed amount of {assetA}-collateral, 0 - use default min value
    uint thresholdA;

    uint addonA;
    uint addonB;

    /// @notice Index of {assetA} in {prices} and {decs}
    uint indexA;
    /// @notice Index of {assetB} in {prices} and {decs}
    uint indexB;
  }

  struct OpenPosition2Local {
    uint collateral;
    uint toBorrow;
    uint cc;
    uint cb;
    uint c0;
    uint cb2;
    uint ca0;
    uint gamma18;
    uint pa2;
    uint pb2;
    bytes entryData;
    uint alpha18;
  }
  //endregion -------------------------------------------------- Data types

  //region -------------------------------------------------- External functions
  /// @notice Set balances of {asset0} and {asset1} in proportions {prop0}:{prop1} using borrow/repay (no swaps)
  /// @param prop0 Proportion of {asset0}, > 0. Proportion of {asset1} is calculates as 1e18 - prop0
  /// @param threshold0 Min allowed amount of {asset0}-collateral, 0 - use default min value
  /// @param threshold1 Min allowed amount of {asset1}-collateral, 0 - use default min value
  /// @param addition0 Additional amount A0 of {asset0}.
  ///                  Balance0 = A0 + B0
  ///                  We need following balances in results: B0 : Balance1 === {proportion}:{100_000-proportion}
  function rebalanceAssets(
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    address asset0,
    address asset1,
    uint prop0,
    uint threshold0,
    uint threshold1,
    uint addition0
  ) external {
    console.log("rebalanceAssets");
    console.log("asset0", asset0);
    console.log("asset1", asset1);
    console.log("prop0", prop0);
    console.log("threshold0", threshold0);
    console.log("threshold1", threshold1);
    console.log("addition0", addition0);

    // pool always have TWO assets, it's not allowed ot have only one asset
    // so, we assume that the proportions are in the range (0...1e18)
    require(prop0 != 0, AppErrors.ZERO_VALUE);
    require(prop0 < 1e18, AppErrors.TOO_HIGH);

    RebalanceAssetsLocal memory v;
    v.asset0 = asset0;
    v.asset1 = asset1;
    v.prop0 = prop0;
    v.threshold0 = threshold0;
    v.threshold1 = threshold1;
    v.addition0 = addition0;

    IPriceOracle priceOracle = AppLib._getPriceOracle(converter_);
    address[] memory tokens = new address[](2);
    tokens[0] = asset0;
    tokens[1] = asset1;
    (v.pd.prices, v.pd.decs) = AppLib._getPricesAndDecs(priceOracle, tokens, 2);

    console.log("v.pd.prices", v.pd.prices[0], v.pd.prices[1]);

    _refreshRebalance(v, ConverterLiquidator(converter_, liquidator_), true);
  }
  //endregion -------------------------------------------------- External functions

  //region -------------------------------------------------- Internal helper functions

  /// @notice refresh state in {v} and call _rebalanceAssets()
  function _refreshRebalance(
    RebalanceAssetsLocal memory v,
    ConverterLiquidator memory converterLiquidator,
    bool repayAllowed
  ) internal {
    v.amount0 = IERC20(v.asset0).balanceOf(address(this));
    v.amount1 = IERC20(v.asset1).balanceOf(address(this));

    (v.directDebt, ) = converterLiquidator.converter.getDebtAmountCurrent(address(this), v.asset0, v.asset1, true);
    (v.reverseDebt, ) = converterLiquidator.converter.getDebtAmountCurrent(address(this), v.asset1, v.asset0, true);
    console.log("_refreshRebalance.v.directDebt", v.directDebt);
    console.log("_refreshRebalance.v.reverseDebt", v.reverseDebt);

    _rebalanceAssets(v, converterLiquidator, repayAllowed);
  }

  /// @param repayAllowed Protection against recursion
  ///                     Assets can be rebalanced in two ways:
  ///                     1) openPosition
  ///                     2) repay + openPosition
  ///                     Only one repay is allowed.
  function _rebalanceAssets(
    RebalanceAssetsLocal memory v,
    ConverterLiquidator memory converterLiquidator,
    bool repayAllowed
  ) internal {
    uint cost0 = v.amount0 * v.pd.prices[0] / v.pd.decs[0];
    uint cost1 = v.amount1 * v.pd.prices[1] / v.pd.decs[1];
    uint costAddition0 = v.addition0 * v.pd.prices[0] / v.pd.decs[0];

    uint totalCost = cost0 + cost1 - costAddition0;
    uint requiredCost0 = totalCost * v.prop0 / SUM_PROPORTIONS + costAddition0;
    uint requiredCost1 = totalCost * (SUM_PROPORTIONS - v.prop0) / SUM_PROPORTIONS;
    console.log("_rebalanceAssets.cost0", cost0);
    console.log("_rebalanceAssets.cost1", cost1);
    console.log("_rebalanceAssets.costAddition0", costAddition0);
    console.log("_rebalanceAssets.totalCost", totalCost);
    console.log("_rebalanceAssets.requiredCost0", requiredCost0);
    console.log("_rebalanceAssets.requiredCost1", requiredCost1);

    if (requiredCost0 > cost0) {
      // we need to increase amount of asset 0 and decrease amount of asset 1, so we need to borrow asset 0 (reverse)
      RebalanceAssetsCore memory c10 = RebalanceAssetsCore({
        converterLiquidator: converterLiquidator,
        assetA: v.asset1,
        assetB: v.asset0,
        propA: SUM_PROPORTIONS - v.prop0,
        propB: v.prop0,
        alpha18: 1e18 * v.pd.prices[0] * v.pd.decs[1] / v.pd.prices[1] / v.pd.decs[0],
        thresholdA: v.threshold1,
        addonA: 0,
        addonB: v.addition0,
        indexA: 1,
        indexB: 0
      });

      if (v.directDebt != 0) {
        // This branch of code cannot be called recursively.
        // Firstly repay(requiredAmount0) is called below. There are two possible results:
        // 1) requiredCost0 <= cost0
        // 2) v.directDebt == 0
        // so, this code cannot be called second time
        require(repayAllowed, AppErrors.NOT_ALLOWED);

        // repay of v.asset1 is required
        uint requiredAmount0 = (requiredCost0 - cost0) * v.pd.decs[0] / v.pd.prices[0];
        rebalanceRepayBorrow(v, c10, requiredAmount0, v.directDebt);
      } else {
        // new (or additional) borrow of asset 0 under asset 1 is required
        openPosition(c10, v.pd, v.amount1, v.amount0);
      }
    } else if (requiredCost0 < cost0) {
      RebalanceAssetsCore memory c01 = RebalanceAssetsCore({
        converterLiquidator: converterLiquidator,
        assetA: v.asset0,
        assetB: v.asset1,
        propA: v.prop0,
        propB: SUM_PROPORTIONS - v.prop0,
        alpha18: 1e18 * v.pd.prices[1] * v.pd.decs[0] / v.pd.prices[0] / v.pd.decs[1],
        thresholdA: v.threshold0,
        addonA: v.addition0,
        addonB: 0,
        indexA: 0,
        indexB: 1
      });
      // we need to decrease amount of asset 0 and increase amount of asset 1, so we need to borrow asset 1 (direct)
      if (v.reverseDebt != 0) {
        require(repayAllowed, AppErrors.NOT_ALLOWED);

        // repay of v.asset0 is required
        // requiredCost0 < cost0 => requiredCost1 > cost1
        uint requiredAmount1 = (requiredCost1 - cost1) * v.pd.decs[1] / v.pd.prices[1];
        rebalanceRepayBorrow(v, c01, requiredAmount1, v.reverseDebt);
      } else {
        // new or additional borrow of asset 1 under asset 0 is required
        openPosition(c01, v.pd, v.amount0, v.amount1);
      }
    }
  }

  /// @notice Repay {amountDebtA} fully or partially to get at least {requiredAmountB} of collateral
  ///         then try to rebalance once more
  /// @param requiredAmountB Amount of collateral that we need to receive after repay
  /// @param amountDebtA Total amount that is required to pay to close the debt
  function rebalanceRepayBorrow(
    RebalanceAssetsLocal memory v,
    RebalanceAssetsCore memory c,
    uint requiredAmountB,
    uint amountDebtA
  ) internal {
    console.log("rebalanceRepayBorrow");
    // we need to get {requiredAmountB}
    // we don't know exact amount to repay
    // but we are sure that amount {requiredAmountB ===> requiredAmountA} would be more than required
    uint capRequiredAmountA = requiredAmountB * c.alpha18 / 1e18;
    console.log("capRequiredAmountA", capRequiredAmountA);
    console.log("amountDebtA", amountDebtA);
    ConverterStrategyBaseLib._repayDebt(c.converterLiquidator.converter, c.assetB, c.assetA, Math.min(capRequiredAmountA, amountDebtA));

    _refreshRebalance(v, c.converterLiquidator, false);
  }

  //endregion -------------------------------------------------- Internal helper functions

  //region -------------------------------------------------- Open position
  /// @notice borrow asset B under asset A. Result balances should be A0 + A1, B0 + B1
  ///         Where (A1 : B1) == (propA : propB), A0 and B0 are equal to {c.addonA} and {c.addonB}
  /// @param balanceA_ Current balance of the collateral
  /// @param balanceB_ Current balance of the borrow asset
  function openPosition(
    RebalanceAssetsCore memory c,
    PricesDecs memory pd,
    uint balanceA_,
    uint balanceB_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    // if there are two not-zero addons, the caller should reduce balances before the call
    require(c.addonA == 0 || c.addonB == 0, AppErrors.INVALID_VALUE);

    // we are going to borrow B under A
    if (c.addonB != 0) {
      // B is underlying, so we are going to borrow underlying
      if (balanceB_ >= c.addonB) {
        // simple case - we already have required addon on the balance. Just keep it unused
        return _openPosition(c, balanceA_, balanceB_ - c.addonB);
      } else {
        // we need to get 1) (c.addonB + balanceB_) amount, so we will have required c.addonB
        //                2) leftovers of A and B should be allocated in required proportions
        // it's too hard to calculate correctly required to borrow amount in this case without changing TetuConverter
        // but we can assume here, that amount (c.addonB - balanceB_) is pretty small (it's profitToCover)
        // so, we can swap this required amount through liquidator at first
        // then use _openPosition to re-allocated rest amounts to proper proportions
        (uint decA,) = _makeLittleSwap(c, pd, balanceA_, c.addonB - balanceB_);
        return _openPosition(c, balanceA_ - decA, balanceB_);
      }
    } else if (c.addonA != 0) {
      // A is underlying, we need to put aside c.addonA and allocate leftovers in right proportions.
      // we are going to borrow B under asset A, so the case (balanceA_ < c.addonA) is not valid here
      require(balanceA_ >= c.addonA, AppErrors.NOT_ENOUGH_BALANCE);
      return _openPosition(c, balanceA_ - c.addonA, balanceB_);
    } else {
      // simple logic, no addons
      return _openPosition(c, balanceA_, balanceB_);
    }
  }

  /// @notice borrow asset B under asset A, result balances should have proportions: (propA : propB)
  function _openPosition(RebalanceAssetsCore memory c, uint balanceA_, uint balanceB_) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    uint untouchedAmountA;
    bytes memory entryData = abi.encode(1, c.propA, c.propB);

    if (balanceB_ != 0) {
      // we are going to use {balanceA_} as collateral
      // but there is some amount on {balanceB_}, so we need to keep corresponded part of {balanceA_} untouched
      untouchedAmountA = balanceB_ * c.alpha18 * c.propA / c.propB / 1e18;

      // we are going to borrow B under A, so balance A must be greater then balance B
      // otherwise the function is called incorrectly - probably we need to borrow A under B
      require(untouchedAmountA <= balanceA_, AppErrors.WRONG_VALUE);
    }

    AppLib.approveIfNeeded(c.assetA, balanceA_ - untouchedAmountA, address(c.converterLiquidator.converter));

    return ConverterStrategyBaseLib.openPosition(
      c.converterLiquidator.converter,
      entryData,
      c.assetA,
      c.assetB,
      balanceA_ - untouchedAmountA,
      c.thresholdA
    );
  }

  //endregion -------------------------------------------------- Open position

  //region -------------------------------------------------- Little swap
  /// @notice Swap min amount of A to get {requiredAmountB}
  /// @return spentAmountIn how much the balance A has decreased
  /// @return receivedAmountOut how much the balance B has increased
  function _makeLittleSwap(
    RebalanceAssetsCore memory c,
    PricesDecs memory pd,
    uint balanceA_,
    uint requiredAmountB
  ) internal returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    uint amountInA = requiredAmountB * pd.prices[c.indexB] * pd.decs[c.indexA] / pd.prices[c.indexA] / pd.decs[c.indexB];
    // we can have some loss because of slippage
    // so, let's increase input amount a bit
    amountInA = amountInA * (100_000 + ConverterStrategyBaseLib._ASSET_LIQUIDATION_SLIPPAGE) / 100_000;

    // in practice the addition is required to pay ProfitToCover
    // we assume, that total addition amount is small enough, much smaller then the total balance
    // otherwise something is wrong: we are going to pay ProfitToCover, but we don't have enough amount on the balances.
    require(balanceA_ > amountInA, AppErrors.NOT_ENOUGH_BALANCE);

    (spentAmountIn, receivedAmountOut) = ConverterStrategyBaseLib.liquidate(
      c.converterLiquidator.converter,
      c.converterLiquidator.liquidator,
      c.assetA,
      c.assetB,
      amountInA,
      ConverterStrategyBaseLib._ASSET_LIQUIDATION_SLIPPAGE,
      c.thresholdA,
      false
    );
  }

  //endregion -------------------------------------------------- Little swap

}