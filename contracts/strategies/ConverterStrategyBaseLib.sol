// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuVaultV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../libs/AppErrors.sol";
import "../libs/AppLib.sol";
import "../libs/TokenAmountsLib.sol";
import "../libs/ConverterEntryKinds.sol";
import "hardhat/console.sol";

library ConverterStrategyBaseLib {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  //region Data types
  /////////////////////////////////////////////////////////////////////
  /// @notice Local vars for {_recycle}, workaround for stack too deep
  struct RecycleLocalParams {
    /// @notice Compound amount + Performance amount
    uint amountCP;
    /// @notice Amount to compound
    uint amountC;
    /// @notice Amount to send to performance and insurance
    uint amountP;
    /// @notice Amount to forwarder + amount to compound
    uint amountFC;
    address rewardToken;
    uint len;
    uint receivedAmountOut;
  }

  struct OpenPositionLocal {
    uint entryKind;
    address[] converters;
    uint[] collateralsRequired;
    uint[] amountsToBorrow;
    uint collateral;
    uint amountToBorrow;
  }

  struct OpenPositionEntryKind1Local {
    address[] converters;
    uint[] collateralsRequired;
    uint[] amountsToBorrow;
    uint collateral;
    uint amountToBorrow;
    uint c1;
    uint c3;
    uint ratio;
    uint alpha;
  }

  struct CalcInvestedAssetsLocal {
    uint len;
    uint[] prices;
    uint[] decs;
    uint[] debts;
  }

  struct ConvertAfterWithdrawLocal {
    address asset;
    uint collateral;
    uint spent;
    uint received;
    uint balance;
    uint balanceBefore;
    uint len;
  }

  struct SwapToGivenAmountInputParams {
    ITetuConverter converter;
    ITetuLiquidator liquidator;
    uint targetAmount;
    address[] tokens;
    uint[] amounts;
    /// @notice liquidationThresholds for the {tokens}
    uint[] liquidationThresholds;
    uint indexTargetAsset;
    address underlying;
    /// @notice Allow to swap more then required (i.e. 1_000 => +1%)
    ///         to avoid additional swap if the swap return amount a bit less than we expected
    uint overswap;
  }

  struct SwapToGivenAmountLocal {
    uint len;
    uint[] availableAmounts;
    uint i;
  }

  struct CloseDebtsForRequiredAmountLocal {
    address asset;
    uint balanceAsset;
    uint balanceToken;

    uint totalDebt;
    uint totalCollateral;

    uint newBalanceAsset;
    uint newBalanceToken;

    uint debtReverse;
    uint collateralReverse;

    uint tokenBalance;

    uint idxToSwap1;
    uint amountToSwap;
    uint idxToRepay1;
  }

  /// @notice Set of parameters required to liquidation through aggregators
  struct PlanInputParams {
    ITetuConverter converter;

    /// @notice Assets used by depositor stored as following way: [underlying, not-underlying]
    address[] tokens;

    /// @notice Liquidation thresholds for the {tokens}
    uint[] liquidationThresholds;

    /// @notice Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
    ///         The leftovers should be swapped to get following result proportions of the assets:
    ///         not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
    uint propNotUnderlying18;

    /// @notice Cost of $1 in terms of the assets, decimals 18
    uint[] prices;
    /// @notice 10**decimal for the assets
    uint[] decs;
  }

  struct GetIterationPlanLocal {
    /// @notice Underlying balance
    uint assetBalance;
    /// @notice Not-underlying balance
    uint tokenBalance;

    uint totalDebt;
    uint totalCollateral;

    uint debtReverse;
    uint collateralReverse;

    uint costAssets;
    uint costTokens;
    uint targetAssets;
    uint targetTokens;
  }

  struct DataSetLocal {
    ITetuConverter converter;
    ITetuLiquidator liquidator;
    /// @notice Tokens received from {_depositorPoolAssets}
    address[] tokens;
    /// @notice Index of the main asset in {tokens}
    uint indexAsset;
    /// @notice Length of {tokens}
    uint len;
  }
  //endregion Data types

  /////////////////////////////////////////////////////////////////////
  //region Constants
  /////////////////////////////////////////////////////////////////////

  /// @notice approx one month for average block time 2 sec
  uint internal constant _LOAN_PERIOD_IN_BLOCKS = 30 days / 2;
  uint internal constant _REWARD_LIQUIDATION_SLIPPAGE = 5_000; // 5%
  uint internal constant COMPOUND_DENOMINATOR = 100_000;
  uint internal constant DENOMINATOR = 100_000;
  uint internal constant _ASSET_LIQUIDATION_SLIPPAGE = 300;
  uint internal constant PRICE_IMPACT_TOLERANCE = 300;
  /// @notice borrow/collateral amount cannot be less than given number of tokens
  uint internal constant DEFAULT_OPEN_POSITION_AMOUNT_IN_THRESHOLD = 10;
  /// @notice Allow to swap more then required (i.e. 1_000 => +1%) inside {swapToGivenAmount}
  ///         to avoid additional swap if the swap will return amount a bit less than we expected
  uint internal constant OVERSWAP = PRICE_IMPACT_TOLERANCE + _ASSET_LIQUIDATION_SLIPPAGE;
  /// @dev Absolute value for any token
  uint internal constant DEFAULT_LIQUIDATION_THRESHOLD = 100_000;
  /// @notice 1% gap to cover possible liquidation inefficiency
  /// @dev We assume that: conversion-result-calculated-by-prices - liquidation-result <= the-gap
  uint internal constant GAP_CONVERSION = 1_000;
  //endregion Constants

  /////////////////////////////////////////////////////////////////////
  //region Events
  /////////////////////////////////////////////////////////////////////
  /// @notice A borrow was made
  event OpenPosition(
    address converter,
    address collateralAsset,
    uint collateralAmount,
    address borrowAsset,
    uint borrowedAmount,
    address recepient
  );

  /// @notice Some borrow(s) was/were repaid
  event ClosePosition(
    address collateralAsset,
    address borrowAsset,
    uint amountRepay,
    address recepient,
    uint returnedAssetAmountOut,
    uint returnedBorrowAmountOut
  );

  /// @notice A liquidation was made
  event Liquidation(
    address tokenIn,
    address tokenOut,
    uint amountIn,
    uint spentAmountIn,
    uint receivedAmountOut
  );

  event ReturnAssetToConverter(address asset, uint amount);

  event FixPriceChanges(uint investedAssetsBefore, uint investedAssetsOut);
  //endregion Events

  /////////////////////////////////////////////////////////////////////
  //region View functions
  /////////////////////////////////////////////////////////////////////

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

  /// @return prices Asset prices in USD, decimals 18
  /// @return decs 10**decimals
  function _getPricesAndDecs(IPriceOracle priceOracle, address[] memory tokens_, uint len) internal view returns (
    uint[] memory prices,
    uint[] memory decs
  ) {
    prices = new uint[](len);
    decs = new uint[](len);
    {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        decs[i] = 10 ** IERC20Metadata(tokens_[i]).decimals();
        prices[i] = priceOracle.getAssetPrice(tokens_[i]);
      }
    }
  }

  function _getLiquidationThresholds(
    mapping(address => uint) storage liquidationThresholds,
    address[] memory tokens_,
    uint len
  ) internal view returns (
    uint[] memory liquidationThresholdsOut
  ) {
    liquidationThresholdsOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      liquidationThresholdsOut[i] = liquidationThresholds[tokens_[i]];
    }
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

  /// @notice Get the price ratio of the two given tokens from the oracle.
  /// @param converter The Tetu converter.
  /// @param tokenA The first token address.
  /// @param tokenB The second token address.
  /// @return The price ratio of the two tokens.
  function getOracleAssetsPrice(ITetuConverter converter, address tokenA, address tokenB) external view returns (uint) {
    IPriceOracle oracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);
    return priceB * 1e18 / priceA;
  }
  //endregion View functions

  /////////////////////////////////////////////////////////////////////
  //region Borrow and close positions
  /////////////////////////////////////////////////////////////////////

  /// @notice Make one or several borrow necessary to supply/borrow required {amountIn_} according to {entryData_}
  ///         Max possible collateral should be approved before calling of this function.
  /// @param entryData_ Encoded entry kind and additional params if necessary (set of params depends on the kind)
  ///                   See TetuConverter\EntryKinds.sol\ENTRY_KIND_XXX constants for possible entry kinds
  ///                   0 or empty: Amount of collateral {amountIn_} is fixed, amount of borrow should be max possible.
  /// @param amountIn_ Meaning depends on {entryData_}.
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
    return _openPosition(tetuConverter_, entryData_, collateralAsset_, borrowAsset_, amountIn_, thresholdAmountIn_);
  }

  /// @notice Make one or several borrow necessary to supply/borrow required {amountIn_} according to {entryData_}
  ///         Max possible collateral should be approved before calling of this function.
  /// @param entryData_ Encoded entry kind and additional params if necessary (set of params depends on the kind)
  ///                   See TetuConverter\EntryKinds.sol\ENTRY_KIND_XXX constants for possible entry kinds
  ///                   0 or empty: Amount of collateral {amountIn_} is fixed, amount of borrow should be max possible.
  /// @param amountIn_ Meaning depends on {entryData_}.
  /// @param thresholdAmountIn_ Min value of amountIn allowed for the second and subsequent conversions.
  ///        0 - use default min value
  ///        If amountIn becomes too low, no additional borrows are possible, so
  ///        the rest amountIn is just added to collateral/borrow amount of previous conversion.
  function _openPosition(
    ITetuConverter tetuConverter_,
    bytes memory entryData_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountIn_,
    uint thresholdAmountIn_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    if (thresholdAmountIn_ == 0) {
      // zero threshold is not allowed because round-issues are possible, see openPosition.dust test
      // we assume here, that it's useless to borrow amount using collateral/borrow amount
      // less than given number of tokens (event for BTC)
      thresholdAmountIn_ = DEFAULT_OPEN_POSITION_AMOUNT_IN_THRESHOLD;
    }
    if (amountIn_ <= thresholdAmountIn_) {
      return (0, 0);
    }

    OpenPositionLocal memory vars;
    // we assume here, that max possible collateral amount is already approved (as it's required by TetuConverter)
    vars.entryKind = ConverterEntryKinds.getEntryKind(entryData_);
    if (vars.entryKind == ConverterEntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
      return openPositionEntryKind1(
        tetuConverter_,
        entryData_,
        collateralAsset_,
        borrowAsset_,
        amountIn_,
        thresholdAmountIn_
      );
    } else {
      (vars.converters, vars.collateralsRequired, vars.amountsToBorrow,) = tetuConverter_.findBorrowStrategies(
        entryData_,
        collateralAsset_,
        amountIn_,
        borrowAsset_,
        _LOAN_PERIOD_IN_BLOCKS
      );

      uint len = vars.converters.length;
      if (len > 0) {
        for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
          // we need to approve collateralAmount before the borrow-call but it's already approved, see above comments
          vars.collateral;
          vars.amountToBorrow;
          if (vars.entryKind == ConverterEntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
            // we have exact amount of total collateral amount
            // Case ENTRY_KIND_EXACT_PROPORTION_1 is here too because we consider first platform only
            vars.collateral = amountIn_ < vars.collateralsRequired[i]
              ? amountIn_
              : vars.collateralsRequired[i];
            vars.amountToBorrow = amountIn_ < vars.collateralsRequired[i]
              ? vars.amountsToBorrow[i] * amountIn_ / vars.collateralsRequired[i]
              : vars.amountsToBorrow[i];
            amountIn_ -= vars.collateral;
          } else {
            // assume here that entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2
            // we have exact amount of total amount-to-borrow
            vars.amountToBorrow = amountIn_ < vars.amountsToBorrow[i]
              ? amountIn_
              : vars.amountsToBorrow[i];
            vars.collateral = amountIn_ < vars.amountsToBorrow[i]
              ? vars.collateralsRequired[i] * amountIn_ / vars.amountsToBorrow[i]
              : vars.collateralsRequired[i];
            amountIn_ -= vars.amountToBorrow;
          }

          if (amountIn_ < thresholdAmountIn_ && amountIn_ != 0) {
            // dust amount is left, just leave it unused
            // we cannot add it to collateral/borrow amounts - there is a risk to exceed max allowed amounts
            amountIn_ = 0;
          }

          if (vars.amountToBorrow != 0) {
            borrowedAmountOut += tetuConverter_.borrow(
              vars.converters[i],
              collateralAsset_,
              vars.collateral,
              borrowAsset_,
              vars.amountToBorrow,
              address(this)
            );
            collateralAmountOut += vars.collateral;
            emit OpenPosition(
              vars.converters[i],
              collateralAsset_,
              vars.collateral,
              borrowAsset_,
              vars.amountToBorrow,
              address(this)
            );
          }

          if (amountIn_ == 0) break;
        }
      }

      return (collateralAmountOut, borrowedAmountOut);
    }
  }

  /// @notice Open position using entry kind 1 - split provided amount on two parts according provided proportions
  /// @param amountIn_ Amount of collateral to be divided on parts. We assume {amountIn_} > 0
  /// @param collateralThreshold_ Min allowed collateral amount to be used for new borrow, > 0
  /// @return collateralAmountOut Total collateral used to borrow {borrowedAmountOut}
  /// @return borrowedAmountOut Total borrowed amount
  function openPositionEntryKind1(
    ITetuConverter tetuConverter_,
    bytes memory entryData_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountIn_,
    uint collateralThreshold_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    OpenPositionEntryKind1Local memory vars;
    (vars.converters, vars.collateralsRequired, vars.amountsToBorrow,) = tetuConverter_.findBorrowStrategies(
      entryData_,
      collateralAsset_,
      amountIn_,
      borrowAsset_,
      _LOAN_PERIOD_IN_BLOCKS
    );

    uint len = vars.converters.length;
    if (len > 0) {
      // we should split amountIn on two amounts with proportions x:y
      (, uint x, uint y) = abi.decode(entryData_, (uint, uint, uint));
      // calculate prices conversion ratio using price oracle, decimals 18
      // i.e. alpha = 1e18 * 75e6 usdc / 25e18 matic = 3e6 usdc/matic
      vars.alpha = _getCollateralToBorrowRatio(tetuConverter_, collateralAsset_, borrowAsset_);

      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        // the lending platform allows to convert {collateralsRequired[i]} to {amountsToBorrow[i]}
        // and give us required proportions in result
        // C = C1 + C2, C2 => B2, B2 * alpha = C3, C1/C3 must be equal to x/y
        // C1 is collateral amount left untouched (x)
        // C2 is collateral amount converted to B2 (y)
        // but if lending platform doesn't have enough liquidity
        // it reduces {collateralsRequired[i]} and {amountsToBorrow[i]} proportionally to fit the limits
        // as result, remaining C1 will be too big after conversion and we need to make another borrow
        vars.c3 = vars.alpha * vars.amountsToBorrow[i] / 1e18;
        vars.c1 = x * vars.c3 / y;
        vars.ratio = (vars.collateralsRequired[i] + vars.c1) > amountIn_
          ? 1e18 * amountIn_ / (vars.collateralsRequired[i] + vars.c1)
          : 1e18;

        vars.collateral = vars.collateralsRequired[i] * vars.ratio / 1e18;
        vars.amountToBorrow = vars.amountsToBorrow[i] * vars.ratio / 1e18;

        // skip any attempts to borrow zero amount or use too little collateral
        if (vars.collateral < collateralThreshold_ || vars.amountToBorrow == 0) {
          if (vars.collateralsRequired[i] + vars.c1 + collateralThreshold_ > amountIn_) {
            // The lending platform has enough resources to make the borrow but amount of the borrow is too low
            // Skip the borrow, leave leftover of collateral untouched
            break;
          } else {
            // The lending platform doesn't have enough resources to make the borrow.
            // We should try to make borrow on the next platform (if any)
            continue;
          }
        }

        console.log("Borrow.collateralAsset,borrowAsset", collateralAsset_, borrowAsset_);
        console.log("Borrow.collateral,amountToBorrow", vars.collateral, vars.amountToBorrow);
        require(
          tetuConverter_.borrow(
            vars.converters[i],
            collateralAsset_,
            vars.collateral,
            borrowAsset_,
            vars.amountToBorrow,
            address(this)
          ) == vars.amountToBorrow,
          StrategyLib.WRONG_VALUE
        );
        emit OpenPosition(
          vars.converters[i],
          collateralAsset_,
          vars.collateral,
          borrowAsset_,
          vars.amountToBorrow,
          address(this)
        );

        borrowedAmountOut += vars.amountToBorrow;
        collateralAmountOut += vars.collateral;

        // calculate amount to be borrowed in the next converter
        vars.c3 = vars.alpha * vars.amountToBorrow / 1e18;
        vars.c1 = x * vars.c3 / y;
        amountIn_ = (amountIn_ > vars.c1 + vars.collateral)
          ? amountIn_ - (vars.c1 + vars.collateral)
          : 0;

        // protection against dust amounts, see "openPosition.dust", just leave dust amount unused
        // we CAN NOT add it to collateral/borrow amounts - there is a risk to exceed max allowed amounts
        // we assume here, that collateralThreshold_ != 0, so check amountIn_ != 0 is not required
        if (amountIn_ < collateralThreshold_) break;
      }
    }

    return (collateralAmountOut, borrowedAmountOut);
  }

  /// @notice Get ratio18 = collateral / borrow
  function _getCollateralToBorrowRatio(
    ITetuConverter tetuConverter_,
    address collateralAsset_,
    address borrowAsset_
  ) internal view returns (uint){
    IPriceOracle priceOracle = IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle());
    uint priceCollateral = priceOracle.getAssetPrice(collateralAsset_);
    uint priceBorrow = priceOracle.getAssetPrice(borrowAsset_);
    return 1e18 * priceBorrow * 10 ** IERC20Metadata(collateralAsset_).decimals()
    / priceCollateral / 10 ** IERC20Metadata(borrowAsset_).decimals();
  }

  /// @notice Close the given position, pay {amountToRepay}, return collateral amount in result
  ///         It doesn't repay more than the actual amount of the debt, so it can use less amount than {amountToRepay}
  /// @param amountToRepay Amount to repay in terms of {borrowAsset}
  /// @return returnedAssetAmountOut Amount of collateral received back after repaying
  /// @return repaidAmountOut Amount that was actually repaid
  function _closePosition(
    ITetuConverter converter_,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) internal returns (
    uint returnedAssetAmountOut,
    uint repaidAmountOut
  ) {

    uint balanceBefore = IERC20(borrowAsset).balanceOf(address(this));

    // We shouldn't try to pay more than we actually need to repay
    // The leftover will be swapped inside TetuConverter, it's inefficient.
    // Let's limit amountToRepay by needToRepay-amount
    (uint needToRepay,) = converter_.getDebtAmountCurrent(address(this), collateralAsset, borrowAsset, true);
    uint amountRepay = Math.min(amountToRepay < needToRepay ? amountToRepay : needToRepay, balanceBefore);

    return _closePositionExact(converter_, collateralAsset, borrowAsset, amountRepay, balanceBefore);
  }

  /// @notice Close the given position, pay {amountRepay} exactly and ensure that all amount was accepted,
  /// @param amountRepay Amount to repay in terms of {borrowAsset}
  /// @param balanceBorrowAsset Current balance of the borrow asset
  /// @return collateralOut Amount of collateral received back after repaying
  /// @return repaidAmountOut Amount that was actually repaid
  function _closePositionExact(
    ITetuConverter converter_,
    address collateralAsset,
    address borrowAsset,
    uint amountRepay,
    uint balanceBorrowAsset
  ) internal returns (
    uint collateralOut,
    uint repaidAmountOut
  ) {
    // Make full/partial repayment
    IERC20(borrowAsset).safeTransfer(address(converter_), amountRepay);

    uint notUsedAmount;
    (collateralOut, notUsedAmount,,) = converter_.repay(collateralAsset, borrowAsset, amountRepay, address(this));

    emit ClosePosition(collateralAsset, borrowAsset, amountRepay, address(this), collateralOut, notUsedAmount);
    uint balanceAfter = IERC20(borrowAsset).balanceOf(address(this));

    // we cannot use amountRepay here because AAVE pool adapter is able to send tiny amount back (debt-gap)
    repaidAmountOut = balanceBorrowAsset > balanceAfter
      ? balanceBorrowAsset - balanceAfter
      : 0;

    require(notUsedAmount == 0, StrategyLib.WRONG_VALUE);
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
  ) external returns (
    uint returnedAssetAmountOut,
    uint repaidAmountOut
  ) {
    return _closePosition(tetuConverter_, collateralAsset, borrowAsset, amountToRepay);
  }
  //endregion Borrow and close positions

  /////////////////////////////////////////////////////////////////////
  //region Liquidation
  /////////////////////////////////////////////////////////////////////

  /// @notice Make liquidation if estimated amountOut exceeds the given threshold
  /// @param liquidationThresholdForTokenIn_ Liquidation threshold for {amountIn_}
  /// @param skipValidation Don't check correctness of conversion using TetuConverter's oracle (i.e. for reward tokens)
  /// @return spentAmountIn Amount of {tokenIn} has been consumed by the liquidator
  /// @return receivedAmountOut Amount of {tokenOut_} has been returned by the liquidator
  function liquidate(
    ITetuConverter converter,
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenIn_,
    bool skipValidation
  ) external returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    return _liquidate(converter, liquidator_, tokenIn_, tokenOut_, amountIn_, slippage_, liquidationThresholdForTokenIn_, skipValidation);
  }

  /// @notice Make liquidation if estimated amountOut exceeds the given threshold
  /// @param liquidationThresholdForTokenIn_ Liquidation threshold for {amountIn_}
  /// @param skipValidation Don't check correctness of conversion using TetuConverter's oracle (i.e. for reward tokens)
  /// @return spentAmountIn Amount of {tokenIn} has been consumed by the liquidator (== 0 | amountIn_)
  /// @return receivedAmountOut Amount of {tokenOut_} has been returned by the liquidator
  function _liquidate(
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenIn_,
    bool skipValidation
  ) internal returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    console.log("_liquidate.tokenIn_,tokenOut_,amountIn_", tokenIn_, tokenOut_, amountIn_);
    // we check amountIn by threshold, not amountOut
    // because {_closePositionsToGetAmount} is implemented in {get plan, make action}-way
    // {_closePositionsToGetAmount} can be used with swap by aggregators, where amountOut cannot be calculcate
    // at the moment of plan building. So, for uniformity, only amountIn is checked everywhere

    // todo use Math.min(DEFAULT_LIQUIDATION_THRESHOLD, liquidationThresholdForTokenIn_), fix tests
    if (amountIn_ <= liquidationThresholdForTokenIn_) {
      return (0, 0);
    }

    (ITetuLiquidator.PoolData[] memory route,) = liquidator_.buildRoute(tokenIn_, tokenOut_);

    require(route.length != 0, AppErrors.NO_LIQUIDATION_ROUTE);

    // if the expected value is higher than threshold distribute to destinations
    return (amountIn_, _liquidateWithRoute(converter_, route, liquidator_, tokenIn_, tokenOut_, amountIn_, slippage_, skipValidation));
  }

  /// @notice Make liquidation using given route and check correctness using TetuConverter's price oracle
  /// @param skipValidation Don't check correctness of conversion using TetuConverter's oracle (i.e. for reward tokens)
  function _liquidateWithRoute(
    ITetuConverter converter_,
    ITetuLiquidator.PoolData[] memory route,
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    bool skipValidation
  ) internal returns (
    uint receivedAmountOut
  ) {
    // we need to approve each time, liquidator address can be changed in controller
    AppLib.approveIfNeeded(tokenIn_, amountIn_, address(liquidator_));

    uint balanceBefore = IERC20(tokenOut_).balanceOf(address(this));
    liquidator_.liquidateWithRoute(route, amountIn_, slippage_);
    uint balanceAfter = IERC20(tokenOut_).balanceOf(address(this));
    console.log("_liquidateWithRoute.balanceBefore", balanceBefore);
    console.log("_liquidateWithRoute.balanceAfter", balanceAfter);

    require(balanceAfter > balanceBefore, AppErrors.BALANCE_DECREASE);
    receivedAmountOut = balanceAfter - balanceBefore;

    // Oracle in TetuConverter "knows" only limited number of the assets
    // It may not know prices for reward assets, so for rewards this validation should be skipped to avoid TC-4 error
    require(skipValidation || converter_.isConversionValid(tokenIn_, amountIn_, tokenOut_, receivedAmountOut, slippage_), AppErrors.PRICE_IMPACT);
    emit Liquidation(tokenIn_, tokenOut_, amountIn_, amountIn_, receivedAmountOut);
  }
  //endregion Liquidation

  /////////////////////////////////////////////////////////////////////
  //region requirePayAmountBack
  /////////////////////////////////////////////////////////////////////

  /// @param amount_ Amount of the main asset requested by converter
  /// @param indexTheAsset Index of the asset required by converter in the {tokens}
  /// @param asset Main asset or underlying (it can be different from tokens[indexTheAsset])
  /// @return amountOut Amount of the main asset sent to converter
  function swapToGivenAmountAndSendToConverter(
    uint amount_,
    uint indexTheAsset,
    address[] memory tokens,
    address converter,
    address controller,
    address asset,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    uint amountOut
  ) {
    // msg.sender == converter; we assume here that it was checked before the call of this function
    amountOut = IERC20(tokens[indexTheAsset]).balanceOf(address(this));

    // convert withdrawn assets to the target asset if not enough
    if (amountOut < amount_) {
      ConverterStrategyBaseLib.swapToGivenAmount(
        amount_ - amountOut,
        tokens,
        indexTheAsset,
        asset, // underlying === main asset
        ITetuConverter(converter),
        ITetuLiquidator(IController(controller).liquidator()),
        _getLiquidationThresholds(liquidationThresholds, tokens, tokens.length),
        OVERSWAP
      );
      amountOut = IERC20(tokens[indexTheAsset]).balanceOf(address(this));
    }

    // we should send the asset as is even if it is lower than requested
    // but shouldn't sent more amount than requested
    amountOut = Math.min(amount_, amountOut);
    if (amountOut != 0) {
      IERC20(tokens[indexTheAsset]).safeTransfer(converter, amountOut);
    }

    // There are two cases of calling requirePayAmountBack by converter:
    // 1) close a borrow: we will receive collateral back and amount of investedAssets almost won't change
    // 2) rebalancing: we have real loss, it will be taken into account at next hard work
    emit ReturnAssetToConverter(tokens[indexTheAsset], amountOut);

    // let's leave any leftovers un-invested, they will be reinvested at next hardwork
  }

  /// @notice Swap available amounts of {tokens_} to receive {targetAmount_} of {tokens[indexTheAsset_]}
  /// @param targetAmount_ Required amount of tokens[indexTheAsset_] that should be received by swap(s)
  /// @param tokens_ tokens received from {_depositorPoolAssets}
  /// @param indexTargetAsset_ Index of target asset in tokens_ array
  /// @param underlying_ Index of underlying
  /// @param liquidationThresholds_ Liquidation thresholds for the {tokens_}
  /// @param overswap_ Allow to swap more then required (i.e. 1_000 => +1%)
  ///                  to avoid additional swap if the swap return amount a bit less than we expected
  /// @return spentAmounts Any amounts spent during the swaps
  /// @return receivedAmounts Any amounts received during the swaps
  function swapToGivenAmount(
    uint targetAmount_,
    address[] memory tokens_,
    uint indexTargetAsset_,
    address underlying_,
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    uint[] memory liquidationThresholds_,
    uint overswap_
  ) internal returns (
    uint[] memory spentAmounts,
    uint[] memory receivedAmounts
  ) {
    SwapToGivenAmountLocal memory v;
    v.len = tokens_.length;

    v.availableAmounts = new uint[](v.len);
    for (; v.i < v.len; v.i = AppLib.uncheckedInc(v.i)) {
      v.availableAmounts[v.i] = IERC20(tokens_[v.i]).balanceOf(address(this));
    }

    (spentAmounts, receivedAmounts) = _swapToGivenAmount(
      SwapToGivenAmountInputParams({
        targetAmount: targetAmount_,
        tokens: tokens_,
        indexTargetAsset: indexTargetAsset_,
        underlying: underlying_,
        amounts: v.availableAmounts,
        converter: converter_,
        liquidator: liquidator_,
        liquidationThresholds: liquidationThresholds_,
        overswap: overswap_
      })
    );
  }

  /// @notice Swap available {amounts_} of {tokens_} to receive {targetAmount_} of {tokens[indexTheAsset_]}
  /// @return spentAmounts Any amounts spent during the swaps
  /// @return receivedAmounts Any amounts received during the swaps
  function _swapToGivenAmount(SwapToGivenAmountInputParams memory p) internal returns (
    uint[] memory spentAmounts,
    uint[] memory receivedAmounts
  ) {
    CalcInvestedAssetsLocal memory v;
    v.len = p.tokens.length;
    receivedAmounts = new uint[](v.len);
    spentAmounts = new uint[](v.len);

    // calculate prices, decimals
    (v.prices, v.decs) = _getPricesAndDecs(
      IPriceOracle(IConverterController(p.converter.controller()).priceOracle()),
      p.tokens,
      v.len
    );

    // we need to swap other assets to the asset
    // at first we should swap NOT underlying.
    // if it would be not enough, we can swap underlying too.

    // swap NOT underlying, initialize {indexUnderlying}
    uint indexUnderlying;
    for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
      if (p.underlying == p.tokens[i]) {
        indexUnderlying = i;
        continue;
      }
      if (p.indexTargetAsset == i) continue;

      (uint spent, uint received) = _swapToGetAmount(receivedAmounts[p.indexTargetAsset], p, v, i);
      spentAmounts[i] += spent;
      receivedAmounts[p.indexTargetAsset] += received;

      if (receivedAmounts[p.indexTargetAsset] >= p.targetAmount) break;
    }

    // swap underlying
    if (receivedAmounts[p.indexTargetAsset] < p.targetAmount && p.indexTargetAsset != indexUnderlying) {
      (uint spent, uint received) = _swapToGetAmount(receivedAmounts[p.indexTargetAsset], p, v, indexUnderlying);
      spentAmounts[indexUnderlying] += spent;
      receivedAmounts[p.indexTargetAsset] += received;
    }
  }

  /// @notice Swap a part of amount of asset {tokens[indexTokenIn]} to {targetAsset} to get {targetAmount} in result
  /// @param receivedTargetAmount Already received amount of {targetAsset} in previous swaps
  /// @param indexTokenIn Index of the tokenIn in p.tokens
  function _swapToGetAmount(
    uint receivedTargetAmount,
    SwapToGivenAmountInputParams memory p,
    CalcInvestedAssetsLocal memory v,
    uint indexTokenIn
  ) internal returns (
    uint amountSpent,
    uint amountReceived
  ) {
    if (p.amounts[indexTokenIn] != 0) {
      // we assume here, that p.targetAmount > receivedTargetAmount, see _swapToGivenAmount implementation

      // calculate amount that should be swapped
      // {overswap} allows to swap a bit more
      // to avoid additional swaps if the swap will give us a bit less amount than expected
      uint amountIn = (
        (p.targetAmount - receivedTargetAmount)
        * v.prices[p.indexTargetAsset] * v.decs[indexTokenIn]
        / v.prices[indexTokenIn] / v.decs[p.indexTargetAsset]
      ) * (p.overswap + DENOMINATOR) / DENOMINATOR;

      (amountSpent, amountReceived) = _liquidate(
        p.converter,
        p.liquidator,
        p.tokens[indexTokenIn],
        p.tokens[p.indexTargetAsset],
        Math.min(amountIn, p.amounts[indexTokenIn]),
        _ASSET_LIQUIDATION_SLIPPAGE,
        p.liquidationThresholds[indexTokenIn],
        false
      );
    }

    return (amountSpent, amountReceived);
  }
  //endregion requirePayAmountBack

  /////////////////////////////////////////////////////////////////////
  //region Recycle rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Recycle the amounts: split each amount on tree parts: performance+insurance (P), forwarder (F), compound (C)
  ///         Liquidate P+C, send F to the forwarder.
  /// We have two kinds of rewards:
  /// 1) rewards in depositor's assets (the assets returned by _depositorPoolAssets)
  /// 2) any other rewards
  /// All received rewards divided on three parts: to performance receiver+insurance, to forwarder, to compound
  ///   Compound-part of Rewards-2 can be liquidated
  ///   Compound part of Rewards-1 should be just left on the balance
  ///   All forwarder-parts are returned in amountsToForward and should be transferred to the forwarder outside.
  ///   Performance amounts are liquidated, result amount of underlying is returned in {amountToPerformanceAndInsurance}
  /// @param asset Underlying asset
  /// @param compoundRatio Compound ration in the range [0...COMPOUND_DENOMINATOR]
  /// @param tokens tokens received from {_depositorPoolAssets}
  /// @param rewardTokens Full list of reward tokens received from tetuConverter and depositor
  /// @param rewardAmounts Amounts of {rewardTokens_}; we assume, there are no zero amounts here
  /// @param liquidationThresholds Liquidation thresholds for rewards tokens
  /// @param performanceFee Performance fee in the range [0...FEE_DENOMINATOR]
  /// @return amountsToForward Amounts of {rewardTokens} to be sent to forwarder, zero amounts are allowed here
  /// @return amountToPerformanceAndInsurance Amount of underlying to be sent to performance receiver and insurance
  function recycle(
    ITetuConverter converter_,
    address asset,
    uint compoundRatio,
    address[] memory tokens,
    ITetuLiquidator liquidator,
    mapping(address => uint) storage liquidationThresholds,
    address[] memory rewardTokens,
    uint[] memory rewardAmounts,
    uint performanceFee
  ) external returns (
    uint[] memory amountsToForward,
    uint amountToPerformanceAndInsurance
  ) {
    RecycleLocalParams memory p;

    p.len = rewardTokens.length;
    require(p.len == rewardAmounts.length, AppErrors.WRONG_LENGTHS);

    amountsToForward = new uint[](p.len);

    // rewardAmounts => P + F + C, where P - performance + insurance, F - forwarder, C - compound
    for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
      p.amountFC = rewardAmounts[i] * (COMPOUND_DENOMINATOR - performanceFee) / COMPOUND_DENOMINATOR;
      p.amountC = p.amountFC * compoundRatio / COMPOUND_DENOMINATOR;
      p.amountP = rewardAmounts[i] - p.amountFC;
      p.rewardToken = rewardTokens[i];
      p.amountCP = p.amountC + p.amountP;

      if (p.amountCP > 0) {
        if (ConverterStrategyBaseLib.getAssetIndex(tokens, p.rewardToken) != type(uint).max) {
          if (p.rewardToken == asset) {
            // This is underlying, liquidation of compound part is not allowed; just keep on the balance, should be handled later
            amountToPerformanceAndInsurance += p.amountP;
          } else {
            // This is secondary asset, Liquidation of compound part is not allowed, we should liquidate performance part only
            // If the performance amount is too small, liquidation will not happen and we will just keep that dust tokens on balance forever
            (, p.receivedAmountOut) = _liquidate(
              converter_,
              liquidator,
              p.rewardToken,
              asset,
              p.amountP,
              _REWARD_LIQUIDATION_SLIPPAGE,
              liquidationThresholds[p.rewardToken],
              false // use conversion validation for these rewards
            );
            amountToPerformanceAndInsurance += p.receivedAmountOut;
          }
        } else {
          // If amount is too small, the liquidation won't be allowed and we will just keep that dust tokens on balance forever
          // The asset is not in the list of depositor's assets, its amount is big enough and should be liquidated
          // We assume here, that {token} cannot be equal to {_asset}
          // because the {_asset} is always included to the list of depositor's assets
          (, p.receivedAmountOut) = _liquidate(
            converter_,
            liquidator,
            p.rewardToken,
            asset,
            p.amountCP,
            _REWARD_LIQUIDATION_SLIPPAGE,
            liquidationThresholds[p.rewardToken],
            true // skip conversion validation for rewards becase we can have arbitrary assets here
          );
          amountToPerformanceAndInsurance += p.receivedAmountOut * (rewardAmounts[i] - p.amountFC) / p.amountCP;
        }
      }
      amountsToForward[i] = p.amountFC - p.amountC;
    }
    return (amountsToForward, amountToPerformanceAndInsurance);
  }
  //endregion Recycle rewards

  /////////////////////////////////////////////////////////////////////
  //region calcInvestedAssets
  /////////////////////////////////////////////////////////////////////

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
    CalcInvestedAssetsLocal memory v;
    v.len = tokens.length;

    // calculate prices, decimals
    (v.prices, v.decs) = _getPricesAndDecs(
      IPriceOracle(IConverterController(converter_.controller()).priceOracle()),
      tokens,
      v.len
    );
    // A debt is registered below if we have X amount of asset, need to pay Y amount of the asset and X < Y
    // In this case: debt = Y - X, the order of tokens is the same as in {tokens} array
    for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) {
        // Current strategy balance of main asset is not taken into account here because it's add by splitter
        amountOut += depositorQuoteExitAmountsOut[i];
      } else {
        // possible reverse debt: collateralAsset = tokens[i], borrowAsset = underlying
        (uint toPay, uint collateral) = converter_.getDebtAmountCurrent(
          address(this),
          tokens[i],
          tokens[indexAsset],
          // investedAssets is calculated using exact debts, debt-gaps are not taken into account
          false
        );
        if (amountOut < toPay) {
          setDebt(v, indexAsset, toPay);
        } else {
          amountOut -= toPay;
        }

        // available amount to repay
        uint toRepay = collateral + IERC20(tokens[i]).balanceOf(address(this)) + depositorQuoteExitAmountsOut[i];

        // direct debt: collateralAsset = underlying, borrowAsset = tokens[i]
        (toPay, collateral) = converter_.getDebtAmountCurrent(
          address(this),
          tokens[indexAsset],
          tokens[i],
          // investedAssets is calculated using exact debts, debt-gaps are not taken into account
          false
        );
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
  //endregion calcInvestedAssets

  /////////////////////////////////////////////////////////////////////
  //region getExpectedAmountMainAsset
  /////////////////////////////////////////////////////////////////////

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
  //endregion getExpectedAmountMainAsset

  /////////////////////////////////////////////////////////////////////
  //region Reduce size of ConverterStrategyBase
  /////////////////////////////////////////////////////////////////////

  /// @notice Make borrow and save amounts of tokens available for deposit to tokenAmounts
  /// @param thresholdMainAsset_ Min allowed value of collateral in terms of main asset, 0 - use default min value
  /// @param tokens_ Tokens received from {_depositorPoolAssets}
  /// @param collaterals_ Amounts of main asset that can be used as collateral to borrow {tokens_}
  /// @param thresholdMainAsset_ Value of liquidation threshold for the main (collateral) asset
  /// @return tokenAmountsOut Amounts available for deposit
  function getTokenAmounts(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory collaterals_,
    uint thresholdMainAsset_
  ) external returns (
    uint[] memory tokenAmountsOut
  ) {
    // content of tokenAmounts will be modified in place
    uint len = tokens_.length;
    tokenAmountsOut = new uint[](len);

    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i != indexAsset_) {
        if (collaterals_[i] != 0) {
          AppLib.approveIfNeeded(tokens_[indexAsset_], collaterals_[i], address(tetuConverter_));
          _openPosition(
            tetuConverter_,
            "", // entry kind = 0: fixed collateral amount, max possible borrow amount
            tokens_[indexAsset_],
            tokens_[i],
            collaterals_[i],
            Math.max(thresholdMainAsset_, DEFAULT_LIQUIDATION_THRESHOLD)
          );

          // zero borrowed amount is possible here (conversion is not available)
          // if it's not suitable for depositor, the depositor should check zero amount in other places
        }
        tokenAmountsOut[i] = IERC20(tokens_[i]).balanceOf(address(this));
      }
    }

    tokenAmountsOut[indexAsset_] = Math.min(
      collaterals_[indexAsset_],
      IERC20(tokens_[indexAsset_]).balanceOf(address(this))
    );
  }

  /// @notice Convert {amountsToConvert_} to the main {asset}
  ///         Swap leftovers (if any) to the main asset.
  ///         If result amount is less than expected, try to close any other available debts (1 repay per block only)
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @param requestedAmount Total amount of main asset that we need to receive on balance (to be withdrawn).
  ///                        Max uint means attempt to withdraw all possible invested assets.
  /// @param amountsToConvert_ Amounts available for conversion after withdrawing from the pool
  /// @param expectedMainAssetAmounts Amounts of main asset that we expect to receive after conversion amountsToConvert_
  /// @return expectedAmount Expected total amount of main asset after all conversions, swaps and repays
  function makeRequestedAmount(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_,
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    uint requestedAmount,
    uint[] memory expectedMainAssetAmounts,
    mapping(address => uint) storage liquidationThresholds_
  ) external returns (uint expectedAmount) {
    DataSetLocal memory v = DataSetLocal({
      len: tokens_.length,
      converter: converter_,
      tokens: tokens_,
      indexAsset: indexAsset_,
      liquidator: liquidator_
    });
    return _makeRequestedAmount(v, amountsToConvert_, requestedAmount, expectedMainAssetAmounts, liquidationThresholds_);
  }

  function _makeRequestedAmount(
    DataSetLocal memory d_,
    uint[] memory amountsToConvert_,
    uint requestedAmount,
    uint[] memory expectedMainAssetAmounts,
    mapping(address => uint) storage liquidationThresholds_
  ) internal returns (uint expectedAmount) {
    console.log("makeRequestedAmount requestedAmount", requestedAmount);
    console.log("makeRequestedAmount amountsToConvert_", amountsToConvert_[0], amountsToConvert_[1]);
    console.log("makeRequestedAmount expectedMainAssetAmounts[d_.indexAsset]", expectedMainAssetAmounts[d_.indexAsset]);

    // get the total expected amount
    for (uint i; i < d_.len; i = AppLib.uncheckedInc(i)) {
      expectedAmount += expectedMainAssetAmounts[i];
    }

    uint[] memory _liquidationThresholds = _getLiquidationThresholds(liquidationThresholds_, d_.tokens, d_.len);

    // we shouldn't repay a debt twice, it's inefficient
    // suppose, we have usdt = 1 and we need to convert it to usdc, then get additional usdt=10 and make second repay
    // But: we shouldn't make repay(1) and than repay(10), we should make single repay(11)
    // Note: AAVE3 allows to make two repays in a single block, see Aave3SingleBlockTest in TetuConverter
    //       but it doesn't allow to make borrow and repay in a single block.

    if (requestedAmount != type(uint).max
      && expectedAmount > requestedAmount * (GAP_CONVERSION + DENOMINATOR) / DENOMINATOR
    ) {
      console.log("makeRequestedAmount requestedAmount.1");
      // amountsToConvert_ are enough to get requestedAmount
      _convertAfterWithdraw(d_, _liquidationThresholds, amountsToConvert_);
    } else {
      console.log("makeRequestedAmount requestedAmount.2.requestedAmount", requestedAmount);

      uint balance = IERC20(d_.tokens[d_.indexAsset]).balanceOf(address(this));
      console.log("makeRequestedAmount requestedAmount.balance", balance);
      requestedAmount = requestedAmount > balance
        ? requestedAmount - balance
        : 0;
      console.log("makeRequestedAmount requestedAmount.fixed.requestedAmount", requestedAmount);

      // amountsToConvert_ are NOT enough to get requestedAmount
      // We are allowed to make only one repay per block, so, we shouldn't try to convert amountsToConvert_
      // We should try to close the exist debts instead:
      //    convert a part of main assets to get amount of secondary assets required to repay the debts
      // and only then make conversion.
      expectedAmount = _closePositionsToGetAmount(d_, _liquidationThresholds, requestedAmount);
      console.log("makeRequestedAmount.expectedAmount.1", expectedAmount);

      expectedAmount += expectedMainAssetAmounts[d_.indexAsset];
      console.log("makeRequestedAmount.expectedAmount.2", expectedAmount);
    }

    return expectedAmount;
  }
  //endregion Reduce size of ConverterStrategyBase

