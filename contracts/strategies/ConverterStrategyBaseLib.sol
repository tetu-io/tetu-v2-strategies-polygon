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
import "../libs/IterationPlanKinds.sol";
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

  struct SwapToGetAmountLocal {
    uint len;
    uint[] prices;
    uint[] decs;
  }

  struct ConvertAfterWithdrawLocal {
    address asset;
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

    uint newBalanceAsset;
    uint newBalanceToken;

    uint idxToSwap1;
    uint amountToSwap;
    uint idxToRepay1;
  }

  /// @notice Set of parameters required to liquidation through aggregators
  struct SwapRepayPlanParams {
    ITetuConverter converter;

    /// @notice Assets used by depositor stored as following way: [underlying, not-underlying]
    address[] tokens;

    /// @notice Liquidation thresholds for the {tokens}
    uint[] liquidationThresholds;

    /// @notice Cost of $1 in terms of the assets, decimals 18
    uint[] prices;
    /// @notice 10**decimal for the assets
    uint[] decs;

    /// @notice Amounts that will be received on balance before execution of the plan.
    uint[] balanceAdditions;

    /// @notice Plan kind extracted from entry data, see {IterationPlanKinds}
    uint planKind;

    /// @notice Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
    ///         The leftovers should be swapped to get following result proportions of the assets:
    ///         not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
    uint propNotUnderlying18;
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

    address asset;
    address token;

    bool swapLeftoversNeeded;
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

  struct RecycleLocal {
    /// @notice // total amount for the performance receiver and insurance
    uint amountPerf;
    uint toPerf;
    uint toInsurance;
    uint[] amountsToForward;
  }

  struct EstimateSwapAmountForRepaySwapRepayLocal {
    uint x;
    uint y;
    uint bA1;
    uint bB1;
    uint bA2;
    uint bB2;
    uint gamma;
    uint alpha;
    uint s;
    uint aB3;
    uint cA1;
    uint cB1;
    uint aA2;
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

  /// @notice Recycle was made
  /// @param rewardTokens Full list of reward tokens received from tetuConverter and depositor
  /// @param amountsToForward Amounts to be sent to forwarder
  event Recycle(
    address[] rewardTokens,
    uint[] amountsToForward,
    uint toPerf,
    uint toInsurance
  );
  //endregion Events

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
    ITetuConverter converter_,
    address collateralAsset_,
    address borrowAsset_
  ) internal view returns (uint){
    IPriceOracle priceOracle = AppLib._getPriceOracle(converter_);
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
    address theAsset = tokens[indexTheAsset];
    uint[] memory thresholds = _getLiquidationThresholds(liquidationThresholds, tokens, tokens.length);

    // msg.sender == converter; we assume here that it was checked before the call of this function
    amountOut = IERC20(theAsset).balanceOf(address(this));

    // convert withdrawn assets to the target asset if not enough
    if (amountOut < amount_) {
      ConverterStrategyBaseLib.swapToGivenAmount(
        amount_ - amountOut,
        tokens,
        indexTheAsset,
        asset, // underlying === main asset
        ITetuConverter(converter),
        AppLib._getLiquidator(controller),
        thresholds,
        OVERSWAP
      );
      amountOut = IERC20(theAsset).balanceOf(address(this));
    }

    // we should send the asset as is even if it is lower than requested
    // but shouldn't sent more amount than requested
    amountOut = Math.min(amount_, amountOut);
    if (amountOut != 0) {
      IERC20(theAsset).safeTransfer(converter, amountOut);
    }

    // There are two cases of calling requirePayAmountBack by converter:
    // 1) close a borrow: we will receive collateral back and amount of investedAssets almost won't change
    // 2) rebalancing: we have real loss, it will be taken into account at next hard work
    emit ReturnAssetToConverter(theAsset, amountOut);

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
    SwapToGetAmountLocal memory v;
    v.len = p.tokens.length;
    receivedAmounts = new uint[](v.len);
    spentAmounts = new uint[](v.len);

    // calculate prices, decimals
    (v.prices, v.decs) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(p.converter), p.tokens, v.len);

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
    SwapToGetAmountLocal memory v,
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

//region--------------------------------------------------- Recycle rewards

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  /// We have two kinds of rewards:
  /// 1) rewards in depositor's assets (the assets returned by _depositorPoolAssets)
  /// 2) any other rewards
  /// All received rewards divided on three parts: to performance receiver+insurance, to forwarder, to compound
  ///   Compound-part of Rewards-2 can be liquidated
  ///   Compound part of Rewards-1 should be just left on the balance
  ///   Performance amounts should be liquidate, result underlying should be sent to performance receiver and insurance.
  ///   All forwarder-parts are returned in amountsToForward and should be transferred to the forwarder outside.
  /// @dev {_recycle} is implemented as separate (inline) function to simplify unit testing
  /// @param rewardTokens_ Full list of reward tokens received from tetuConverter and depositor
  /// @param rewardAmounts_ Amounts of {rewardTokens_}; we assume, there are no zero amounts here
  /// @param feesAndRatios [compoundRatio, performanceFee, performanceFeeRatio]
  ///                      Three values were combined to single array to avoid stack-too-deep in coverage
  /// @return Amounts sent to the forwarder
  function recycle(
    ITetuConverter converter,
    address asset,
    address[] memory tokens,
    address controller,
    mapping(address => uint) storage liquidationThresholds,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_,
    address splitter,
    address performanceReceiver,
    uint[3] memory feesAndRatios
  ) external returns (uint[] memory){
    RecycleLocal memory v;
    (v.amountsToForward, v.amountPerf) = _recycle(
      converter,
      asset,
      feesAndRatios[0], // compoundRatio
      tokens,
      AppLib._getLiquidator(controller),
      liquidationThresholds,
      rewardTokens_,
      rewardAmounts_,
      feesAndRatios[1] // performanceFee
    );

    // send performance-part of the underlying to the performance receiver and insurance
    (v.toPerf, v.toInsurance) = _sendPerformanceFee(
      asset,
      v.amountPerf,
      splitter,
      performanceReceiver,
      feesAndRatios[2] // performanceFeeRatio
    );

    _sendTokensToForwarder(controller, splitter, rewardTokens_, v.amountsToForward);

    emit Recycle(rewardTokens_, v.amountsToForward, v.toPerf, v.toInsurance);
    return v.amountsToForward;
  }

  /// @notice Send {amount_} of {asset_} to {receiver_} and insurance
  /// @param asset_ Underlying asset
  /// @param amount_ Amount of underlying asset to be sent to
  /// @param receiver_ Performance receiver
  /// @param ratio [0..100_000], 100_000 - send full amount to perf, 0 - send full amount to the insurance.
  function _sendPerformanceFee(address asset_, uint amount_, address splitter, address receiver_, uint ratio) internal returns (
    uint toPerf,
    uint toInsurance
  ) {
    // read inside lib for reduce contract space in the main contract
    address insurance = address(ITetuVaultV2(ISplitter(splitter).vault()).insurance());

    toPerf = amount_ * ratio / DENOMINATOR;
    toInsurance = amount_ - toPerf;

    if (toPerf != 0) {
      IERC20(asset_).safeTransfer(receiver_, toPerf);
    }
    if (toInsurance != 0) {
      IERC20(asset_).safeTransfer(insurance, toInsurance);
    }
  }

  function _sendTokensToForwarder(
    address controller_,
    address splitter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) internal {
    uint len = tokens_.length;
    IForwarder forwarder = IForwarder(IController(controller_).forwarder());
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      AppLib.approveIfNeeded(tokens_[i], amounts_[i], address(forwarder));
    }

    (tokens_, amounts_) = TokenAmountsLib.filterZeroAmounts(tokens_, amounts_);
    forwarder.registerIncome(tokens_, amounts_, ISplitter(splitter_).vault(), true);
  }

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
  function _recycle(
    ITetuConverter converter_,
    address asset,
    uint compoundRatio,
    address[] memory tokens,
    ITetuLiquidator liquidator,
    mapping(address => uint) storage liquidationThresholds,
    address[] memory rewardTokens,
    uint[] memory rewardAmounts,
    uint performanceFee
  ) internal returns (
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
        if (AppLib.getAssetIndex(tokens, p.rewardToken) != type(uint).max) {
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
//endregion----------------------------------------------- Recycle rewards

//region--------------------------------------------------- Before deposit
  /// @notice Default implementation of ConverterStrategyBase.beforeDeposit
  /// @param amount_ Amount of underlying to be deposited
  /// @param tokens_ Tokens received from {_depositorPoolAssets}
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @param weights_ Depositor pool weights
  /// @param totalWeight_ Sum of {weights_}
  function beforeDeposit(
    ITetuConverter converter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory weights_,
    uint totalWeight_,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    // temporary save collateral to tokensAmounts
    tokenAmounts = _getCollaterals(amount_, tokens_, weights_, totalWeight_, indexAsset_, AppLib._getPriceOracle(converter_));

    // make borrow and save amounts of tokens available for deposit to tokenAmounts, zero result amounts are possible
    tokenAmounts = _getTokenAmounts(converter_, tokens_, indexAsset_, tokenAmounts, liquidationThresholds[tokens_[indexAsset_]]);
  }

  /// @notice For each {token_} calculate a part of {amount_} to be used as collateral according to the weights.
  ///         I.e. we have 300 USDC, we need to split it on 100 USDC, 100 USDT, 100 DAI
  ///         USDC is main asset, USDT and DAI should be borrowed. We check amounts of USDT and DAI on the balance
  ///         and return collaterals reduced on that amounts. For main asset, we return full amount always (100 USDC).
  /// @param tokens_ Tokens received from {_depositorPoolAssets}
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return tokenAmountsOut Length of the array is equal to the length of {tokens_}
  function _getCollaterals(
    uint amount_,
    address[] memory tokens_,
    uint[] memory weights_,
    uint totalWeight_,
    uint indexAsset_,
    IPriceOracle priceOracle
  ) internal view returns (
    uint[] memory tokenAmountsOut
  ) {
    uint len = tokens_.length;
    tokenAmountsOut = new uint[](len);

    // get token prices and decimals
    (uint[] memory prices, uint[] memory decs) = AppLib._getPricesAndDecs(priceOracle, tokens_, len);

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

  /// @notice Make borrow and return amounts of {tokens} available to deposit
  /// @param tokens_ Tokens received from {_depositorPoolAssets}
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @param collaterals_ Amounts of main asset that can be used as collateral to borrow {tokens_}
  /// @param thresholdAsset_ Value of liquidation threshold for the main (collateral) asset
  /// @return tokenAmountsOut Amounts of {tokens}  available to deposit
  function _getTokenAmounts(
    ITetuConverter converter_,
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory collaterals_,
    uint thresholdAsset_
  ) internal returns (
    uint[] memory tokenAmountsOut
  ) {
    // content of tokenAmounts will be modified in place
    uint len = tokens_.length;
    tokenAmountsOut = new uint[](len);
    address asset = tokens_[indexAsset_];

    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i != indexAsset_) {
        address token = tokens_[i];
        if (collaterals_[i] != 0) {
          AppLib.approveIfNeeded(asset, collaterals_[i], address(converter_));
          _openPosition(
            converter_,
            "", // entry kind = 0: fixed collateral amount, max possible borrow amount
            asset,
            token,
            collaterals_[i],
            _getLiquidationThreshold(thresholdAsset_)
          );

          // zero borrowed amount is possible here (conversion is not available)
          // if it's not suitable for depositor, the depositor should check zero amount in other places
        }
        tokenAmountsOut[i] = IERC20(token).balanceOf(address(this));
      }
    }

    tokenAmountsOut[indexAsset_] = Math.min(
      collaterals_[indexAsset_],
      IERC20(asset).balanceOf(address(this))
    );
  }
//endregion--------------------------------------------------- Before deposit

//region--------------------------------------------------- Make requested amount



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
      // amountsToConvert_ are enough to get requestedAmount
      _convertAfterWithdraw(d_, _liquidationThresholds, amountsToConvert_);
    } else {
      uint balance = IERC20(d_.tokens[d_.indexAsset]).balanceOf(address(this));
      requestedAmount = requestedAmount > balance
        ? requestedAmount - balance
        : 0;

      // amountsToConvert_ are NOT enough to get requestedAmount
      // We are allowed to make only one repay per block, so, we shouldn't try to convert amountsToConvert_
      // We should try to close the exist debts instead:
      //    convert a part of main assets to get amount of secondary assets required to repay the debts
      // and only then make conversion.
      expectedAmount = _closePositionsToGetAmount(d_, _liquidationThresholds, requestedAmount)
        + expectedMainAssetAmounts[d_.indexAsset];
    }

    return expectedAmount;
  }
  //endregion-------------------------------------------- Make requested amount

