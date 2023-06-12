// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../strategies/ConverterStrategyBaseLib.sol";
import "hardhat/console.sol";

/// @notice Library to make new borrow, extend/reduce exist borrows and repay to keep proper assets proportions
library BorrowLib {

  struct RebalanceAssetsLocal {
    uint amount0;
    uint amount1;
    uint[] prices;
    uint[] decs;
    uint directDebt;
    uint directCollateral;
    uint reverseDebt;
    uint reverseCollateral;
  }

  struct RebalanceAssetsCore {
    ITetuConverter converter;
    address asset0;
    address asset1;
    uint prop0;
    uint prop1;
    /// @notice Asset 0 to asset 1 ratio; amount0 * a02a1r => amount1
    uint a02a1r;
  }

  /// @notice Set balances of {asset0} and {asset1} in proportions {proportion}:{100_000-proportion} using borrow/repay
  /// @param proportion [0...100_000]
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    address asset0,
    address asset1,
    uint proportion
  ) external {
    console.log("rebalanceAssets.asset0", asset0);
    console.log("rebalanceAssets.asset1", asset1);
    console.log("rebalanceAssets.proportion", proportion);

    RebalanceAssetsLocal memory v;
    v.amount0 = IERC20(asset0).balanceOf(address(this));
    v.amount1 = IERC20(asset1).balanceOf(address(this));

    IPriceOracle priceOracle = IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle());
    address[] memory tokens = new address[](2);
    tokens[0] = asset0;
    tokens[1] = asset1;
    (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(priceOracle, tokens, 2);

    uint cost0 = v.amount0 * v.prices[0] / v.decs[0];
    uint cost1 = v.amount1 * v.prices[1] / v.decs[1];
    uint requiredCost0 = (cost0 + cost1) * proportion / 100_000;
    console.log("rebalanceAssets.cost0", cost0);
    console.log("rebalanceAssets.requiredCost0", requiredCost0);
    console.log("rebalanceAssets.cost1", cost1);

    (v.directDebt, v.directCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), asset0, asset1, false);
    console.log("rebalanceAssets.directDebt", v.directDebt);
    console.log("rebalanceAssets.directCollateral", v.directCollateral);
    (v.reverseDebt, v.reverseCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), asset1, asset0, false);
    console.log("rebalanceAssets.reverseDebt", v.reverseDebt);
    console.log("rebalanceAssets.reverseCollateral", v.reverseCollateral);

    if (requiredCost0 > cost0) {
      console.log("rebalanceAssets.1");
      // we need to increase amount of asset 0 and decrease amount of asset 1
      RebalanceAssetsCore memory c10 = RebalanceAssetsCore({
        converter: tetuConverter_,
        asset0: asset1,
        asset1: asset0,
        prop0: 100_000 - proportion,
        prop1: proportion,
        a02a1r: 1e18 * v.prices[0] * v.decs[1] / v.prices[1] / v.decs[0]
      });

      if (v.directDebt > 0) {
        console.log("rebalanceAssets.2");
        // repay of asset 1 is required
        uint requiredAmount0 = (requiredCost0 - cost0) * v.decs[1] / v.prices[1];
        rebalanceRepayBorrow(c10, requiredAmount0, v.directDebt, v.directCollateral);
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
        asset0: asset1,
        asset1: asset0,
        prop0: proportion,
        prop1: 100_000 - proportion,
        a02a1r: 1e18 * v.prices[1] * v.decs[0] / v.prices[0] / v.decs[1]
      });
      // we need to decrease amount of asset 0 and increase amount of asset 1
      if (v.directDebt > 0) {
        console.log("rebalanceAssets.6");
        // additional borrow of asset 1 is required
        openPosition(c01, v.amount0, v.amount1);
      } else if (v.reverseDebt > 0) {
        console.log("rebalanceAssets.7");
        // repay of asset 0 is required
        uint requiredCost1 = (cost0 + cost1) * (100_000 - proportion) / 100_000;
        uint requiredAmount1 = (requiredCost1 - cost1) * v.decs[0] / v.prices[0];
        rebalanceRepayBorrow(c01, requiredAmount1, v.reverseDebt, v.reverseCollateral);
      } else {
        console.log("rebalanceAssets.8");
        // we need to borrow asset 1 under asset 0
        openPosition(c01, v.amount0, v.amount1);
      }
    }
  }

  /// @notice borrow asset 1 under asset 0, result balances should have proportions: (prop0 : prop1)
  function openPosition(
    RebalanceAssetsCore memory c,
    uint balance0_,
    uint balance1_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    console.log("openPosition.balance0_", balance0_);
    console.log("openPosition.balance1_", balance1_);
    uint amount0untouched;
    uint thresholdAmountIn_ = 0; // todo
    bytes memory entryData = abi.encode(1, c.prop0, c.prop1);
    console.log("openPosition.entryData.c.prop0", c.prop0);
    console.log("openPosition.entryData.c.prop1", c.prop1);
    if (balance1_ != 0) {
      // we are going to use {balance0_} as collateral
      // but there is some amount on {balance1_}, so we need to keep part of {balance0_} untouched
      amount0untouched = balance1_ * c.a02a1r / 1e18;
      console.log("openPosition.c.a02a1r", c.a02a1r);
      console.log("openPosition.amount0untouched", amount0untouched);
      require(amount0untouched < balance0_, AppErrors.WRONG_VALUE);
    }
    return ConverterStrategyBaseLib.openPosition(
      c.converter,
      entryData,
      c.asset0,
      c.asset1,
      balance0_ - amount0untouched,
      thresholdAmountIn_
    );
  }

  /// @notice Repay {amountDebt1} fully or partially to get at least {requiredAmount0} of collateral.
  ///         Borrow asset0 under asset1 to make required proportions of the assets on the balances.
  function rebalanceRepayBorrow(
    RebalanceAssetsCore memory c,
    uint requiredAmount1,
    uint amountDebt0,
    uint amountCollateral1
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    // we need to get {requiredAmount0}
    // we don't know exact amount to repay
    // but we are sure that amount {requiredAmount0 ===> requiredAmount1} would be more than required
    uint requiredAmount0 = requiredAmount1 * 1e36 / c.a02a1r;
    ConverterStrategyBaseLib._repayDebt(c.converter, c.asset0, c.asset1, Math.min(requiredAmount0, amountDebt0));
    return openPosition(
      c,
      IERC20(c.asset0).balanceOf(address(this)),
      IERC20(c.asset1).balanceOf(address(this))
    );
  }
}