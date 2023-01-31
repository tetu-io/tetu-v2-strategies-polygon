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

    // todo Take into account collateral for the borrowed amounts

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
  /// @return leftoverOut It's equal to amount-to-repay - actual amount of debt, in terms of borrowAsset
  function closePosition(
    ITetuConverter tetuConverter_,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) internal returns (
    uint returnedAssetAmountOut,
    uint leftoverOut
  ) {
    //!! console.log("_closePosition");

    // We shouldn't try to pay more than we actually need to repay
    // The leftover will be swapped inside TetuConverter, it's inefficient.
    // Let's limit amountToRepay by needToRepay-amount
    (uint needToRepay,) = tetuConverter_.getDebtAmountCurrent(address(this), collateralAsset, borrowAsset);
    leftoverOut = amountToRepay > needToRepay
      ? amountToRepay - needToRepay
      : 0;

    //!! console.log('>>> CLOSE POSITION initial amountToRepay borrowAsset', amountToRepay, borrowAsset);
    //!! console.log('>>> CLOSE POSITION needToRepay', needToRepay);
    //!! console.log('>>> CLOSE POSITION leftover', leftoverOut);

    amountToRepay = amountToRepay < needToRepay
    ? amountToRepay
    : needToRepay;

    // Make full/partial repayment
    IERC20(borrowAsset).safeTransfer(address(tetuConverter_), amountToRepay);
    uint returnedBorrowAmountOut;
    (returnedAssetAmountOut, returnedBorrowAmountOut,,) = tetuConverter_.repay(
      collateralAsset, borrowAsset, amountToRepay, address(this)
    );

    //!! console.log('>>> position closed: returnedAssetAmount:', returnedAssetAmountOut, collateralAsset);
    //!! console.log('position closed: returnedBorrowAmountOut:', returnedBorrowAmountOut);
    //!! console.log('>>> REPAY amountToRepay, borrowAsset', amountToRepay, borrowAsset);
    require(returnedBorrowAmountOut == 0, 'CSB: Can not convert back');
  }

  function liquidate(
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenOut_
  ) internal {
    //!! console.log("_liquidate", amountIn);
    //!! console.log("_liquidate balance tokenOut", IERC20(tokenOut).balanceOf(address(this)), tokenOut);
    (ITetuLiquidator.PoolData[] memory route, /* string memory error*/) = liquidator_.buildRoute(tokenIn_, tokenOut_);

    if (route.length == 0) {
      revert('CSB: No liquidation route');
    }

    // calculate balance in out value for check threshold
    uint amountOut = liquidator_.getPriceForRoute(route, amountIn_);
    //!! console.log("_liquidate expected amount out", amountOut);

    // if the expected value is higher than threshold distribute to destinations
    if (amountOut > liquidationThresholdForTokenOut_) {
      // we need to approve each time, liquidator address can be changed in controller
      AppLib.approveIfNeeded(tokenIn_, amountIn_, address(liquidator_));
      liquidator_.liquidateWithRoute(route, amountIn_, slippage_);
    }

    //!! console.log("_liquidate balance after", IERC20(tokenOut).balanceOf(address(this)));
  }

  /// @notice Claim rewards from tetuConverter, make list of all available rewards, do post-processing
  /// @dev The post-processing is rewards conversion to the main asset
  /// @param tokens_ List of rewards claimed from the internal pool
  /// @param amounts_ Amounts of rewards claimed from the internal pool
  /// @param recycle_ ConverterStrategyBase._recycle - the call converts given tokens to the main asset
  function processClaims(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    uint[] memory amounts_,
    function (address[] memory tokens, uint[] memory amounts) internal recycle_
  ) internal {
    // Rewards from TetuConverter
    (address[] memory tokens2, uint[] memory amounts2) = tetuConverter_.claimRewards(address(this));

    // Join arrays and recycle tokens
    (address[] memory tokens, uint[] memory amounts) = TokenAmountsLib.unite(tokens_, amounts_, tokens2, amounts2);
    //!! TokenAmountsLib.print("claim", tokens, amounts); // TODO remove

    // {amounts} contain just received values, but probably we already had some tokens on balance
    uint len = tokens.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      amounts[i] = IERC20(tokens[i]).balanceOf(address(this));
    }

    if (len > 0) {
      recycle_(tokens, amounts);
    }
  }
}