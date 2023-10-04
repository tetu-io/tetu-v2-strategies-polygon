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
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV3.sol";
import "../libs/AppErrors.sol";
import "../libs/AppLib.sol";
import "../libs/TokenAmountsLib.sol";
import "../libs/ConverterEntryKinds.sol";
import "../interfaces/IConverterStrategyBase.sol";

/// @notice Continuation of ConverterStrategyBaseLib (workaround for size limits)
library ConverterStrategyBaseLib2 {
  using SafeERC20 for IERC20;

//region --------------------------------------- Data types
  struct CalcInvestedAssetsLocal {
    uint len;
    uint[] prices;
    uint[] decs;
    uint[] debts;
    address asset;
    address token;
  }
//endregion --------------------------------------- Data types

//region --------------------------------------- CONSTANTS
  uint internal constant DENOMINATOR = 100_000;

  /// @dev 0.5% of max loss for strategy TVL
  /// @notice Same value as StrategySplitterV2.HARDWORK_LOSS_TOLERANCE
  uint public constant HARDWORK_LOSS_TOLERANCE = 500;

  /// @dev 0.5% of max profit for strategy TVL
  /// @notice Limit max amount of profit that can be send to insurance after price changing
  uint public constant PRICE_CHANGE_PROFIT_TOLERANCE = HARDWORK_LOSS_TOLERANCE;

//endregion --------------------------------------- CONSTANTS

//region----------------------------------------- EVENTS
  event LiquidationThresholdChanged(address token, uint amount);
  event ReinvestThresholdPercentChanged(uint amount);
  event FixPriceChanges(uint investedAssetsBefore, uint investedAssetsOut);
  /// @notice Compensation of losses is not carried out completely because loss amount exceeds allowed max
  event UncoveredLoss(uint lossCovered, uint lossUncovered, uint investedAssetsBefore, uint investedAssetsAfter);
  /// @notice Insurance balance were not enough to cover the loss, {lossUncovered} was uncovered
  event NotEnoughInsurance(uint lossUncovered);
  event SendToInsurance(uint sentAmount, uint unsentAmount);
//endregion----------------------------------------- EVENTS

//region----------------------------------------- MAIN LOGIC
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


  /// @notice Calculate amount of liquidity that should be withdrawn from the pool to get {targetAmount_}
  ///               liquidityAmount = _depositorLiquidity() * {liquidityRatioOut} / 1e18
  ///         User needs to withdraw {targetAmount_} in some asset.
  ///         There are three kinds of available liquidity:
  ///         1) liquidity in the pool - {depositorLiquidity_}
  ///         2) Converted amounts on balance of the strategy - {baseAmounts_}
  ///         3) Liquidity locked in the debts.
  /// @param targetAmount_ Required amount of main asset to be withdrawn from the strategy; type(uint).max - withdraw all
  /// @return resultAmount Amount of liquidity that should be withdrawn from the pool, cannot exceed depositorLiquidity
  function getLiquidityAmount(
    uint targetAmount_,
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint investedAssets,
    uint depositorLiquidity,
    uint indexUnderlying
  ) external view returns (
    uint resultAmount
  ) {
    if (targetAmount_ != type(uint).max) {
      // reduce targetAmount_ on the amounts of not-underlying assets available on the balance
      uint len = tokens.length;
      (uint[] memory prices, uint[] memory decs) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(converter), tokens, len);
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        // assume here that the targetAmount_ is already reduced on available balance of the target asset
        if (indexAsset == i) continue;

        uint tokenBalance = IERC20(tokens[i]).balanceOf(address(this));
        if (tokenBalance != 0) {
          uint tokenBalanceInAsset = tokenBalance * prices[i] * decs[indexAsset] / prices[indexAsset] / decs[i];

          targetAmount_ = targetAmount_ > tokenBalanceInAsset
            ? targetAmount_ - tokenBalanceInAsset
            : 0;

          uint tokenBalanceInUnderlying = indexUnderlying == indexAsset
            ? tokenBalanceInAsset
            : tokenBalance * prices[i] * decs[indexUnderlying] / prices[indexUnderlying] / decs[i];

          investedAssets = investedAssets > tokenBalanceInUnderlying
            ? investedAssets - tokenBalanceInUnderlying
            : 0;
        }
      }

      if (indexAsset != indexUnderlying) {
        // convert targetAmount_ to underlying
        targetAmount_ =  targetAmount_ * prices[indexAsset] * decs[indexUnderlying] / prices[indexUnderlying] / decs[indexAsset];
      }
    }

    uint liquidityRatioOut = targetAmount_ == type(uint).max || investedAssets == 0
      ? 1e18
      : ((targetAmount_ == 0)
        ? 0
        : 1e18 * 101 * targetAmount_ / investedAssets / 100 // a part of amount that we are going to withdraw + 1% on top
      );

    resultAmount = liquidityRatioOut == 0
      ? 0
      : Math.min(liquidityRatioOut * depositorLiquidity / 1e18, depositorLiquidity);
  }

  /// @notice Claim rewards from tetuConverter, generate result list of all available rewards and airdrops
  /// @dev The post-processing is rewards conversion to the main asset
  /// @param tokens_ tokens received from {_depositorPoolAssets}
  /// @param rewardTokens_ List of rewards claimed from the internal pool
  /// @param rewardTokens_ Amounts of rewards claimed from the internal pool
  /// @param tokensOut List of available rewards - not zero amounts, reward tokens don't repeat
  /// @param amountsOut Amounts of available rewards
  function claimConverterRewards(
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

  /// @notice Get price of {tokenB} in term of {tokenA} with 18 decimals
  function getOracleAssetsPrice(ITetuConverter converter, address tokenA, address tokenB) external view returns (
    uint price
  ) {
    IPriceOracle oracle = AppLib._getPriceOracle(converter);
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);
    price = priceA > 0 ? 1e18 * priceB / priceA : type(uint).max;
  }

  function getAssetPriceFromConverter(ITetuConverter converter, address token) external view returns (uint) {
    return AppLib._getPriceOracle(converter).getAssetPrice(token);
  }

  /// @notice Try to find zero amount
  /// @return True if {amounts_} array contains zero amount
  function findZeroAmount(uint[] memory amounts_) internal pure returns (bool) {
    uint len = amounts_.length;
    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      if (amounts_[i] == 0) return true;
    }
    return false;
  }