//region ------------------------------------------------ Withdraw helpers

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

//endregion ------------------------------------ Withdraw helpers

//region ------------------------------------------------ convertAfterWithdraw

  /// @notice Convert {amountsToConvert_} (available on balance) to the main asset
  ///         Swap leftovers if any.
  ///         Result amount can be less than requested one, we don't try to close any other debts here
  /// @param liquidationThreshold_ Min allowed amount of main asset to be liquidated in {liquidator} for {tokens}
  /// @param amountsToConvert Amounts to convert, the order of asset is same as in {tokens}
  /// @return collateralOut Total amount of main asset returned after closing positions
  /// @return repaidAmountsOut What amounts were spent in exchange of the {collateralOut}
  function _convertAfterWithdraw(
    DataSetLocal memory d_,
    uint[] memory liquidationThreshold_,
    uint[] memory amountsToConvert
  ) internal returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    ConvertAfterWithdrawLocal memory v;
    v.asset = d_.tokens[d_.indexAsset];
    v.balanceBefore = IERC20(v.asset).balanceOf(address(this));
    v.len = d_.tokens.length;

    // Close positions to convert all required amountsToConvert
    repaidAmountsOut = new uint[](d_.tokens.length);
    for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
      if (i == d_.indexAsset || amountsToConvert[i] == 0) continue;
      (, repaidAmountsOut[i]) = _closePosition(d_.converter, v.asset, d_.tokens[i], amountsToConvert[i]);
    }

    // Manually swap remain leftovers
    for (uint i; i < v.len; i = AppLib.uncheckedInc(i)) {
      if (i == d_.indexAsset || amountsToConvert[i] == 0) continue;
      if (amountsToConvert[i] > repaidAmountsOut[i]) {
        (v.spent, v.received) = _liquidate(
          d_.converter,
          d_.liquidator,
          d_.tokens[i],
          v.asset,
          amountsToConvert[i] - repaidAmountsOut[i],
          _ASSET_LIQUIDATION_SLIPPAGE,
          liquidationThreshold_[i],
          false
        );
        collateralOut += v.received;
        repaidAmountsOut[i] += v.spent;
      }
    }

    // Calculate amount of received collateral
    v.balance = IERC20(v.asset).balanceOf(address(this));
    collateralOut = v.balance > v.balanceBefore
      ? v.balance - v.balanceBefore
      : 0;

    return (collateralOut, repaidAmountsOut);
  }
