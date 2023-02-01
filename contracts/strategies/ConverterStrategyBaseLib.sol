// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../interfaces/converter/IPriceOracle.sol";
import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/IConverterController.sol";
import "../tools/AppErrors.sol";
import "../tools/AppLib.sol";
import "../tools/TokenAmountsLib.sol";

//! import "hardhat/console.sol";

library ConverterStrategyBaseLib {
  using SafeERC20 for IERC20;
  // approx one month for average block time 2 sec
  uint private constant _LOAN_PERIOD_IN_BLOCKS = 30 days / 2;

  /// @notice Get amount of USD that we expect to receive after withdrawing, decimals of {asset_}
  ///         ratio = amount-LP-tokens-to-withdraw / total-amount-LP-tokens-in-pool
  ///         investedAssetsUSD = reserve0 * ratio * price0 + reserve1 * ratio * price1 (+ set correct decimals)
  ///         This function doesn't take into account swap/lending difference,
  ///         so result {investedAssetsUSD} doesn't take into account possible collateral
  ///         that can be returned after closing positions.
  /// @param poolAssets_ Any number of assets, one of them should be {asset_}
  /// @param reserves_ Reserves of the {poolAssets_}, same order, same length (we don't check it)
  /// @param liquidityAmount_ Amount of LP tokens that we are going to withdraw
  /// @param totalSupply_ Total amount of LP tokens in the depositor
  /// @return investedAssetsUSD Amount of USD that we expect to receive after withdrawing, decimals of {asset_}
  /// @return assetPrice Price of {asset}, decimals 18
  function getExpectedWithdrawnAmountUSD(
    address[] memory poolAssets_,
    uint[] memory reserves_,
    address asset_,
    uint liquidityAmount_,
    uint totalSupply_,
    IPriceOracle priceOracle_
  ) internal view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    uint ratio = totalSupply_ == 0
      ? 0
      : (liquidityAmount_ >= totalSupply_
        ? 1e18
        : 1e18 * liquidityAmount_ / totalSupply_
    ); // we need brackets here for npm.run.coverage

    uint degreeTargetDecimals = 10**IERC20Metadata(asset_).decimals();

    uint len = poolAssets_.length;
    for (uint i = 0; i < len; ++i) {
      uint price = priceOracle_.getAssetPrice(poolAssets_[i]);
      require(price != 0, AppErrors.ZERO_PRICE);

      if (asset_ == poolAssets_[i]) {
        investedAssetsUSD += reserves_[i] * price / 1e18;
        assetPrice = price;
      } else {
        investedAssetsUSD += reserves_[i] * price
          * degreeTargetDecimals / 10**IERC20Metadata(poolAssets_[i]).decimals()
          / 1e18;
      }
    }

    return (investedAssetsUSD * ratio / 1e18, assetPrice);
  }

  /// @notice For each {token_} calculate a part of {amount_} to be used as collateral according to the weights.
  ///         I.e. we have 300 USDC, we need to split it on 100 USDC, 100 USDT, 100 DAI
  ///         USDC is main asset, USDT and DAI should be borrowed. We check amounts of USDT and DAI on the balance
  ///         and return collaterals reduced on that amounts. For main asset, we return full amount always (100 USDC).
  function getCollaterals(
    uint amount_,
    address[] memory tokens_,
    uint[] memory weights_,
    uint totalWeight_,
    uint indexAsset_,
    IPriceOracle priceOracle
  ) internal view returns (uint[] memory tokenAmountsOut) {
    uint len = tokens_.length;
    tokenAmountsOut = new uint[](len);

    // get token prices and decimals
    uint[] memory prices = new uint[](len);
    uint[] memory decimals = new uint[](len);
    {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        decimals[i] = IERC20Metadata(tokens_[i]).decimals();
        prices[i] = priceOracle.getAssetPrice(tokens_[i]);
      }
    }

    // split the amount on tokens proportionally to the weights
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      uint amountAssetForToken = amount_ * weights_[i] / totalWeight_;

      if (i == indexAsset_) {
        tokenAmountsOut[i] = amountAssetForToken;
      } else {
        // if we have some tokens on balance then we need to use only a part of the collateral
        uint tokenAmountToBeBorrowed =  amountAssetForToken
          * prices[indexAsset_]
          * 10**decimals[i]
          / prices[i]
          / 10**decimals[indexAsset_];

        uint tokenBalance = IERC20(tokens_[i]).balanceOf(address(this));
        if (tokenBalance < tokenAmountToBeBorrowed) {
          tokenAmountsOut[i] = amountAssetForToken * (tokenAmountToBeBorrowed - tokenBalance) / tokenAmountToBeBorrowed;
        }
      }
    }
  }

  /// @notice Borrow max available amount of {borrowAsset} using {collateralAmount} of {collateralAsset} as collateral
  function borrowPosition(
    ITetuConverter tetuConverter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_
  ) internal returns (uint borrowedAmountOut) {
    //!! console.log('_borrowPosition col, amt, bor', collateralAsset, collateralAmount, borrowAsset);

    AppLib.approveIfNeeded(collateralAsset_, collateralAmount_, address(tetuConverter_));
    (address converter, uint maxTargetAmount, /*int apr18*/) = tetuConverter_.findBorrowStrategy(
      collateralAsset_,
      collateralAmount_,
      borrowAsset_,
      _LOAN_PERIOD_IN_BLOCKS
    );
    //!! console.log('converter, maxTargetAmount', converter, maxTargetAmount);

    if (converter == address(0) || maxTargetAmount == 0) {
      borrowedAmountOut = 0;
    } else {
      // we need to approve collateralAmount before the borrow-call but we already made the approval above
      borrowedAmountOut = tetuConverter_.borrow(
        converter,
        collateralAsset_,
        collateralAmount_,
        borrowAsset_,
        maxTargetAmount,
        address(this)
      );
    }

    //!! console.log('>>> BORROW collateralAmount collateralAsset', collateralAmount, collateralAsset);
    //!! console.log('>>> BORROW borrowedAmount borrowAsset', borrowedAmountOut, borrowAsset);
  }

  /// @notice Close the given position, pay {amountToRepay}, return collateral amount in result
  /// @param amountToRepay Amount to repay in terms of {borrowAsset}
  /// @return returnedAssetAmountOut Amount of collateral received back after repaying
  /// @return repaidAmountOut Amount that was actually repaid
  function closePosition(
    ITetuConverter tetuConverter_,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) internal returns (
    uint returnedAssetAmountOut,
    uint repaidAmountOut
  ) {
    //!! console.log("_closePosition");

    // We shouldn't try to pay more than we actually need to repay
    // The leftover will be swapped inside TetuConverter, it's inefficient.
    // Let's limit amountToRepay by needToRepay-amount
    (uint needToRepay,) = tetuConverter_.getDebtAmountCurrent(address(this), collateralAsset, borrowAsset);

    uint amountRepay = amountToRepay < needToRepay
      ? amountToRepay
      : needToRepay;

    // Make full/partial repayment
    uint balanceBefore = IERC20(borrowAsset).balanceOf(address(this));
    IERC20(borrowAsset).safeTransfer(address(tetuConverter_), amountRepay);
    uint returnedBorrowAmountOut;

    (returnedAssetAmountOut, returnedBorrowAmountOut,,) = tetuConverter_.repay(
      collateralAsset,
      borrowAsset,
      amountRepay,
      address(this)
    );
    uint balanceAfter = IERC20(borrowAsset).balanceOf(address(this));

    // we cannot use amountRepay here because AAVE pool adapter is able to send tiny amount back (dust tokens)
    repaidAmountOut = balanceBefore > balanceAfter
      ? balanceBefore - balanceAfter
      : 0;

    require(returnedBorrowAmountOut == 0, 'CSB: Can not convert back');
  }

  /// @notice Make liquidation if estimated amountOut exceeds the given threshold
  function liquidate(
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenOut_ // todo Probably it worth to use threshold for amount IN? it would be more gas efficient
  ) internal returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    (ITetuLiquidator.PoolData[] memory route,) = liquidator_.buildRoute(tokenIn_, tokenOut_);

    if (route.length == 0) {
      revert('CSB: No liquidation route');
    }

    // calculate balance in out value for check threshold
    uint amountOut = liquidator_.getPriceForRoute(route, amountIn_);

    // if the expected value is higher than threshold distribute to destinations
    if (amountOut > liquidationThresholdForTokenOut_) {
      // we need to approve each time, liquidator address can be changed in controller
      AppLib.approveIfNeeded(tokenIn_, amountIn_, address(liquidator_));

      uint balanceBefore = IERC20(tokenOut_).balanceOf(address(this));

      liquidator_.liquidateWithRoute(route, amountIn_, slippage_);

      // temporary save balance of token out after  liquidation to spentAmountIn
      uint balanceAfter = IERC20(tokenOut_).balanceOf(address(this));

      // assign correct values to
      receivedAmountOut = balanceAfter > balanceBefore
        ? balanceAfter - balanceBefore
        : 0;
      spentAmountIn = amountIn_;
    }

    return (spentAmountIn, receivedAmountOut);
  }

  /// @notice Find index of the given {asset_} in array {tokens_}, return type(uint).max if not found
  function getAssetIndex(address[] memory tokens_, address asset_) internal pure returns (uint) {
    uint len = tokens_.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (tokens_[i] == asset_) {
        return i;
      }
    }
    return type(uint).max;
  }
}