//endregion ----------------------------------------- MAIN LOGIC

//region -------------------------------------------- Cover loss, send profit to insurance
  /// @notice Send given {amount} of {asset} (== underlying) to the insurance
  /// @param totalAssets_ Total strategy balance = balance of underlying + current invested assets amount
  /// @param balance Current balance of the underlying
  /// @return sentAmount Amount of underlying sent to the insurance
  /// @return unsentAmount Missed part of the {amount} that were not sent to the insurance
  function sendToInsurance(address asset, uint amount, address splitter, uint totalAssets_, uint balance) external returns (
    uint sentAmount,
    uint unsentAmount
  ) {
    return _sendToInsurance(asset, amount, splitter, totalAssets_, balance);
  }

  function _sendToInsurance(address asset, uint amount, address splitter, uint totalAssets_, uint balance) internal returns (
    uint sentAmount,
    uint unsentAmount
  ) {
    uint amountToSend = Math.min(amount, balance);
    if (amountToSend != 0) {
      // max amount that can be send to insurance is limited by PRICE_CHANGE_PROFIT_TOLERANCE

      // Amount limitation should be implemented in the same way as in StrategySplitterV2._coverLoss
      // Revert or cut amount in both cases

      require(totalAssets_ != 0, AppErrors.ZERO_BALANCE);
      amountToSend = Math.min(amountToSend, PRICE_CHANGE_PROFIT_TOLERANCE * totalAssets_ / 100_000);
      //require(amountToSend <= PRICE_CHANGE_PROFIT_TOLERANCE * strategyBalance / 100_000, AppErrors.EARNED_AMOUNT_TOO_HIGH);

      IERC20(asset).safeTransfer(address(ITetuVaultV2(ISplitter(splitter).vault()).insurance()), amountToSend);
    }

    sentAmount = amountToSend;
    unsentAmount = amount > amountToSend
      ? amount - amountToSend
      : 0;

    emit SendToInsurance(sentAmount, unsentAmount);
  }

  function _registerIncome(uint assetBefore, uint assetAfter) internal pure returns (uint earned, uint lost) {
    if (assetAfter > assetBefore) {
      earned = assetAfter - assetBefore;
    } else {
      lost = assetBefore - assetAfter;
    }
    return (earned, lost);
  }

  /// @notice Register income and cover possible loss after price changing, emit FixPriceChanges
  /// @param investedAssetsBefore Currently stored value of _csbs.investedAssets
  /// @param investedAssetsAfter Actual value of invested assets calculated at the current moment
  function coverLossAfterPriceChanging(
    uint investedAssetsBefore,
    uint investedAssetsAfter,
    IStrategyV3.BaseState storage baseState
  ) external returns (uint earned) {
    uint lost;
    (earned, lost) = _registerIncome(investedAssetsBefore, investedAssetsAfter);
    if (lost != 0) {
      (uint lossToCover, uint lossUncovered) = getSafeLossToCover(
        lost,
        investedAssetsAfter + IERC20(baseState.asset).balanceOf(address(this)) // totalAssets
      );
      _coverLossAndCheckResults(baseState.splitter, earned, lossToCover);

      if (lossUncovered != 0) {
        emit UncoveredLoss(lossToCover, lossUncovered, investedAssetsBefore, investedAssetsAfter);
      }
    }
    emit FixPriceChanges(investedAssetsBefore, investedAssetsAfter);
  }

  /// @notice Call coverPossibleStrategyLoss, covered loss will be sent to vault.
  ///         If the loss were covered only partially, emit {NotEnoughInsurance}
  function coverLossAndCheckResults(address splitter, uint earned, uint lossToCover) external {
    _coverLossAndCheckResults(splitter, earned, lossToCover);
  }

  /// @notice Call coverPossibleStrategyLoss, covered loss will be sent to vault.
  ///         If the loss were covered only partially, emit {NotEnoughInsurance}
  function _coverLossAndCheckResults(address splitter, uint earned, uint lossToCover) internal {
    address asset = ISplitter(splitter).asset();
    address vault = ISplitter(splitter).vault();
    uint balanceBefore = IERC20(asset).balanceOf(vault);
    ISplitter(splitter).coverPossibleStrategyLoss(earned, lossToCover);
    uint balanceAfter = IERC20(asset).balanceOf(vault);
    uint delta = balanceAfter > balanceBefore
      ? balanceAfter - balanceBefore
      : 0;
    if (delta < lossToCover) {
      emit NotEnoughInsurance(lossToCover - delta);
    }
  }

  /// @notice Cut loss-value to safe value that doesn't produce revert inside splitter
  function getSafeLossToCover(uint loss, uint totalAssets_) internal pure returns (
    uint lossToCover,
    uint lossUncovered
  ) {
    // see StrategySplitterV2._declareStrategyIncomeAndCoverLoss, _coverLoss implementations
    lossToCover = Math.min(loss, HARDWORK_LOSS_TOLERANCE * totalAssets_ / 100_000);
    lossUncovered = loss > lossToCover
      ? loss - lossToCover
      : 0;
  }

  /// @notice Send ProfitToCover to insurance - code fragment of the requirePayAmountBack()
  ///         moved here to reduce size of requirePayAmountBack()
  /// @param theAsset_ The asset passed from Converter
  /// @param balanceTheAsset_ Current balance of {theAsset_}
  /// @param investedAssets_ Value of investedAssets after call fixPriceChange()
  /// @param earnedByPrices_ ProfitToCover received from fixPriceChange()
  /// @return balanceTheAssetOut Final balance of {theAsset_} (after sending profit-to-cover to the insurance)
  function sendProfitGetAssetBalance(
    address theAsset_,
    uint balanceTheAsset_,
    uint investedAssets_,
    uint earnedByPrices_,
    IStrategyV3.BaseState storage baseState_
  ) external returns (
    uint balanceTheAssetOut
  ) {
    balanceTheAssetOut = balanceTheAsset_;
    if (earnedByPrices_ != 0) {
      address underlying = baseState_.asset;
      uint balanceUnderlying = theAsset_ == underlying
        ? balanceTheAsset_
        : AppLib.balance(underlying);

      _sendToInsurance(underlying, earnedByPrices_, baseState_.splitter, investedAssets_ + balanceUnderlying, balanceUnderlying);

      if (theAsset_ == underlying) {
        balanceTheAssetOut = AppLib.balance(theAsset_);
      }
    }
  }
