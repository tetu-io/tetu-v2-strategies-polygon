// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../strategies/ConverterStrategyBaseLib.sol";

/// @notice Library to make new borrow, extend/reduce exist borrows and repay to keep proper assets proportions
library BorrowLib {
  /// @notice prop0 + prop1
  uint constant public SUM_PROPORTIONS = 1e18;

  //region -------------------------------------------------- Data types
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

    /// @notice Asset prices in USD, decimals 18
    uint[] prices;
    /// @notice decs 10**decimals
    uint[] decs;

    // ------- refreshable values

    // @notice Current balance of {asset0}
    uint amount0;
    // @notice Current balance of {asset1}
    uint amount1;

    /// @notice Borrowed amount of not-underlying
    uint directDebt;
    /// @notice Amount of underlying locked as collateral
    uint directCollateral;
    /// @notice Borrowed amount of underlying
    uint reverseDebt;
    /// @notice Amount of not-underlying locked as collateral
    uint reverseCollateral;
  }

  /// @notice Params required to borrow {assetB} under {assetA}
  struct RebalanceAssetsCore {
    ITetuConverter converter;
    address assetA;
    address assetB;
    uint propA;
    uint propB;
    /// @notice {assetA} to {assetB} ratio; {amountB} * {alpha} => {amountA}, decimals 18
    uint alpha18;
    /// @notice Min allowed amount of {assetA}-collateral, 0 - use default min value
    uint thresholdA;
  }
  //endregion -------------------------------------------------- Data types


  //region -------------------------------------------------- External functions
  /// @notice Set balances of {asset0} and {asset1} in proportions {prop0}:{prop1} using borrow/repay (no swaps)
  /// @param prop0 Proportion of {asset0}, > 0. Proportion of {asset1} is calculates as 1e18 - prop0
  /// @param threshold0 Min allowed amount of {asset0}-collateral, 0 - use default min value
  /// @param threshold1 Min allowed amount of {asset1}-collateral, 0 - use default min value
  function rebalanceAssets(
    ITetuConverter converter_,
    address asset0,
    address asset1,
    uint prop0,
    uint threshold0,
    uint threshold1
  ) external {
    require(prop0 > 0, AppErrors.ZERO_VALUE);

    RebalanceAssetsLocal memory v;
    v.asset0 = asset0;
    v.asset1 = asset1;
    v.prop0 = prop0;
    v.threshold0 = threshold0;
    v.threshold1 = threshold1;

    IPriceOracle priceOracle = IPriceOracle(IConverterController(converter_.controller()).priceOracle());
    address[] memory tokens = new address[](2);
    tokens[0] = asset0;
    tokens[1] = asset1;
    (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(priceOracle, tokens, 2);

    _refreshRebalance(v, converter_, true);
  }
  //endregion -------------------------------------------------- External functions

  //region -------------------------------------------------- Internal helper functions

  /// @notice refresh state in {v} and call _rebalanceAssets()
  function _refreshRebalance(RebalanceAssetsLocal memory v, ITetuConverter tetuConverter_, bool repayAllowed) internal {
    v.amount0 = IERC20(v.asset0).balanceOf(address(this));
    v.amount1 = IERC20(v.asset1).balanceOf(address(this));

    (v.directDebt, v.directCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), v.asset0, v.asset1, true);
    (v.reverseDebt, v.reverseCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), v.asset1, v.asset0, true);

    _rebalanceAssets(v, tetuConverter_, true);
  }

  /// @param repayAllowed Protection against recursion
  function _rebalanceAssets(RebalanceAssetsLocal memory v, ITetuConverter converter_, bool repayAllowed) internal {
    uint cost0 = v.amount0 * v.prices[0] / v.decs[0];
    uint cost1 = v.amount1 * v.prices[1] / v.decs[1];

    uint requiredCost0 = (cost0 + cost1) * v.prop0 / SUM_PROPORTIONS;
    uint requiredCost1 = (cost0 + cost1) * (SUM_PROPORTIONS - v.prop0) / SUM_PROPORTIONS;

    if (requiredCost0 > cost0) {
      // we need to increase amount of asset 0 and decrease amount of asset 1, so we need to borrow asset 0 (reverse)
      RebalanceAssetsCore memory c10 = RebalanceAssetsCore({
        converter: converter_,
        assetA: v.asset1,
        assetB: v.asset0,
        propA: SUM_PROPORTIONS - v.prop0,
        propB: v.prop0,
        alpha18: 1e18 * v.prices[0] * v.decs[1] / v.prices[1] / v.decs[0],
        thresholdA: v.threshold1
      });

      if (v.directDebt > 0) {
        require(repayAllowed, AppErrors.NOT_ALLOWED);
        // repay of v.asset1 is required
        uint requiredAmount0 = (requiredCost0 - cost0) * v.decs[0] / v.prices[0];
        rebalanceRepayBorrow(v, c10, requiredAmount0, v.directDebt, v.directCollateral);
      } else {
        // new (or additional) borrow of asset 0 under asset 1 is required
        openPosition(c10, v.amount1, v.amount0);
      }
    } else if (requiredCost0 < cost0) {
      RebalanceAssetsCore memory c01 = RebalanceAssetsCore({
        converter: converter_,
        assetA: v.asset0,
        assetB: v.asset1,
        propA: v.prop0,
        propB: SUM_PROPORTIONS - v.prop0,
        alpha18: 1e18 * v.prices[1] * v.decs[0] / v.prices[0] / v.decs[1],
        thresholdA: v.threshold0
      });
      // we need to decrease amount of asset 0 and increase amount of asset 1, so we need to borrow asset 1 (direct)
      if (v.reverseDebt > 0) {
        require(repayAllowed, AppErrors.NOT_ALLOWED);
        // repay of v.asset0 is required
        // requiredCost0 < cost0 => requiredCost1 > cost1
        uint requiredAmount1 = (requiredCost1 - cost1) * v.decs[1] / v.prices[1];
        rebalanceRepayBorrow(v, c01, requiredAmount1, v.reverseDebt, v.reverseCollateral);
      } else {
        // new or additional borrow of asset 1 under asset 0 is required
        openPosition(c01, v.amount0, v.amount1);
      }
    }
  }

  /// @notice borrow asset B under asset A, result balances should have proportions: (propA : propB)
  function openPosition(RebalanceAssetsCore memory c, uint balanceA_, uint balanceB_) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    uint untouchedAmountA;
    bytes memory entryData = abi.encode(1, c.propA, c.propB);

    if (balanceB_ != 0) {
      // we are going to use {balanceA_} as collateral
      // but there is some amount on {balanceB_}, so we need to keep corresponded part of {balanceA_} untouched
      untouchedAmountA = balanceB_ * c.alpha18 * c.propA / c.propB / 1e18;
      require(untouchedAmountA <= balanceA_, AppErrors.WRONG_VALUE);
    }

    AppLib.approveIfNeeded(c.assetA, balanceA_ - untouchedAmountA, address(c.converter));
    return ConverterStrategyBaseLib.openPosition(
      c.converter,
      entryData,
      c.assetA,
      c.assetB,
      balanceA_ - untouchedAmountA,
      c.thresholdA
    );
  }

  /// @notice Repay {amountDebtA} fully or partially to get at least {requiredAmountB} of collateral
  ///         then try to rebalance once more
  /// @param requiredAmountB Amount of collateral that we need to receive after repay
  /// @param amountDebtA Total amount that is required to pay to close the debt
  /// @param amountCollateralB Total locked collateral
  function rebalanceRepayBorrow(
    RebalanceAssetsLocal memory v,
    RebalanceAssetsCore memory c,
    uint requiredAmountB,
    uint amountDebtA,
    uint amountCollateralB
  ) internal {
    // we need to get {requiredAmount0}
    // we don't know exact amount to repay
    // but we are sure that amount {requiredAmount0 ===> requiredAmount1} would be more than required
    uint capRequiredAmountA = requiredAmountB * c.alpha18 / 1e18;
    ConverterStrategyBaseLib._repayDebt(c.converter, c.assetB, c.assetA, Math.min(capRequiredAmountA, amountDebtA));

    _refreshRebalance(v, c.converter, false);
  }

  //endregion -------------------------------------------------- Internal helper functions
}