//endregion ------------------------------------------------ convertAfterWithdraw

//region ------------------------------------------------ Close position
  /// @notice Close debts (if it's allowed) in converter until we don't have {requestedAmount} on balance
  /// @dev We assume here that this function is called before closing any positions in the current block
  /// @param liquidationThresholds Min allowed amounts-out for liquidations
  /// @param requestedAmount Requested amount of main asset that should be added to the current balance
  /// @return expectedAmount Main asset amount expected to be received on balance after all conversions and swaps
  function closePositionsToGetAmount(
    ITetuConverter converter_,
    ITetuLiquidator liquidator,
    uint indexAsset,
    mapping(address => uint) storage liquidationThresholds,
    uint requestedAmount,
    address[] memory tokens
  ) external returns (uint expectedAmount) {
    uint len = tokens.length;
    return _closePositionsToGetAmount(
      DataSetLocal({
        len: len,
        converter: converter_,
        tokens: tokens,
        indexAsset: indexAsset,
        liquidator: liquidator
      }),
      _getLiquidationThresholds(liquidationThresholds, tokens, len),
      requestedAmount
    );
  }

  function _closePositionsToGetAmount(
    DataSetLocal memory d_,
    uint[] memory liquidationThresholds_,
    uint requestedAmount
  ) internal returns (
    uint expectedAmount
  ) {
    console.log("_closePositionsToGetAmount.balance.initial.tokens[0]", IERC20(d_.tokens[0]).balanceOf(address(this)));
    console.log("_closePositionsToGetAmount.balance.initial.tokens[1]", IERC20(d_.tokens[1]).balanceOf(address(this)));

    if (requestedAmount != 0) {
      CloseDebtsForRequiredAmountLocal memory v;
      v.asset = d_.tokens[d_.indexAsset];

      PlanInputParams memory p;
      p.converter = d_.converter;
      p.tokens = d_.tokens;
      p.liquidationThresholds = liquidationThresholds_;

      (p.prices, p.decs) = _getPricesAndDecs(
        IPriceOracle(IConverterController(d_.converter.controller()).priceOracle()),
        d_.tokens,
        d_.len
      );


      for (uint i; i < d_.len; i = AppLib.uncheckedInc(i)) {
        console.log("_closePositionsToGetAmount.i", i);
        if (i == d_.indexAsset) continue;

        v.balanceAsset = IERC20(v.asset).balanceOf(address(this));
        v.balanceToken = IERC20(d_.tokens[i]).balanceOf(address(this));
        bool changed;

        // Make one or several iterations. Do single swap and single repaying (both are optional) on each iteration.
        // Calculate expectedAmount of received underlying. Swap leftovers at the end even if requestedAmount is 0 at that moment.
        do {
          console.log("_closePositionsToGetAmount.while.balances.asset,token", v.balanceAsset, v.balanceToken);
          console.log("v.balanceAsset", v.balanceAsset);
          console.log("v.balanceToken", v.balanceToken);

          // generate iteration plan: [swap], [repay]
          (v.idxToSwap1, v.amountToSwap, v.idxToRepay1) = _buildIterationPlan(p, requestedAmount, d_.indexAsset, i);
          if (v.idxToSwap1 == 0 && v.idxToRepay1 == 0) break;

          // make swap if necessary
          uint spentAmountIn;
          if (v.idxToSwap1 != 0) {
            uint indexIn = v.idxToSwap1 - 1;
            uint indexOut = indexIn == d_.indexAsset ? i : d_.indexAsset;
            (spentAmountIn,) = _liquidate(
              d_.converter,
              d_.liquidator,
              d_.tokens[indexIn],
              d_.tokens[indexOut],
              v.amountToSwap,
              _ASSET_LIQUIDATION_SLIPPAGE,
              p.liquidationThresholds[indexIn],
              false
            );
            console.log("SWAP.v.amountToSwap", v.amountToSwap);
            console.log("SWAP.spentAmountIn", spentAmountIn);
            if (spentAmountIn != 0 && indexIn == i && v.idxToRepay1 == 0) {
              // spentAmountIn can be zero if token balance is less than liquidationThreshold
              // we need to calculate expectedAmount only if not-underlying-leftovers are swapped to underlying
              // we don't need to take into account conversion to get toSell amount
              expectedAmount += spentAmountIn * p.prices[i] * p.decs[d_.indexAsset] / p.prices[d_.indexAsset] / p.decs[i];
              console.log("SWAP.expectedAmount+", spentAmountIn * p.prices[i] * p.decs[d_.indexAsset] / p.prices[d_.indexAsset] / p.decs[i]);
              console.log("SWAP.expectedAmount", expectedAmount);
            }
          }

          // repay a debt if necessary
          if (v.idxToRepay1 != 0) {
            uint indexBorrow = v.idxToRepay1 - 1;
            uint indexCollateral = indexBorrow == d_.indexAsset ? i : d_.indexAsset;
            console.log("REPAY.indexBorrow, indexCollateral", indexBorrow, indexCollateral);
            console.log("REPAY.tokenBalance", IERC20(p.tokens[indexBorrow]).balanceOf(address(this)));
            uint expectedAmountOut = ConverterStrategyBaseLib._repayDebt(
              p.converter,
              p.tokens[indexCollateral],
              p.tokens[indexBorrow],
              IERC20(p.tokens[indexBorrow]).balanceOf(address(this))
            );
            console.log("REPAY.expectedAmountOut", expectedAmountOut);

            if (indexCollateral == d_.indexAsset) {
              require(expectedAmountOut >= spentAmountIn, AppErrors.BALANCE_DECREASE);
              expectedAmount += expectedAmountOut - spentAmountIn;
              console.log("REPAY.expectedAmount+", expectedAmountOut - spentAmountIn);
              console.log("REPAY.expectedAmount", expectedAmount);
            }
          }

          // update balances and requestedAmount
          v.newBalanceAsset = IERC20(v.asset).balanceOf(address(this));
          v.newBalanceToken = IERC20(d_.tokens[i]).balanceOf(address(this));
          console.log("v.newBalanceAsset", v.newBalanceAsset);
          console.log("v.newBalanceToken", v.newBalanceToken);

          if (v.newBalanceAsset > v.balanceAsset) {
            requestedAmount = requestedAmount > v.newBalanceAsset - v.balanceAsset
              ? requestedAmount - (v.newBalanceAsset - v.balanceAsset)
              : 0;
          }

          changed = (v.balanceAsset == v.newBalanceAsset && v.balanceToken == v.newBalanceToken);
          v.balanceAsset = v.newBalanceAsset;
          v.balanceToken = v.newBalanceToken;
        }
        while (!changed);

        if (requestedAmount < _getLiquidationThreshold(p.liquidationThresholds[d_.indexAsset])) break;
      }
    }

    console.log("_closePositionsToGetAmount.balance.final.tokens[0]", IERC20(d_.tokens[0]).balanceOf(address(this)));
    console.log("_closePositionsToGetAmount.balance.final.tokens[1]", IERC20(d_.tokens[1]).balanceOf(address(this)));
    console.log("_closePositionsToGetAmount.expectedAmount.final", expectedAmount);
    return expectedAmount;
  }
