// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../strategies/ConverterStrategyBaseLib.sol";

/// @notice Library to make new borrow, extend/reduce exist borrows and repay to keep proper assets proportions
library BorrowLib {

  struct RebalanceAssetsContext {
    address asset0;
    address asset1;
    uint amount0;
    uint amount1;
    uint[] prices;
    uint[] decs;
    uint directDebt;
    uint directCollateral;
    uint reverseDebt;
    uint reverseCollateral;
    uint prop0;
    uint prop1;
  }

  /// @notice Set balances of {asset0} and {asset1} in proportions {proportion}:{100_000-proportion} using borrow/repay
  /// @param proportion [0...100_000]
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    address asset0,
    address asset1,
    uint proportion
  ) external {
    RebalanceAssetsContext memory v;
    v.asset0 = asset0;
    v.asset1 = asset1;
    v.amount0 = IERC20(asset0).balanceOf(asset0);
    v.amount1 = IERC20(asset1).balanceOf(asset0);

    IPriceOracle priceOracle = IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle());
    address[] memory tokens = new address[](2);
    tokens[0] = asset0;
    tokens[1] = asset1;
    (v.prices, v.decs) = ConverterStrategyBaseLib._getPricesAndDecs(priceOracle, tokens, 2);

    uint cost0 = v.amount0 * v.prices[0] / v.decs[0];
    uint cost1 = v.amount1 * v.prices[1] / v.decs[1];
    v.prop0 = proportion;
    v.prop1 = 100_000 - proportion;
    uint requiredCost0 = (v.cost0 + v.cost1) * v.prop0;
    uint requiredCost1 = (v.cost0 + v.cost1) * v.prop1;

    (v.directDebt, v.directCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), asset0, asset1, false);
    (v.reverseDebt, v.reverseCollateral) = tetuConverter_.getDebtAmountCurrent(address(this), asset1, asset0, false);

    if (requiredCost0 > cost0) {
      // we need to decrease amount of asset 0 and increase amount of asset 1
      if (v.directDebt > 0) {
        // additional borrow of asset 1 is required
      } else if (v.reverseDebt > 0) {
        // repay of asset 0 is required
      } else {
        // we need to borrow asset 1 under asset 0
      }
    } else if (requiredCost0 < cost0) {
      // we need to increase amount of asset 0 and decrease amount of asset 1
      if (v.directDebt > 0) {
        // repay of asset 1 is required
      } else if (v.reverseDebt > 0) {
        // additional borrow of asset 0 is required
      } else {
        // we need to borrow asset 0 under asset 1
      }
    }
  }

  /// @notice Borrow {amount_} of asset1 under asset0
  function additionalBorrow1(
    ITetuConverter tetuConverter_,
    RebalanceAssetsContext memory v,
    uint amount_
  ) internal {
    
  }

  function openPosition(
    ITetuConverter tetuConverter_,
    bytes memory entryData_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountIn_,
    uint thresholdAmountIn_
  ) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    return ConverterStrategyBaseLib.openPosition(tetuConverter_, entryData_, collateralAsset_, borrowAsset_, amountIn_, thresholdAmountIn_);
  }


}