// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuVaultV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyLib.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../libs/AppErrors.sol";
import "../libs/AppLib.sol";
import "../libs/TokenAmountsLib.sol";
import "../libs/ConverterEntryKinds.sol";

/// @notice Continuation of ConverterStrategyBaseLib (workaround for size limits)
library ConverterStrategyBaseLib2 {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        DATA TYPES
  /////////////////////////////////////////////////////////////////////

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  uint internal constant DENOMINATOR = 100_000;

  /////////////////////////////////////////////////////////////////////
  ///                        MAIN LOGIC
  /////////////////////////////////////////////////////////////////////

  /// @notice Get balances of the {tokens_} except balance of the token at {indexAsset} position
  function getAvailableBalances(
    address[] memory tokens_,
    uint indexAsset
  ) external view returns (uint[] memory) {
    uint len = tokens_.length;
    uint[] memory amountsToConvert = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) continue;
      amountsToConvert[i] = IERC20(tokens_[i]).balanceOf(address(this));
    }
    return amountsToConvert;
  }

  /// @notice Send {amount_} of {asset_} to {receiver_} and insurance
  /// @param asset_ Underlying asset
  /// @param amount_ Amount of underlying asset to be sent to
  /// @param receiver_ Performance receiver
  function sendPerformanceFee(address asset_, uint amount_, address splitter, address receiver_) external returns (
    uint toPerf,
    uint toInsurance
  ) {
    // read inside lib for reduce contract space in the main contract
    address insurance = address(ITetuVaultV2(ISplitter(splitter).vault()).insurance());

    toPerf = amount_ / 2;
    toInsurance = amount_ - toPerf;

    if (toPerf != 0) {
      IERC20(asset_).safeTransfer(receiver_, toPerf);
    }
    if (toInsurance != 0) {
      IERC20(asset_).safeTransfer(insurance, toInsurance);
    }
  }

  function sendTokensToForwarder(
    address controller_,
    address splitter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) external {
    uint len = tokens_.length;
    IForwarder forwarder = IForwarder(IController(controller_).forwarder());
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      AppLib.approveIfNeeded(tokens_[i], amounts_[i], address(forwarder));
    }

    (tokens_, amounts_) = TokenAmountsLib.filterZeroAmounts(tokens_, amounts_);
    forwarder.registerIncome(tokens_, amounts_, ISplitter(splitter_).vault(), true);
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
  ) external view returns (
    uint[] memory tokenAmountsOut
  ) {
    uint len = tokens_.length;
    tokenAmountsOut = new uint[](len);

    // get token prices and decimals
    uint[] memory prices = new uint[](len);
    uint[] memory decs = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      decs[i] = 10 ** IERC20Metadata(tokens_[i]).decimals();
      prices[i] = priceOracle.getAssetPrice(tokens_[i]);
    }

    // split the amount on tokens proportionally to the weights
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      uint amountAssetForToken = amount_ * weights_[i] / totalWeight_;

      if (i == indexAsset_) {
        tokenAmountsOut[i] = amountAssetForToken;
      } else {
        // if we have some tokens on balance then we need to use only a part of the collateral
        uint tokenAmountToBeBorrowed = amountAssetForToken
        * prices[indexAsset_]
        * decs[i]
        / prices[i]
        / decs[indexAsset_];

        uint tokenBalance = IERC20(tokens_[i]).balanceOf(address(this));
        if (tokenBalance < tokenAmountToBeBorrowed) {
          tokenAmountsOut[i] = amountAssetForToken * (tokenAmountToBeBorrowed - tokenBalance) / tokenAmountToBeBorrowed;
        }
      }
    }
  }

  /// @notice Calculate amount of liquidity that should be withdrawn from the pool to get {targetAmount_}
  ///               liquidityAmount = _depositorLiquidity() * {liquidityRatioOut} / 1e18
  ///         User needs to withdraw {targetAmount_} in main asset.
  ///         There are two kinds of available liquidity:
  ///         1) liquidity in the pool - {depositorLiquidity_}
  ///         2) Converted amounts on balance of the strategy - {baseAmounts_}
  ///         To withdraw {targetAmount_} we need
  ///         1) Reconvert converted amounts back to main asset
  ///         2) IF result amount is not necessary - withdraw some liquidity from the pool
  ///            and also convert it to the main asset.
  /// @dev This is a writable function with read-only behavior (because of the quote-call)
  /// @param targetAmount_ Required amount of main asset to be withdrawn from the strategy; 0 - withdraw all
  /// @param strategy_ Address of the strategy
  /// @return resultAmount Amount of liquidity that should be withdrawn from the pool, cannot exceed depositorLiquidity
  /// @return amountsToConvertOut Amounts of {tokens} that should be converted to the main asset
  function getLiquidityAmount(
    uint targetAmount_,
    address strategy_,
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint investedAssets,
    uint depositorLiquidity
  ) external returns (
    uint resultAmount,
    uint[] memory amountsToConvertOut
  ) {
    bool all = targetAmount_ == 0;

    uint len = tokens.length;
    amountsToConvertOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) continue;

      uint balance = IERC20(tokens[i]).balanceOf(address(this));
      if (balance != 0) {
        // let's estimate collateral that we received back after repaying balance-amount
        (uint expectedCollateral,) = converter.quoteRepay(strategy_, tokens[indexAsset], tokens[i], balance);

        if (all || targetAmount_ != 0) {
          // We always repay WHOLE available balance-amount even if it gives us much more amount then we need.
          // We cannot repay a part of it because converter doesn't allow to know
          // what amount should be repaid to get given amount of collateral.
          // And it's too dangerous to assume that we can calculate this amount
          // by reducing balance-amount proportionally to expectedCollateral/targetAmount_
          amountsToConvertOut[i] = balance;
        }

        targetAmount_ = targetAmount_ > expectedCollateral
          ? targetAmount_ - expectedCollateral
          : 0;

        investedAssets = investedAssets > expectedCollateral
          ? investedAssets - expectedCollateral
          : 0;
      }
    }

    uint liquidityRatioOut = all || investedAssets == 0
      ? 1e18
      : ((targetAmount_ == 0)
        ? 0
        : 1e18
        * 101 // add 1% on top...
        * targetAmount_ / investedAssets // a part of amount that we are going to withdraw
        / 100 // .. add 1% on top
      );

    resultAmount = liquidityRatioOut != 0
      ? Math.min(liquidityRatioOut * depositorLiquidity / 1e18, depositorLiquidity)
      : 0;
  }

  /// @notice Claim rewards from tetuConverter, generate result list of all available rewards and airdrops
  /// @dev The post-processing is rewards conversion to the main asset
  /// @param tokens_ tokens received from {_depositorPoolAssets}
  /// @param rewardTokens_ List of rewards claimed from the internal pool
  /// @param rewardTokens_ Amounts of rewards claimed from the internal pool
  /// @param tokensOut List of available rewards - not zero amounts, reward tokens don't repeat
  /// @param amountsOut Amounts of available rewards
  function  claimConverterRewards(
    ITetuConverter converter_,
    address[] memory tokens_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_,
    uint[] memory balancesBefore
  ) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    // Rewards from TetuConverter
    (address[] memory tokensTC, uint[] memory amountsTC) = converter_.claimRewards(address(this));

    // Join arrays and recycle tokens
    (tokensOut, amountsOut) = TokenAmountsLib.combineArrays(
      rewardTokens_, rewardAmounts_,
      tokensTC, amountsTC,
      // by default, depositor assets have zero amounts here
      tokens_, new uint[](tokens_.length)
    );

    // set fresh balances for depositor tokens
    uint len = tokensOut.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      for (uint j; j < tokens_.length; j = AppLib.uncheckedInc(j)) {
        if (tokensOut[i] == tokens_[j]) {
          amountsOut[i] = IERC20(tokens_[j]).balanceOf(address(this)) - balancesBefore[j];
        }
      }
    }

    // filter zero amounts out
    (tokensOut, amountsOut) = TokenAmountsLib.filterZeroAmounts(tokensOut, amountsOut);
  }

  /// @notice Send given amount of underlying to the insurance
  function sendToInsurance(address asset, uint amount) external {
    uint amountToSend = Math.max(amount, IERC20(asset).balanceOf(address(this)));
    if (amountToSend != 0) {
      IERC20(asset).transfer(ITetuVaultV2(ISplitter(splitter).vault()).insurance, amount);
    }
  }
}