//region ------------------------------------------------ Withdraw helpers

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
  /// @param requestedAmount Requested amount of main asset that should be added to the current balance.
  ///                        Pass type(uint).max to request all.
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

  /// @dev Implements {IterationPlanKinds.PLAN_SWAP_REPAY} only
  function _closePositionsToGetAmount(
    DataSetLocal memory d_,
    uint[] memory liquidationThresholds_,
    uint requestedAmount
  ) internal returns (
    uint expectedAmount
  ) {
    console.log("_closePositionsToGetAmount.init.0", IERC20(d_.tokens[0]).balanceOf(address(this)));
    console.log("_closePositionsToGetAmount.init.1", IERC20(d_.tokens[1]).balanceOf(address(this)));

    if (requestedAmount != 0) {
      CloseDebtsForRequiredAmountLocal memory v;
      v.asset = d_.tokens[d_.indexAsset];

      SwapRepayPlanParams memory p;
      p.converter = d_.converter;
      // p.planKind = IterationPlanKinds.PLAN_SWAP_REPAY; // PLAN_SWAP_REPAY == 0, so we don't need this line
      p.tokens = d_.tokens;
      p.liquidationThresholds = liquidationThresholds_;
      p.balanceAdditions = new uint[](d_.len);

      (p.prices, p.decs) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(d_.converter), d_.tokens, d_.len);

      for (uint i; i < d_.len; i = AppLib.uncheckedInc(i)) {
        console.log("_closePositionsToGetAmount.1,i", i);
        if (i == d_.indexAsset) continue;

        v.balanceAsset = IERC20(v.asset).balanceOf(address(this));
        v.balanceToken = IERC20(d_.tokens[i]).balanceOf(address(this));
        bool changed;
        console.log("_closePositionsToGetAmount.2.balances.0", v.balanceAsset);
        console.log("_closePositionsToGetAmount.2.balances.1", v.balanceToken);

        // Make one or several iterations. Do single swap and single repaying (both are optional) on each iteration.
        // Calculate expectedAmount of received underlying. Swap leftovers at the end even if requestedAmount is 0 at that moment.
        do {
          // generate iteration plan: [swap], [repay]
          (v.idxToSwap1, v.amountToSwap, v.idxToRepay1) = _buildIterationPlan(p, requestedAmount, d_.indexAsset, i);
          console.log("_closePositionsToGetAmount.3,v.idxToSwap1, v.amountToSwap, v.idxToRepay1", v.idxToSwap1, v.amountToSwap, v.idxToRepay1);
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
            if (spentAmountIn != 0 && indexIn == i && v.idxToRepay1 == 0) {
              // spentAmountIn can be zero if token balance is less than liquidationThreshold
              // we need to calculate expectedAmount only if not-underlying-leftovers are swapped to underlying
              // we don't need to take into account conversion to get toSell amount
              expectedAmount += spentAmountIn * p.prices[i] * p.decs[d_.indexAsset] / p.prices[d_.indexAsset] / p.decs[i];
              console.log("_closePositionsToGetAmount.3.expectedAmount", expectedAmount);
            }
          }

          // repay a debt if necessary
          if (v.idxToRepay1 != 0) {
            uint indexBorrow = v.idxToRepay1 - 1;
            uint indexCollateral = indexBorrow == d_.indexAsset ? i : d_.indexAsset;
            uint expectedAmountOut = _repayDebt(
              p.converter,
              p.tokens[indexCollateral],
              p.tokens[indexBorrow],
              IERC20(p.tokens[indexBorrow]).balanceOf(address(this))
            );

            if (indexCollateral == d_.indexAsset) {
              require(expectedAmountOut >= spentAmountIn, AppErrors.BALANCE_DECREASE);
              expectedAmount += expectedAmountOut - spentAmountIn;
              console.log("_closePositionsToGetAmount.4.expectedAmount", expectedAmount);
            }
          }

          // update balances and requestedAmount
          v.newBalanceAsset = IERC20(v.asset).balanceOf(address(this));
          v.newBalanceToken = IERC20(d_.tokens[i]).balanceOf(address(this));

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

    console.log("_closePositionsToGetAmount.final.expectedAmount", expectedAmount);
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
  /// @return indexToSwapPlus1 1-based index of the token to be swapped; 0 means swap is not required.
  /// @return amountToSwap Amount to be swapped. 0 - no swap
  /// @return indexToRepayPlus1 1-based index of the token that should be used to repay borrow in converter.
  ///                            0 - no repay is required - it means that this is a last step with swapping leftovers.
  function _buildIterationPlan(
    SwapRepayPlanParams memory p,
    uint requestedAmount,
    uint indexAsset,
    uint indexToken
  ) internal returns (
    uint indexToSwapPlus1,
    uint amountToSwap,
    uint indexToRepayPlus1
  ) {
    GetIterationPlanLocal memory v;
    v.asset = p.tokens[indexAsset];
    v.token = p.tokens[indexToken];

    v.assetBalance = IERC20(v.asset).balanceOf(address(this)) + p.balanceAdditions[indexAsset];
    v.tokenBalance = IERC20(p.tokens[indexToken]).balanceOf(address(this)) + p.balanceAdditions[indexToken];
    console.log("_buildIterationPlan.balance.init.0", IERC20(p.tokens[0]).balanceOf(address(this)));
    console.log("_buildIterationPlan.balance.init.1", IERC20(p.tokens[1]).balanceOf(address(this)));

    if (p.planKind == IterationPlanKinds.PLAN_SWAP_ONLY) {
      console.log("_buildIterationPlan.1");
      v.swapLeftoversNeeded = true;
    } else {
      if (requestedAmount < _getLiquidationThreshold(p.liquidationThresholds[indexAsset])) {
        // we don't need to repay any debts anymore, but we should swap leftovers
        console.log("_buildIterationPlan.2");
        v.swapLeftoversNeeded = true;
      } else {
        // we need to increase balance on the following amount: requestedAmount - v.balance;
        // we can have two possible borrows:
        // 1) direct (p.tokens[INDEX_ASSET] => tokens[i]) and 2) reverse (tokens[i] => p.tokens[INDEX_ASSET])
        // normally we can have only one of them, not both..
        // but better to take into account possibility to have two debts simultaneously
        console.log("_buildIterationPlan.3");

        // reverse debt
        (v.debtReverse, v.collateralReverse) = p.converter.getDebtAmountCurrent(address(this), v.token, v.asset, true);
        console.log("_buildIterationPlan.debtReverse", v.debtReverse);
        console.log("_buildIterationPlan.collateralReverse", v.collateralReverse);

        if (v.debtReverse == 0) {
          console.log("_buildIterationPlan.4");
          // direct debt
          (v.totalDebt, v.totalCollateral) = p.converter.getDebtAmountCurrent(address(this), v.asset, v.token, true);
          console.log("_buildIterationPlan.totalDebt", v.totalDebt);
          console.log("_buildIterationPlan.totalCollateral", v.totalCollateral);

          if (v.totalDebt == 0) {
            console.log("_buildIterationPlan.5");
            // This is final iteration - we need to swap leftovers and get amounts on balance in proper proportions.
            // The leftovers should be swapped to get following result proportions of the assets:
            //      underlying : not-underlying === 1e18 - propNotUnderlying18 : propNotUnderlying18
            v.swapLeftoversNeeded = true;
          } else {
            console.log("_buildIterationPlan.6");
            console.log("repay direct debt");
            // repay direct debt
            if (p.planKind == IterationPlanKinds.PLAN_REPAY_SWAP_REPAY) {
              console.log("_buildIterationPlan.7");
              (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanRepaySwapRepay(
                p,
                [v.assetBalance, v.tokenBalance],
                [indexAsset, indexToken],
                p.propNotUnderlying18,
                v.totalCollateral,
                v.totalDebt
              );
            } else {
              console.log("_buildIterationPlan.8");
              (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanForSellAndRepay(
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
          }
        } else {
          console.log("_buildIterationPlan.9");
          // repay reverse debt
          console.log("repay reverse debt");
          if (p.planKind == IterationPlanKinds.PLAN_REPAY_SWAP_REPAY) {
            console.log("_buildIterationPlan.10");
            (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanRepaySwapRepay(
              p,
              [v.tokenBalance, v.assetBalance],
              [indexToken, indexAsset],
              1e18 - p.propNotUnderlying18,
              v.collateralReverse,
              v.debtReverse
            );
          } else {
            console.log("_buildIterationPlan.11");
            (indexToSwapPlus1, amountToSwap, indexToRepayPlus1) = _buildPlanForSellAndRepay(
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
      }
    }

    if (v.swapLeftoversNeeded) {
      console.log("_buildIterationPlan.12");
      (indexToSwapPlus1, amountToSwap) = _buildPlanForLeftovers(p, v.assetBalance, v.tokenBalance, indexAsset, indexToken, p.propNotUnderlying18);
    }

    console.log("_buildIterationPlan.13");
    return (indexToSwapPlus1, amountToSwap, indexToRepayPlus1);
  }

  /// @notice Repay B, get collateral A, then swap A => B, [make one more repay B] => get A:B in required proportions
  /// @param balancesAB [balanceA, balanceB]
  /// @param idxAB [indexA, indexB]
  function _buildPlanRepaySwapRepay(
    SwapRepayPlanParams memory p,
    uint[2] memory balancesAB,
    uint[2] memory idxAB,
    uint propB,
    uint totalCollateralA,
    uint totalBorrowB
  ) internal returns (
    uint indexToSwapPlus1,
    uint amountToSwap,
    uint indexToRepayPlus1
  ) {
    console.log("_buildPlanRepaySwapRepay.balanceA", balancesAB[0]);
    console.log("_buildPlanRepaySwapRepay.balanceB", balancesAB[1]);
    console.log("_buildPlanRepaySwapRepay.indexA", idxAB[0]);
    console.log("_buildPlanRepaySwapRepay.indexB", idxAB[1]);
    console.log("_buildPlanRepaySwapRepay.totalCollateralA", totalCollateralA);
    console.log("_buildPlanRepaySwapRepay.totalBorrowB", totalBorrowB);

    require(balancesAB[1] != 0, AppErrors.UNFOLDING_2_ITERATIONS_REQUIRED);
    // use all available tokenB to repay debt and receive as much as possible tokenA
    uint amountToRepay = Math.min(balancesAB[1], totalBorrowB);
    (uint collateralAmount,) = p.converter.quoteRepay(address(this), p.tokens[idxAB[0]], p.tokens[idxAB[1]], amountToRepay);

    // swap A to B: full or partial
    amountToSwap = estimateSwapAmountForRepaySwapRepay(
      p,
      balancesAB[0],
      0,
      idxAB[0],
      idxAB[1],
      propB,
      totalCollateralA,
      totalBorrowB,
      collateralAmount,
      amountToRepay
    );

    console.log("_buildPlanRepaySwapRepay.collateralAmount", collateralAmount);
    console.log("_buildPlanRepaySwapRepay.amountToRepay", amountToRepay);
    console.log("_buildPlanRepaySwapRepay.amountToSwap, indexRepayTokenPlus1, indexTokenToSwapPlus1", idxAB[0] + 1, amountToSwap, idxAB[1] + 1);

    return (idxAB[0] + 1, amountToSwap, idxAB[1] + 1);
  }

  /// @notice Estimate swap amount for iteration "repay-swap-repay"
  ///         The iteration should give us amounts of assets in required proportions.
  ///         There are two cases here: full swap and partial swap. Second repay is not required if the swap is partial.
  /// @param collateralA Estimated value of collateral A received after repay balanceB
  function estimateSwapAmountForRepaySwapRepay(
    SwapRepayPlanParams memory p,
    uint balanceA,
    uint balanceB,
    uint indexA,
    uint indexB,
    uint propB,
    uint totalCollateralA,
    uint totalBorrowB,
    uint collateralA,
    uint amountToRepayB
  ) internal pure returns(uint) {
    // todo This function should be optimized (reduce amount of vars and params)

    // N - number of the state
    // bAN, bBN - balances of A and B; aAN, aBN - amounts of A and B; cAN, cBN - collateral/borrow amounts of A/B
    // alpha ~ cAN/cBN - estimated ratio of collateral/borrow
    // s = swap ratio, aA is swapped to aB, so aA = s * aB
    // g = split ratio, bA1 is divided on two parts: bA1 * gamma, bA1 * (1 + gamma). First part is swapped.
    // X = proportion of A, Y = proportion of B

    // Formulas
    // aB3 = (x * bB2 - Y * bA2) / (alpha * y + x)
    // gamma = (y * bA1 - x * bB1) / (bA1 * (x * s + y))

    // There are following stages:
    // 0. init (we have at least not zero amount of B and not zero debt of B)
    // 1. repay 1 (repay all available amount of B OR all available debt)
    // 2. swap (swap A fully or partially to B)
    // 3. repay 2 (optional: we need this stage if full swap produces amount of B that is <= available debt)
    // 4. final (we have assets in right proportion on the balance)

    EstimateSwapAmountForRepaySwapRepayLocal memory v;
    v.x = 1e18 - propB;
    v.y = propB;

// 1. repay 1
    // convert amounts A, amounts B to cost A, cost B in USD
    v.bA1 = (balanceA + collateralA) * p.prices[indexA] / p.decs[indexA];
    v.bB1 = (balanceB - amountToRepayB) * p.prices[indexB] / p.decs[indexB];
    v.cB1 = (totalBorrowB - amountToRepayB) * p.prices[indexB] / p.decs[indexB];
    v.alpha = 1e18 * totalCollateralA * p.prices[indexA] * p.decs[indexB]
      / p.decs[indexA] / p.prices[indexB] / totalBorrowB; // (!) approx estimation

// 2. full swap
    v.aA2 = v.bA1;
    v.s = 1e18 * p.prices[indexB] / p.prices[indexA]; // no decimals because we use costs: costA = s * costB
    v.bA2 = v.bA1 - v.aA2;
    v.bB2 = v.bB1 + v.aA2 * v.s / 1e18;

// 3. repay 2
    v.aB3 = (v.x * v.bB2 - v.y * v.bA2) / (v.alpha * v.y / 1e18 + v.x);

    if (v.aB3 > v.cB1) {
      // there is not enough debt to make second repay
      // we need to make partial swap and receive assets in right proportions in result
      v.gamma = 1e18 * (v.y * v.bA1 - v.x * v.bB1) / (v.bA1 * (v.x * v.s / 1e18 + v.y));
      v.aA2 = v.bA1 * v.gamma / 1e18;
    }

    return v.aA2 * p.decs[indexA] / p.prices[indexA];
  }

  /// @notice Prepare a plan to swap leftovers to required proportion
  /// @param balanceA Balance of token A, i.e. underlying
  /// @param balanceB Balance of token B, i.e. not-underlying
  /// @param indexA Index of the token A, i.e. underlying, in {p.prices} and {p.decs}
  /// @param indexB Index of the token B, i.e. not-underlying, in {p.prices} and {p.decs}
  /// @param propB Required proportion of TokenB [0..1e18]. Proportion of token A is (1e18-propB)
  /// @return indexTokenToSwapPlus1 Index of the token to be swapped. 0 - no swap is required
  /// @return amountToSwap Amount to be swapped. 0 - no swap is required
  function _buildPlanForLeftovers(
    SwapRepayPlanParams memory p,
    uint balanceA,
    uint balanceB,
    uint indexA,
    uint indexB,
    uint propB
  ) internal view returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap
  ) {
    console.log("_buildPlanForLeftovers.indexA", indexA);
    console.log("_buildPlanForLeftovers.indexB", indexB);
    console.log("_buildPlanForLeftovers.balanceA", balanceA);
    console.log("_buildPlanForLeftovers.balanceB", balanceB);
    console.log("_buildPlanForLeftovers.propB", propB);
    if (balanceB != 0) {
      (uint targetA, uint targetB) = _getTargetAmounts(p.prices, p.decs, balanceA, balanceB, propB, indexA, indexB);
      console.log("_buildPlanForLeftovers.targetA", targetA);
      console.log("_buildPlanForLeftovers.targetB", targetB);

      if (balanceA < targetA) {
        // we need to swap not-underlying to underlying
        if (balanceB - targetB > _getLiquidationThreshold(p.liquidationThresholds[indexB])) {
          console.log("_buildPlanForLeftovers.1.amountToSwap", balanceB - targetB);
          console.log("_buildPlanForLeftovers.1.indexB + 1", indexB + 1);
          amountToSwap = balanceB - targetB;
          indexTokenToSwapPlus1 = indexB + 1;
        }
      } else {
        // we need to swap underlying to not-underlying
        if (balanceA - targetA > _getLiquidationThreshold(p.liquidationThresholds[indexA])) {
          console.log("_buildPlanForLeftovers.2.amountToSwap", balanceA - targetA);
          console.log("_buildPlanForLeftovers.2.indexA + 1", indexB + 1);
          amountToSwap = balanceA - targetA;
          indexTokenToSwapPlus1 = indexA + 1;
        }
      }
    }
    return (indexTokenToSwapPlus1, amountToSwap);
  }

  /// @notice Prepare a plan to swap some amount of collateral to get required repay-amount and make repaying
  ///         1) Sell collateral-asset to get missed amount-to-repay 2) make repay and get more collateral back
  /// @param requestedAmount Amount of underlying that we need to get on balance finally.
  /// @param totalCollateral Total amount of collateral used in the borrow
  /// @param totalDebt Total amount of debt that should be repaid to receive {totalCollateral}
  /// @param indexCollateral Index of collateral asset in {p.prices}, {p.decs}
  /// @param indexBorrow Index of borrow asset in {p.prices}, {p.decs}
  /// @param balanceCollateral Current balance of the collateral asset
  /// @param balanceBorrow Current balance of the borrowed asset
  /// @param indexTokenToSwapPlus1 1-based index of the token to be swapped. Swap of amount of collateral asset can be required
  ///                              to receive missed amount-to-repay. 0 - no swap is required
  /// @param amountToSwap Amount to be swapped. 0 - no swap is required
  /// @param indexRepayTokenPlus1 1-based index of the token to be repaied. 0 - no repaying is required
  function _buildPlanForSellAndRepay(
    uint requestedAmount,
    SwapRepayPlanParams memory p,
    uint totalCollateral,
    uint totalDebt,
    uint indexCollateral,
    uint indexBorrow,
    uint balanceCollateral,
    uint balanceBorrow
  ) internal pure returns (
    uint indexTokenToSwapPlus1,
    uint amountToSwap,
    uint indexRepayTokenPlus1
  ) {
    // what amount of collateral we should sell to get required amount-to-pay to pay the debt
    uint toSell = _getAmountToSell(
      requestedAmount,
      totalDebt,
      totalCollateral,
      p.prices,
      p.decs,
      indexCollateral,
      indexBorrow,
      balanceBorrow
    );

    // convert {toSell} amount of underlying to token
    if (toSell != 0 && balanceCollateral != 0) {
      toSell = Math.min(toSell, balanceCollateral);
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
  /// @param targetAssets What result balance of underlying is required to fit to required proportions
  /// @param targetTokens What result balance of not-underlying is required to fit to required proportions
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
    targetTokens = targetTokens * decs[indexToken] / prices[indexToken];
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
  /// @return amountOut Amount of collateral-asset that should be sold
  function _getAmountToSell(
    uint requestedAmount,
    uint totalDebt,
    uint totalCollateral,
    uint[] memory prices,
    uint[] memory decs,
    uint indexCollateral,
    uint indexBorrowAsset,
    uint balanceBorrowAsset
  ) internal pure returns (
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

//region------------------------------------------------ Other helpers
  function _getLiquidationThreshold(uint threshold) internal pure returns (uint) {
    return threshold > DEFAULT_LIQUIDATION_THRESHOLD
      ? threshold
      : DEFAULT_LIQUIDATION_THRESHOLD;
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
//endregion--------------------------------------------- Other helpers
}