//endregion -------------------------------------------- Cover loss, send profit to insurance

//region ---------------------------------------- Setters
  function checkReinvestThresholdPercentChanged(address controller, uint percent_) external {
    StrategyLib.onlyOperators(controller);
    require(percent_ <= DENOMINATOR, StrategyLib.WRONG_VALUE);
    emit ReinvestThresholdPercentChanged(percent_);
  }

  function checkLiquidationThresholdChanged(address controller, address token, uint amount) external {
    StrategyLib.onlyOperators(controller);
    emit LiquidationThresholdChanged(token, amount);
  }
//endregion ---------------------------------------- Setters

//region ---------------------------------------- Withdraw helpers
  /// @notice Get amount of assets that we expect to receive after withdrawing
  ///         ratio = amount-LP-tokens-to-withdraw / total-amount-LP-tokens-in-pool
  /// @param reserves_ Reserves of the {poolAssets_}, same order, same length (we don't check it)
  ///                  The order of tokens should be same as in {_depositorPoolAssets()},
  ///                  one of assets must be {asset_}
  /// @param liquidityAmount_ Amount of LP tokens that we are going to withdraw
  /// @param totalSupply_ Total amount of LP tokens in the depositor
  /// @return withdrawnAmountsOut Expected withdrawn amounts (decimals == decimals of the tokens)
  function getExpectedWithdrawnAmounts(
    uint[] memory reserves_,
    uint liquidityAmount_,
    uint totalSupply_
  ) internal pure returns (
    uint[] memory withdrawnAmountsOut
  ) {
    uint ratio = totalSupply_ == 0
      ? 0
      : (liquidityAmount_ >= totalSupply_
        ? 1e18
        : 1e18 * liquidityAmount_ / totalSupply_
      );

    uint len = reserves_.length;
    withdrawnAmountsOut = new uint[](len);

    if (ratio != 0) {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        withdrawnAmountsOut[i] = reserves_[i] * ratio / 1e18;
      }
    }
  }

  /// @notice Calculate expected amount of the main asset after withdrawing
  /// @param withdrawnAmounts_ Expected amounts to be withdrawn from the pool
  /// @param amountsToConvert_ Amounts on balance initially available for the conversion
  /// @return amountsOut Expected amounts of the main asset received after conversion withdrawnAmounts+amountsToConvert
  function getExpectedAmountMainAsset(
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint[] memory withdrawnAmounts_,
    uint[] memory amountsToConvert_
  ) internal returns (
    uint[] memory amountsOut
  ) {
    uint len = tokens.length;
    amountsOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) {
        amountsOut[i] = withdrawnAmounts_[i];
      } else {
        uint amount = withdrawnAmounts_[i] + amountsToConvert_[i];
        if (amount != 0) {
          (amountsOut[i],) = converter.quoteRepay(address(this), tokens[indexAsset], tokens[i], amount);
        }
      }
    }

    return amountsOut;
  }

  /// @notice Add {withdrawnAmounts} to {amountsToConvert}, calculate {expectedAmountMainAsset}
  /// @param amountsToConvert Amounts of {tokens} to be converted, they are located on the balance before withdraw
  /// @param withdrawnAmounts Amounts of {tokens} that were withdrew from the pool
  function postWithdrawActions(
    ITetuConverter converter,
    address[] memory tokens,
    uint indexAsset,

    uint[] memory reservesBeforeWithdraw,
    uint liquidityAmountWithdrew,
    uint totalSupplyBeforeWithdraw,

    uint[] memory amountsToConvert,
    uint[] memory withdrawnAmounts
  ) external returns (
    uint[] memory expectedMainAssetAmounts,
    uint[] memory _amountsToConvert
  ) {
    // estimate expected amount of assets to be withdrawn
    uint[] memory expectedWithdrawAmounts = getExpectedWithdrawnAmounts(
      reservesBeforeWithdraw,
      liquidityAmountWithdrew,
      totalSupplyBeforeWithdraw
    );

    // from received amounts after withdraw calculate how much we receive from converter for them in terms of the underlying asset
    expectedMainAssetAmounts = getExpectedAmountMainAsset(
      tokens,
      indexAsset,
      converter,
      expectedWithdrawAmounts,
      amountsToConvert
    );

    uint len = tokens.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      amountsToConvert[i] += withdrawnAmounts[i];
    }

    return (expectedMainAssetAmounts, amountsToConvert);
  }

  /// @notice return {withdrawnAmounts} with zero values and expected amount calculated using {amountsToConvert_}
  function postWithdrawActionsEmpty(
    ITetuConverter converter,
    address[] memory tokens,
    uint indexAsset,
    uint[] memory amountsToConvert_
  ) external returns (
    uint[] memory expectedAmountsMainAsset
  ) {
    expectedAmountsMainAsset = getExpectedAmountMainAsset(
      tokens,
      indexAsset,
      converter,
      // there are no withdrawn amounts
      new uint[](tokens.length), // array with all zero values
      amountsToConvert_
    );
  }
