// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../strategies/ConverterStrategyBaseLib.sol";
import "hardhat/console.sol";

/// @notice Library to make new borrow, extend/reduce exist borrows and repay to keep proper assets proportions
library BorrowLib {

  struct RebalanceAssetsLocal {
    address asset0;
    address asset1;
    uint amount0;
    uint amount1;
    uint proportion;

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
  }

  /// @notice Set balances of {asset0} and {asset1} in proportions {proportion}:{100_000-proportion} using borrow/repay
  /// @param proportion Proportion for {asset0}, [0...100_000]
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    address asset0,
    address asset1,
    uint proportion
  ) external {
    require(proportion > 0, AppErrors.ZERO_VALUE);
    console.log("rebalanceAssets.asset0", asset0);
    console.log("rebalanceAssets.asset1", asset1);
    console.log("rebalanceAssets.proportion", proportion);

    RebalanceAssetsLocal memory v;
    v.asset0 = asset0;
    v.asset1 = asset1;
    v.proportion = proportion;

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

    uint requiredCost0 = (cost0 + cost1) * v.proportion / 100_000;
    uint requiredCost1 = (cost0 + cost1) * (100_000 - v.proportion) / 100_000;

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
        alpha: 1e18 * v.prices[0] * v.decs[1] / v.prices[1] / v.decs[0]
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
        alpha: 1e18 * v.prices[1] * v.decs[0] / v.prices[0] / v.decs[1]
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

  /// @notice borrow asset B under asset A, result balances should have proportions: (propA : propB)
  function openPosition(
    RebalanceAssetsCore memory c,
    uint balanceA_,
    uint balanceB_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    console.log("openPosition.assetA", c.assetA);
    console.log("openPosition.assetB", c.assetB);
    console.log("openPosition.balanceA_", balanceA_);
    console.log("openPosition.balanceB_", balanceB_);

    uint untouchedAmountA;
    uint thresholdAmountIn_ = 0; // todo
    bytes memory entryData = abi.encode(1, c.propA, c.propB);

    console.log("openPosition.entryData.c.prop0", c.propA);
    console.log("openPosition.entryData.c.prop1", c.propB);
    console.log("openPosition.entryData.c.a02a1r", c.alpha);

    if (balanceB_ != 0) {
      // we are going to use {balanceA_} as collateral
      // but there is some amount on {balanceB_}, so we need to keep corresponded part of {balanceA_} untouched
      untouchedAmountA = (balanceB_ * c.alpha / 1e18) * c.propA / c.propB;
      require(untouchedAmountA <= balanceA_, AppErrors.WRONG_VALUE);

      console.log("openPosition.c.a02a1r", c.alpha);
      console.log("openPosition.balanceBasA", balanceB_ * c.alpha / 1e18);
      console.log("openPosition.untouchedAmountA.estimated", (balanceB_ * c.alpha / 1e18) * c.propA / c.propB);
      console.log("openPosition.untouchedAmountA.assigned", untouchedAmountA);
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