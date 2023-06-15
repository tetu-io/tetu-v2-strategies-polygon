// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../strategies/ConverterStrategyBaseLib.sol";
import "hardhat/console.sol";
import "../integrations/tetu-v1/ITetuV1Controller.sol";

/// @notice Library to make new borrow, extend/reduce exist borrows and repay to keep proper assets proportions
library BorrowLib {

  struct RebalanceAssetsLocal {
    address asset0;
    address asset1;
    uint amount0;
    uint amount1;
    uint proportion;
    uint addition0;

    uint[] prices;
    uint[] decs;
    uint directDebt;
    uint directCollateral;
    uint reverseDebt;
    uint reverseCollateral;
  }

  struct RebalanceAssetsCore {
    ITetuConverter converter;
    address assetA;
    address assetB;
    uint propA;
    uint propB;
    /// @notice Asset 0 to asset 1 ratio; amount0 * a02a1r => amount1
    uint alpha;
    uint addonA;
    uint addonB;
  }

  /// @notice Set balances of {asset0} and {asset1} in proportions {proportion}:{100_000-proportion} using borrow/repay
  /// @param proportion Proportion for {asset0}, [0...100_000]
  /// @param addition0 Additional amount A0 of {asset0}.
  ///                  Balance0 = A0 + B0, and B0 : Balance1 === {proportion}:{100_000-proportion}
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    address asset0,
    address asset1,
    uint proportion,
    uint addition0
  ) external {
    console.log("rebalanceAssets.asset0", asset0);
    console.log("rebalanceAssets.asset1", asset1);
    console.log("rebalanceAssets.proportion", proportion);

    RebalanceAssetsLocal memory v;
    v.asset0 = asset0;
    v.asset1 = asset1;
    v.proportion = proportion;
    v.addition0 = addition0;

    IPriceOracle priceOracle = IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle());
    address[] memory tokens = new address[](2);
    tokens[0] = asset0;
    tokens[1] = asset1;
    (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(priceOracle, tokens, 2);
    console.log("rebalanceAssets.prices0", v.prices[0]);
    console.log("rebalanceAssets.prices1", v.prices[1]);
    console.log("rebalanceAssets.decs0", v.decs[0]);
    console.log("rebalanceAssets.decs1", v.decs[1]);

    v.amount0 = IERC20(asset0).balanceOf(address(this));
    v.amount1 = IERC20(asset1).balanceOf(address(this));
    console.log("rebalanceAssets.amount0", v.amount0);
    console.log("rebalanceAssets.amount1", v.amount1);

    (v.directDebt, v.directCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), asset0, asset1, true);
    console.log("rebalanceAssets.directDebt", v.directDebt);
    console.log("rebalanceAssets.directCollateral", v.directCollateral);

    (v.reverseDebt, v.reverseCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), asset1, asset0, true);
    console.log("rebalanceAssets.reverseDebt", v.reverseDebt);
    console.log("rebalanceAssets.reverseCollateral", v.reverseCollateral);

    _rebalanceAssets(v, tetuConverter_, true);
  }

  /// @param repayAllowed Protection against recursion
  function _rebalanceAssets(RebalanceAssetsLocal memory v, ITetuConverter tetuConverter_, bool repayAllowed) internal {
    uint cost0 = v.amount0 * v.prices[0] / v.decs[0];
    uint cost1 = v.amount1 * v.prices[1] / v.decs[1];
    uint costAddition0 = v.addition0 * v.prices[0] / v.decs[0];

    uint totalCost = cost0 + cost1 - costAddition0; // todo check -
    uint requiredCost0 = totalCost * v.proportion / 100_000 + costAddition0;
    uint requiredCost1 = totalCost * (100_000 - v.proportion) / 100_000;

    console.log("rebalanceAssets.cost0", cost0);
    console.log("rebalanceAssets.requiredCost0", requiredCost0);
    console.log("rebalanceAssets.cost1", cost1);
    console.log("rebalanceAssets.requiredCost1", requiredCost1);

    if (requiredCost0 > cost0) {
      console.log("rebalanceAssets.1");
      // we need to increase amount of asset 0 and decrease amount of asset 1, so we need to borrow asset 0 (reverse)
      RebalanceAssetsCore memory c10 = RebalanceAssetsCore({
        converter: tetuConverter_,
        assetA: v.asset1,
        assetB: v.asset0,
        propA: 100_000 - v.proportion,
        propB: v.proportion,
        alpha: 1e18 * v.prices[0] * v.decs[1] / v.prices[1] / v.decs[0],
        addonA: 0,
        addonB: v.addition0
      });
      console.log("rebalanceAssets.1.a02a1r", c10.alpha);

      if (v.directDebt > 0) {
        require(repayAllowed, AppErrors.NOT_ALLOWED);
        console.log("rebalanceAssets.2");
        // repay of v.asset1 is required
        uint requiredAmount0 = (requiredCost0 - cost0) * v.decs[0] / v.prices[0];
        rebalanceRepayBorrow(v, c10, requiredAmount0, v.directDebt, v.directCollateral);
      } else if (v.reverseDebt > 0) {
        console.log("rebalanceAssets.3");
        // additional borrow of asset 0 is required
        openPosition(c10, v.amount1, v.amount0);
      } else {
        console.log("rebalanceAssets.4");
        // we need to borrow asset 0 under asset 1
        openPosition(c10, v.amount1, v.amount0);
      }
    } else if (requiredCost0 < cost0) {
      console.log("rebalanceAssets.5");
      RebalanceAssetsCore memory c01 = RebalanceAssetsCore({
        converter: tetuConverter_,
        assetA: v.asset0,
        assetB: v.asset1,
        propA: v.proportion,
        propB: 100_000 - v.proportion,
        alpha: 1e18 * v.prices[1] * v.decs[0] / v.prices[0] / v.decs[1],
        addonA: v.addition0,
        addonB: 0
      });
      console.log("rebalanceAssets.5.a02a1r", c01.alpha);
      // we need to decrease amount of asset 0 and increase amount of asset 1, so we need to borrow asset 1 (direct)
      if (v.directDebt > 0) {
        console.log("rebalanceAssets.6");
        // additional borrow of asset 1 is required
        openPosition(c01, v.amount0, v.amount1);
      } else if (v.reverseDebt > 0) {
        require(repayAllowed, AppErrors.NOT_ALLOWED);
        console.log("rebalanceAssets.7");
        // repay of v.asset0 is required
        uint requiredAmount1 = (requiredCost1 - cost1) * v.decs[1] / v.prices[1];
        rebalanceRepayBorrow(v, c01, requiredAmount1, v.reverseDebt, v.reverseCollateral);
      } else {
        console.log("rebalanceAssets.8");
        // we need to borrow asset 1 under asset 0
        openPosition(c01, v.amount0, v.amount1);
      }
    }
  }

  /// @notice borrow asset B under asset A. Result balances should be A0 + A1, B0 + B1
  ///         Where (A1 : B1) == (propA : propB), A0 and B0 are equal to {c.addonA} and {c.addonB}
  /// @param balanceA_ Current balance of the collateral
  /// @param balanceB_ Current balance of the borrow asset
  function openPosition(
    RebalanceAssetsCore memory c,
    uint balanceA_,
    uint balanceB_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    require(c.addonA == 0 || c.addonB == 0, AppErrors.INVALID_VALUES);
    console.log("openPosition.balance0_", balanceA_);
    console.log("openPosition.balance1_", balanceB_);

    // we are going to borrow B under A
    if (c.addonB != 0) {
      // B is underlying, so we are going to borrow underlying
      if (balanceB_ >= c.addonB) {
        // simple case - we already have required addon on the balance. Just keep it unused
        return _openPosition(c, balanceA_, balanceB_ - c.addonB);
      } else {
        return _openPosition2(c, balanceA_, c.addonB - balanceB_);
      }
    } else if (c.addonA != 0) {
      // A is underlying, we need to keep c.addonA unused
      require(balanceA_ >= c.addonA, AppErrors.WRONG_BALANCE);
      return _openPosition(c, balanceA_ - c.addonA, balanceB_);
    } else {
      // simple logic, no addons
      return _openPosition(c, balanceA_, balanceB_);
    }
  }

  /// @notice Borrow asset B under asset A in proportions (propA : propB)
  /// @param balanceA_ Current balance of the collateral
  /// @param balanceB_ Current balance of the borrow asset
  function _openPosition(
    RebalanceAssetsCore memory c,
    uint balanceA_,
    uint balanceB_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    uint untouchedAmountA;
    uint thresholdAmountIn_ = 0; // todo

    bytes memory entryData = abi.encode(1, c.propA, c.propB);

    console.log("openPosition.entryData.c.prop0", c.propA);
    console.log("openPosition.entryData.c.prop1", c.propB);
    console.log("openPosition.entryData.c.a02a1r", c.alpha);

    if (balanceB_ != 0) {
      // we are going to use {balanceA_} as collateral
      // but there is some amount on {balanceB_}, so we need to keep corresponded part of {balanceA_} untouched
      untouchedAmountA = balanceB_ * c.alpha / 1e18;
      console.log("openPosition.c.a02a1r", c.alpha);
      console.log("openPosition.untouchedAmountA", untouchedAmountA);
      require(untouchedAmountA < balanceA_, AppErrors.WRONG_VALUE);
    }

    return ConverterStrategyBaseLib.openPosition(
      c.converter,
      entryData,
      c.assetA,
      c.assetB,
      balanceA_ - untouchedAmountA,
      thresholdAmountIn_
    );
  }

  /// @notice Borrow underlying B under asset A using entryKind1 + approx estimation.
  ///         Result balances: A1 and B1, where B1 = addonB_ + B2 and (A1 : B2) == (propA : propB)
  /// @dev We assume here that balanceB is zero and {addonB_} > 0 here, see openPosition implementation
  /// @param balanceA_ Current balance of the collateral
  /// @param addonB_ Amount of underlying that should be kept on balance outside of the proportions
  function _openPosition2(
    RebalanceAssetsCore memory c,
    uint balanceA_,
    uint addonB_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    // Recalculate A and B to base currency C
    // So, we have initially:
    //    Total amount of collateral A => C0
    //    Amount of A that should be kept on balance => Ca0
    //    Amount of A that should be used as collateral => Ca1
    //    Amount to borrow B => Cb0
    //    Balance equation: C0 = Ca0 + Ca1 = Ca0 + Cb0 * alpha
    //    alpha is collateral factor: we need to use collateral = Cb0 * alpha to borrow Cb0
    //    We have required proportions: Pa / Pb = Ca0 / Cb0
    // But now we should get additional amount of B = addonB_ => Cb2 to balance, so balance equation becomes different:
    //    Balance equation: C0 = Ca0 + (Cb1 + Cb2) * alpha,  Pa / Pb = Ca0 / Cb1
    // => Ca0 = (C0 - alpha * Cb2) / (1 + alpha * Pb / Pa)
    // We don't know exact value of alpha, we can only estimate it using tetuConverter
    // To make real borrow we need to use entryKind1 but with different values of proportions Pa' : Pb'
    // => Pa' / Pb' = Ca0 / (Cb1 + Cb2)
    // but Cb1 = Ca0 * Pb / Pa
    //    so Pa' / Pb' = Ca0 / (Ca0 * Pb/Pa + Cb2)
    // let gamma = Ca0 / (Ca0 * Pb/Pa + Cb2), so Pa' / Pb' = gamma
    // We assume that Pa' + Pb' == Pa + Pb, so
    //    Pa' / (Pa + Pb - Pa') = gamma
    // => Pa' = gamma * (Pa + Pb) / (1 + gamma)
    // if Cb2 = 0 we have gamma = Pa / Pb so
    // => Pa' = gamma * (Pa + Pb) / (1 + gamma) = Pa, correct

    // The algo:
    // 1) estimate alpha, calculate Ca0
    // 2) calculate gamma, Pa' and Pb'
    // 3) make borrow using entrykind 1 with different proportions: Pa' and Pb'

    RebalanceAssetsLocal memory v;
    uint indexA = 0;
    uint indexB = 0;

    uint thresholdAmountIn_ = 0; // todo
    uint alpha;
    {
      (, uint collateral, uint toBorrow,) = c.converter.findConversionStrategy(abi.encode(uint(0)), c.assetA, balanceA_, c.assetB, 1);
      require(collateral != 0 && toBorrow != 0, AppErrors.BORROW_STRATEGY_NOT_FOUND);
      uint cc = collateral * v.prices[indexA] / v.decs[indexA];
      uint cb = toBorrow * v.prices[indexB] / v.decs[indexB];
      alpha = cc / cb; // todo 1e18
    }

    uint c0 = balanceA_ * v.prices[indexA] / v.decs[indexA];
    uint cb2 = addonB_ * v.prices[indexB] / v.decs[indexB];
    uint ca0 = (c0 - alpha * cb2) / (1 + alpha * c.propB / c.propA); // todo 1e18
    uint gamma = ca0 / (ca0 * c.propB / c.propA + cb2); // todo 1e18
    uint pa2 = gamma * (c.propA + c.propB) / (1 + gamma);
    uint pb2 = (c.propA + c.propB) - pa2;

    bytes memory entryData = abi.encode(1, pa2, pb2);

    console.log("openPosition.entryData.pa2", pa2);
    console.log("openPosition.entryData.pb2", pb2);

    return ConverterStrategyBaseLib.openPosition(
      c.converter,
      entryData,
      c.assetA,
      c.assetB,
      balanceA_,
      thresholdAmountIn_
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
    console.log("rebalanceRepayBorrow");
    console.log("rebalanceRepayBorrow.requiredAmountB", requiredAmountB);
    console.log("rebalanceRepayBorrow.amountDebtA", amountDebtA);
    console.log("rebalanceRepayBorrow.amountCollateralB", amountCollateralB);

    console.log("rebalanceRepayBorrow.amount0.before.repay", IERC20(v.asset0).balanceOf(address(this)));
    console.log("rebalanceRepayBorrow.amount1.before.repay", IERC20(v.asset1).balanceOf(address(this)));

    // we need to get {requiredAmount0}
    // we don't know exact amount to repay
    // but we are sure that amount {requiredAmount0 ===> requiredAmount1} would be more than required
    uint requiredAmountA = requiredAmountB * c.alpha / 1e18;
    console.log("rebalanceRepayBorrow.requiredAmountA", requiredAmountA);
    console.log("rebalanceRepayBorrow._repayDebt", Math.min(requiredAmountA, amountDebtA));
    ConverterStrategyBaseLib._repayDebt(c.converter, c.assetB, c.assetA, Math.min(requiredAmountA, amountDebtA));

    // reinitialize v-variables
    v.amount0 = IERC20(v.asset0).balanceOf(address(this));
    v.amount1 = IERC20(v.asset1).balanceOf(address(this));
    console.log("rebalanceRepayBorrow.amount0", v.amount0);
    console.log("rebalanceRepayBorrow.amount1", v.amount1);

    (v.directDebt, v.directCollateral) = c.converter.getDebtAmountCurrent(address(this), v.asset0, v.asset1, true);
    console.log("rebalanceRepayBorrow.directDebt", v.directDebt);
    console.log("rebalanceRepayBorrow.directCollateral", v.directCollateral);

    (v.reverseDebt, v.reverseCollateral) = c.converter.getDebtAmountCurrent(address(this), v.asset1, v.asset0, true);
    console.log("rebalanceRepayBorrow.reverseDebt", v.reverseDebt);
    console.log("rebalanceRepayBorrow.reverseCollateral", v.reverseCollateral);

    return _rebalanceAssets(v, c.converter, false);
  }
}