//endregion ------------------------------------- Withdraw helpers

//region---------------------------------------- calcInvestedAssets
  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because we need to update current balances in the internal protocols.
  /// @param indexAsset Index of the underlying (main asset) in {tokens}
  /// @return amountOut Invested asset amount under control (in terms of underlying)
  function calcInvestedAssets(
    address[] memory tokens,
    uint[] memory depositorQuoteExitAmountsOut,
    uint indexAsset,
    ITetuConverter converter_
  ) external returns (
    uint amountOut
  ) {
    return _calcInvestedAssets(tokens, depositorQuoteExitAmountsOut, indexAsset, converter_);
  }
  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because we need to update current balances in the internal protocols.
  /// @param indexAsset Index of the underlying (main asset) in {tokens}
  /// @return amountOut Invested asset amount under control (in terms of underlying)
  function _calcInvestedAssets(
    address[] memory tokens,
    uint[] memory depositorQuoteExitAmountsOut,
    uint indexAsset,
    ITetuConverter converter_
  ) internal returns (
    uint amountOut
  ) {
    CalcInvestedAssetsLocal memory v;
    v.len = tokens.length;
    v.asset = tokens[indexAsset];

    // calculate prices, decimals
    (v.prices, v.decs) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(converter_), tokens, v.len);

    // A debt is registered below if we have X amount of asset, need to pay Y amount of the asset and X < Y
    // In this case: debt = Y - X, the order of tokens is the same as in {tokens} array
    for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) {
        // Current strategy balance of main asset is not taken into account here because it's add by splitter
        amountOut += depositorQuoteExitAmountsOut[i];
      } else {
        v.token = tokens[i];
        // possible reverse debt: collateralAsset = tokens[i], borrowAsset = underlying
        // investedAssets is calculated using exact debts, debt-gaps are not taken into account
        (uint toPay, uint collateral) = converter_.getDebtAmountCurrent(address(this), v.token, v.asset, false);
        if (amountOut < toPay) {
          setDebt(v, indexAsset, toPay);
        } else {
          amountOut -= toPay;
        }

        // available amount to repay
        uint toRepay = collateral + IERC20(v.token).balanceOf(address(this)) + depositorQuoteExitAmountsOut[i];

        // direct debt: collateralAsset = underlying, borrowAsset = tokens[i]
        // investedAssets is calculated using exact debts, debt-gaps are not taken into account
        (toPay, collateral) = converter_.getDebtAmountCurrent(address(this), v.asset, v.token, false);
        amountOut += collateral;

        if (toRepay >= toPay) {
          amountOut += (toRepay - toPay) * v.prices[i] * v.decs[indexAsset] / v.prices[indexAsset] / v.decs[i];
        } else {
          // there is not enough amount to pay the debt
          // let's register a debt and try to resolve it later below
          setDebt(v, i, toPay - toRepay);
        }
      }
    }
    if (v.debts.length == v.len) {
      // we assume here, that it would be always profitable to save collateral
      // f.e. if there is not enough amount of USDT on our balance and we have a debt in USDT,
      // it's profitable to change any available asset to USDT, pay the debt and return the collateral back
      for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
        if (v.debts[i] == 0) continue;

        // estimatedAssets should be reduced on the debt-value
        // this estimation is approx and do not count price impact on the liquidation
        // we will able to count the real output only after withdraw process
        uint debtInAsset = v.debts[i] * v.prices[i] * v.decs[indexAsset] / v.prices[indexAsset] / v.decs[i];
        if (debtInAsset > amountOut) {
          // The debt is greater than we can pay. We shouldn't try to pay the debt in this case
          amountOut = 0;
        } else {
          amountOut -= debtInAsset;
        }
      }
    }

    return amountOut;
  }

  /// @notice Lazy initialization of v.debts, add {value} to {v.debts[index]}
  function setDebt(CalcInvestedAssetsLocal memory v, uint index, uint value) pure internal {
    if (v.debts.length == 0) {
      // lazy initialization
      v.debts = new uint[](v.len);
    }

    // to pay the following amount we need to swap some other asset at first
    v.debts[index] += value;
  }

  /// @notice Calculate the token amounts for deposit and amount of loss (as old-total-asset - new-total-asset)
  /// @param liquidationThresholdsAB [liquidityThreshold of token A, liquidityThreshold of tokenB]
  /// @return loss New total assets - old total assets
  /// @return tokenAmounts Balances of the token A and token B.
  ///                     If any balance is zero it's not possible to enter to the pool, so return empty array (len 0)
  function getTokenAmountsPair(
    ITetuConverter converter,
    uint totalAssets,
    address tokenA,
    address tokenB,
    uint[2] calldata liquidationThresholdsAB
  ) external returns (
    uint loss,
    uint[] memory tokenAmounts
  ) {
    tokenAmounts = new uint[](2);
    tokenAmounts[0] = AppLib.balance(tokenA);
    tokenAmounts[1] = AppLib.balance(tokenB);

    address[] memory tokens = new address[](2);
    tokens[0] = tokenA;
    tokens[1] = tokenB;

    uint[] memory amounts = new uint[](2);
    amounts[0] = tokenAmounts[0];

    uint newTotalAssets = _calcInvestedAssets(tokens, amounts, 0, converter);
    return (
      newTotalAssets < totalAssets
        ? totalAssets - newTotalAssets
        : 0,
      (tokenAmounts[0] < liquidationThresholdsAB[0] || tokenAmounts[1] < liquidationThresholdsAB[1])
        ? new uint[](0)
        : tokenAmounts
    );
  }