//endregion ------------------------------------------------ Close position

//region ------------------------------------------------ Build plan
  /// @notice Generate plan for next withdraw iteration. We can do only one swap per iteration.
  ///         In general, we cam make 1) single swap (direct or reverse) and 2) repay
  ///         Swap is required to get required repay-amount OR to swap leftovers on final iteration.
  /// @param requestedAmount Amount of underlying that we need to get on balance finally.
  /// @param indexAsset Index of the underlying in {p.tokens} array
  /// @param indexToken Index of the not-underlying in {p.tokens} array
  /// @return indexTokenToSwapPlus1 1-based index of the token to be swapped; 0 means swap is not required.
  /// @return amountToSwap Amount to be swapped. 0 - no swap
  /// @return indexRepayTokenPlus1 1-based index of the token that should be used to repay borrow in converter.
  ///                              0 - no repay is required - it means that this is a last step with swapping leftovers.
  function _buildIterationPlan(
    PlanInputParams memory p,
    uint requestedAmount,
    uint indexAsset,
    uint indexToken
  ) internal returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap,
    uint indexRepayTokenPlus1
  ) {
    GetIterationPlanLocal memory v;

    v.assetBalance = IERC20(p.tokens[indexAsset]).balanceOf(address(this));
    v.tokenBalance = IERC20(p.tokens[indexToken]).balanceOf(address(this));

    if (requestedAmount < _getLiquidationThreshold(p.liquidationThresholds[indexAsset])) {
      // we don't need to repay any debts anymore, but we should swap leftovers
      (indexTokenToSwapPlus1, amountToSwap) = _buildPlanForLeftovers(p, v.assetBalance, v.tokenBalance, indexAsset, indexToken);
    } else {
      // we need to increase balance on the following amount: requestedAmount - v.balance;
      // we can have two possible borrows:
      // 1) direct (p.tokens[INDEX_ASSET] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[INDEX_ASSET])
      // normally we can have only one of them, not both..
      // but better to take into account possibility to have two debts simultaneously

      // reverse debt
      (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(
        address(this),
        p.tokens[indexToken],
        p.tokens[indexAsset],
        true
      );
      console.log("_closePositionsToGetAmount.reverse.debt,collateral", v.debtReverse, v.collateralReverse);

      if (v.debtReverse == 0) {
        // direct debt
        (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(
          address(this),
          p.tokens[indexAsset],
          p.tokens[indexToken],
          true
        );
        console.log("_closePositionsToGetAmount.direct.debt,collateral", v.totalDebt, v.totalCollateral);

        if (v.totalDebt == 0) {
          // This is final iteration - we need to swap leftovers and get amounts on balance in proper propotions.
          // The leftovers should be swapped to get following result proportions of the assets:
          //      underlying : not-underlying === 1e18 - propNotUnderlying18 : propNotUnderlying18
          (indexTokenToSwapPlus1, amountToSwap) = _buildPlanForLeftovers(p, v.assetBalance, v.tokenBalance, indexAsset, indexToken);
        } else {
          console.log("_closePositionsToGetAmount.repay.direct.debt");
          // repay direct debt
          (indexTokenToSwapPlus1, amountToSwap, indexRepayTokenPlus1) = _buildPlanForRepay(
            requestedAmount,
            p,
            v.totalCollateral,
            v.totalDebt,
            indexAsset,
            indexToken,
            v.assetBalance,
            v.tokenBalance
          );
        }
      } else {
        console.log("_closePositionsToGetAmount.repay.REVERSE.debt");
        // repay reverse debt
        (indexTokenToSwapPlus1, amountToSwap, indexRepayTokenPlus1) = _buildPlanForRepay(
          requestedAmount == type(uint).max
            ? type(uint).max
            : requestedAmount * p.prices[indexAsset] * p.decs[indexToken] / p.prices[indexToken] / p.decs[indexAsset],
          p,
          v.collateralReverse,
          v.debtReverse,
          indexToken,
          indexAsset,
          v.tokenBalance,
          v.assetBalance
        );
      }
    }

    return (indexTokenToSwapPlus1, amountToSwap, indexRepayTokenPlus1);
  }

  /// @notice Prepare a plan to swap leftovers to required proportion
  function _buildPlanForLeftovers(
    PlanInputParams memory p,
    uint assetBalance,
    uint tokenBalance,
    uint indexAsset,
    uint indexToken
  ) internal returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap
  ) {
    if (tokenBalance != 0) {
      console.log("_closePositionsToGetAmount.swap.leftovers.balances.assets,tokens", assetBalance, tokenBalance);
      (uint targetAssets, uint targetTokens) = _getTargetAmounts(
        p.prices,
        p.decs,
        assetBalance,
        tokenBalance,
        p.propNotUnderlying18,
        indexAsset,
        indexToken
      );

      if (assetBalance < targetAssets) {
        // we need to swap not-underlying to underlying
        if (tokenBalance - targetTokens > _getLiquidationThreshold(p.liquidationThresholds[indexToken])) {
          amountToSwap = tokenBalance - targetTokens;
          indexTokenToSwapPlus1 = indexToken + 1;
        }
      } else {
        // we need to swap underlying to not-underlying
        if (assetBalance - targetAssets > _getLiquidationThreshold(p.liquidationThresholds[indexAsset])) {
          amountToSwap = assetBalance - targetAssets;
          indexTokenToSwapPlus1 = indexAsset + 1;
        }
      }
    }
    return (indexTokenToSwapPlus1, amountToSwap);
  }

  /// @notice Prepare a plan to swap some amount of collateral to get required repay-amount and make repaying
  function _buildPlanForRepay(
    uint requestedAmount,
    PlanInputParams memory p,
    uint totalCollateral,
    uint totalDebt,
    uint indexCollateral,
    uint indexBorrow,
    uint balanceCollateral,
    uint balanceBorrow
  ) internal returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap,
    uint indexRepayTokenPlus1
  ) {
    // what amount of collateral we should sell to get required amount-to-pay to pay the debt
    uint toSell = ConverterStrategyBaseLib._getAmountToSell(
      requestedAmount,
      totalDebt,
      totalCollateral,
      p.prices,
      p.decs,
      indexCollateral,
      indexBorrow,
      balanceBorrow
    );
    console.log("_closePositionsToGetAmount.xxx.toSell,balanceCollateral", toSell, balanceCollateral);

    // convert {toSell} amount of underlying to token
    if (toSell != 0 && balanceCollateral != 0) {
      toSell = Math.min(toSell, balanceCollateral);
      console.log("_closePositionsToGetAmount.toSell.corrected", toSell);
      if (toSell > _getLiquidationThreshold(p.liquidationThresholds[indexCollateral])) {
        amountToSwap = toSell;
        indexTokenToSwapPlus1 = indexCollateral + 1;
      }
    }

    return (indexTokenToSwapPlus1, amountToSwap, indexBorrow + 1);
  }

  /// @notice Calculate what balances of underlying and not-underlying we need to fit {propNotUnderlying18}
  /// @param prices Prices of underlying and not underlying
  /// @param decs 10**decimals for underlying and not underlying
  /// @param assetBalance Current balance of underlying
  /// @param tokenBalance Current balance of not-underlying
  /// @param propNotUnderlying18 Required proportion of not-underlying [0..1e18]
  ///                            Proportion of underlying would be (1e18 - propNotUnderlying18)
  function _getTargetAmounts(
    uint[] memory prices,
    uint[] memory decs,
    uint assetBalance,
    uint tokenBalance,
    uint propNotUnderlying18,
    uint indexAsset,
    uint indexToken
  ) internal pure returns (
    uint targetAssets,
    uint targetTokens
  ) {
    uint costAssets = assetBalance * prices[indexAsset] / decs[indexAsset];
    uint costTokens = tokenBalance * prices[indexToken] / decs[indexToken];
    targetTokens = propNotUnderlying18 == 0
      ? 0
      : ((costAssets + costTokens) * propNotUnderlying18 / 1e18);
    targetAssets = ((costAssets + costTokens) - targetTokens) * decs[indexAsset] / prices[indexAsset];
    targetTokens *= decs[indexToken] / prices[indexToken];
  }

  /// @notice What amount of collateral should be sold to pay the debt and receive {requestedAmount}
  /// @dev It doesn't allow to sell more than the amount of total debt in the borrow
  /// @param requestedAmount We need to increase balance (of collateral asset) on this amount
  /// @param totalDebt Total debt of the borrow in terms of borrow asset
  /// @param totalCollateral Total collateral of the borrow in terms of collateral asset
  /// @param prices Cost of $1 in terms of the asset, decimals 18
  /// @param decs 10**decimals for each asset
  /// @param indexCollateral Index of the collateral asset in {prices} and {decs}
  /// @param indexBorrowAsset Index of the borrow asset in {prices} and {decs}
  /// @param balanceBorrowAsset Available balance of the borrow asset, it will be used to cover the debt
  function _getAmountToSell(
    uint requestedAmount,
    uint totalDebt,
    uint totalCollateral,
    uint[] memory prices,
    uint[] memory decs,
    uint indexCollateral,
    uint indexBorrowAsset,
    uint balanceBorrowAsset
  ) internal view returns (
    uint amountOut
  ) {
    if (totalDebt != 0) {
      if (balanceBorrowAsset != 0) {
        // there is some borrow asset on balance
        // it will be used to cover the debt
        // let's reduce the size of totalDebt/Collateral to exclude balanceBorrowAsset
        uint sub = Math.min(balanceBorrowAsset, totalDebt);
        totalCollateral -= totalCollateral * sub / totalDebt;
        totalDebt -= sub;
      }

      // for definiteness: usdc - collateral asset, dai - borrow asset
      // Pc = price of the USDC, Pb = price of the DAI, alpha = Pc / Pb [DAI / USDC]
      // S [USDC] - amount to sell, R [DAI] = alpha * S - amount to repay
      // After repaying R we get: alpha * S * C / R
      // Balance should be increased on: requestedAmount = alpha * S * C / R - S
      // So, we should sell: S = requestedAmount / (alpha * C / R - 1))
      // We can lost some amount on liquidation of S => R, so we need to use some gap = {GAP_AMOUNT_TO_SELL}
      // Same formula: S * h = S + requestedAmount, where h = health factor => s = requestedAmount / (h - 1)
      // h = alpha * C / R
      uint alpha18 = prices[indexCollateral] * decs[indexBorrowAsset] * 1e18
        / prices[indexBorrowAsset] / decs[indexCollateral];

      // if totalCollateral is zero (liquidation happens) we will have zero amount (the debt shouldn't be paid)
      amountOut = totalDebt != 0 && alpha18 * totalCollateral / totalDebt > 1e18
        ? Math.min(requestedAmount, totalCollateral) * 1e18 / (alpha18 * totalCollateral / totalDebt - 1e18)
        : 0;

      if (amountOut != 0) {
        // we shouldn't try to sell amount greater than amount of totalDebt in terms of collateral asset
        // but we always asks +1% because liquidation results can be different a bit from expected
        amountOut = (GAP_CONVERSION + DENOMINATOR) * Math.min(amountOut, totalDebt * 1e18 / alpha18) / DENOMINATOR;
      }
    }

    return amountOut;
  }