//endregion------------------------------------- calcInvestedAssets


  /// @notice Swap can give us more amount out than expected, so we will receive increasing of share price.
  ///         To prevent it, we need to send exceeded amount to insurance,
  ///         but it's too expensive to make such transfer at the end of withdrawAggByStep.
  ///         So, we postpone sending the profit until the next call of fixPriceChange
  ///         by manually setting investedAssets equal to the oldTotalAssets
  /// @dev If profitToCover was sent only partly, we will postpone sending of remain amount up to the next call
  ///      of fixPriceChange in same manner
  /// @param oldTotalAssets Total asset at the moment after last call of fixPriceChange,
  ///                       decreased on the value of profitToCover.
  function fixTooHighInvestedAssets(
    address asset_,
    uint oldTotalAssets,
    IConverterStrategyBase.ConverterStrategyBaseState storage csbs_
  ) external {
    uint balance = IERC20(asset_).balanceOf(address(this));
    uint newTotalAssets = csbs_.investedAssets + balance;

    if (oldTotalAssets < newTotalAssets) {
      // total asset was increased (i.e. because of too profitable swaps)
      // this increment will increase share price
      // we should send added amount to insurance to avoid share price change
      // anyway, it's too expensive to do it here
      // so, we postpone sending the profit until the next call of fixPriceChange
      if (oldTotalAssets > balance) {
        csbs_.investedAssets = oldTotalAssets - balance;
      }
    }
  }



}