//endregion ------------------------------------------------ Build plan

//region ------------------------------------------------ Repay debts
  /// @notice Repay {amountIn} and get collateral in return, calculate expected amount
  ///         Take into account possible debt-gap and the fact that the amount of debt may be less than {amountIn}
  /// @param amountToRepay Max available amount of borrow asset that we can repay
  /// @return expectedAmountOut Estimated amount of main asset that should be added to balance = collateral - {toSell}
  function _repayDebt(
    ITetuConverter converter,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) internal returns (
    uint expectedAmountOut
  ) {
    console.log("_repayDebt.collateralAsset,borrowAsset,amountToRepay", collateralAsset, borrowAsset, amountToRepay);
    uint balanceBefore = IERC20(borrowAsset).balanceOf(address(this));

    // get amount of debt with debt-gap
    (uint needToRepay,) = converter.getDebtAmountCurrent(address(this), collateralAsset, borrowAsset, true);
    uint amountRepay = Math.min(amountToRepay < needToRepay ? amountToRepay : needToRepay, balanceBefore);

    // get expected amount without debt-gap
    uint swappedAmountOut;
    (expectedAmountOut, swappedAmountOut) = converter.quoteRepay(address(this), collateralAsset, borrowAsset, amountRepay);

    if (expectedAmountOut > swappedAmountOut) {
      // Following situation is possible
      //    needToRepay = 100, needToRepayExact = 90 (debt gap is 10)
      //    1) amountRepay = 80
      //       expectedAmountOut is calculated for 80, no problems
      //    2) amountRepay = 99,
      //       expectedAmountOut is calculated for 90 + 9 (90 - repay, 9 - direct swap)
      //       expectedAmountOut must be reduced on 9 here (!)
      expectedAmountOut -= swappedAmountOut;
    }

    // close the debt
    _closePositionExact(converter, collateralAsset, borrowAsset, amountRepay, balanceBefore);

    return expectedAmountOut;
  }
  //endregion ------------------------------------------------ Repay debts

  /////////////////////////////////////////////////////////////////////
  //region Other helpers
  /////////////////////////////////////////////////////////////////////

  function getAssetPriceFromConverter(ITetuConverter converter, address token) external view returns (uint) {
    return IPriceOracle(IConverterController(converter.controller()).priceOracle()).getAssetPrice(token);
  }

  function registerIncome(uint assetBefore, uint assetAfter) internal pure returns (uint earned, uint lost) {
    if (assetAfter > assetBefore) {
      earned = assetAfter - assetBefore;
    } else {
      lost = assetBefore - assetAfter;
    }
    return (earned, lost);
  }

  /// @notice Register income and cover possible loss
  function coverPossibleStrategyLoss(uint assetBefore, uint assetAfter, address splitter) external returns (uint earned) {
    uint lost;
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetBefore, assetAfter);
    if (lost != 0) {
      ISplitter(splitter).coverPossibleStrategyLoss(earned, lost);
    }
    emit FixPriceChanges(assetBefore, assetAfter);
  }

  function _getLiquidationThreshold(uint threshold) internal pure returns (uint) {
    return threshold > DEFAULT_LIQUIDATION_THRESHOLD
      ? threshold
      : DEFAULT_LIQUIDATION_THRESHOLD;
  }

  //endregion Other helpers
}

