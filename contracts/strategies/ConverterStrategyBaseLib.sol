// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../libs/AppErrors.sol";
import "../libs/AppLib.sol";
import "../libs/TokenAmountsLib.sol";
import "../libs/ConverterEntryKinds.sol";

library ConverterStrategyBaseLib {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        DATA TYPES
  /////////////////////////////////////////////////////////////////////
  /// @notice Local vars for {_recycle}, workaround for stack too deep
  struct RecycleLocalParams {
    uint amountToCompound;
    address rewardToken;
    uint liquidationThresholdAsset;
    uint len;
    uint spentAmountIn;
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

  struct ConvertAfterWithdrawLocalParams {
    address asset;
    uint collateral;
    uint spentAmountIn;
    uint receivedAmountOut;
  }

  struct SwapToGivenAmountInputParams {
    uint targetAmount;
    address[] tokens;
    uint indexTargetAsset;
    address underlying;
    uint[] amounts;
    ITetuConverter converter;
    ITetuLiquidator liquidator;
    uint liquidationThresholdForTargetAsset;
    /// @notice Allow to swap more then required (i.e. 1_000 => +1%)
    ///         to avoid additional swap if the swap return amount a bit less than we expected
    uint overswap;
  }

  struct SwapToGivenAmountLocal {
    uint len;
    uint[] availableAmounts;
    uint[] receivedAmounts;
    uint i;
  }

  /////////////////////////////////////////////////////////////////////
  ///                        Constants
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
  uint internal constant DEFAULT_LIQUIDATION_THRESHOLD = 10_000;

  /////////////////////////////////////////////////////////////////////
  ///                         Events
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

  /////////////////////////////////////////////////////////////////////
  ///                      View functions
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
    // we need brackets here for npm.run.coverage

    uint len = reserves_.length;
    withdrawnAmountsOut = new uint[](len);

    if (ratio != 0) {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        withdrawnAmountsOut[i] = reserves_[i] * ratio / 1e18;
      }
    }
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
    (uint[] memory prices, uint[] memory decs) = _getPricesAndDecs(priceOracle, tokens_, len);

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

  /// @return prices Prices with decimals 18
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

  /// @notice Get a ratio to calculate amount of liquidity that should be withdrawn from the pool to get {targetAmount_}
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
  /// @param targetAmount_ Required amount of main asset to be withdrawn from the strategy
  ///                      0 - withdraw all
  /// @param strategy_ Address of the strategy
  function getLiquidityAmountRatio(
    uint targetAmount_,
    address strategy_,
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint investedAssets,
    uint depositorLiquidity
  ) external returns (
    uint liquidityRatioOut,
    uint[] memory amountsToConvertOut
  ) {
    bool all = targetAmount_ == 0;

    uint len = tokens.length;
    amountsToConvertOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) continue;

      uint balance = IERC20(tokens[i]).balanceOf(address(this));
      if (balance != 0) {
        // let's estimate collateral that we received back after repaying baseAmount
        uint expectedCollateral = converter.quoteRepay(
          strategy_,
          tokens[indexAsset],
          tokens[i],
          balance
        );

        if (all || targetAmount_ != 0) {
          // We always repay WHOLE available baseAmount even if it gives us much more amount then we need.
          // We cannot repay a part of it because converter doesn't allow to know
          // what amount should be repaid to get given amount of collateral.
          // And it's too dangerous to assume that we can calculate this amount
          // by reducing baseAmount proportionally to expectedCollateral/targetAmount_
          amountsToConvertOut[i] = balance;
        }

        if (targetAmount_ > expectedCollateral) {
          targetAmount_ -= expectedCollateral;
        } else {
          targetAmount_ = 0;
        }

        if (investedAssets > expectedCollateral) {
          investedAssets -= expectedCollateral;
        } else {
          investedAssets = 0;
        }
      }
    }

    require(all || investedAssets > 0, AppErrors.WITHDRAW_TOO_MUCH);

    liquidityRatioOut = all
      ? 1e18
      : ((targetAmount_ == 0)
        ? 0
        : 1e18
          * 101 // add 1% on top...
          * targetAmount_ / investedAssets // a part of amount that we are going to withdraw
          / 100 // .. add 1% on top
    );

    if (liquidityRatioOut != 0) {
      // liquidityAmount temporary contains ratio...
      liquidityRatioOut = liquidityRatioOut * depositorLiquidity / 1e18;
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Borrow and close positions
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
      return (0,0);
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
        if (amountIn_ < collateralThreshold_ || amountIn_ == 0) break;
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
  /// @param amountToRepay Amount to repay in terms of {borrowAsset}
  /// @return returnedAssetAmountOut Amount of collateral received back after repaying
  /// @return repaidAmountOut Amount that was actually repaid
  function _closePosition(
    ITetuConverter tetuConverter_,
    address collateralAsset,
    address borrowAsset,
    uint amountToRepay
  ) internal returns (
    uint returnedAssetAmountOut,
    uint repaidAmountOut
  ) {

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
    emit ClosePosition(
      collateralAsset,
      borrowAsset,
      amountRepay,
      address(this),
      returnedAssetAmountOut,
      returnedBorrowAmountOut
    );
    uint balanceAfter = IERC20(borrowAsset).balanceOf(address(this));

    // we cannot use amountRepay here because AAVE pool adapter is able to send tiny amount back (dust tokens)
    repaidAmountOut = balanceBefore > balanceAfter
    ? balanceBefore - balanceAfter
    : 0;

    require(returnedBorrowAmountOut == 0, StrategyLib.WRONG_VALUE);
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

  /////////////////////////////////////////////////////////////////////
  ///                         Liquidation
  /////////////////////////////////////////////////////////////////////

  /// @notice Make liquidation if estimated amountOut exceeds the given threshold
  /// @param spentAmountIn Amount of {tokenIn} has been consumed by the liquidator
  /// @param receivedAmountOut Amount of {tokenOut_} has been returned by the liquidator
  function liquidate(
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenOut_
  ) external returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    return _liquidate(liquidator_, tokenIn_, tokenOut_, amountIn_, slippage_, liquidationThresholdForTokenOut_);
  }

  /// @notice Make liquidation if estimated amountOut exceeds the given threshold
  /// @param spentAmountIn Amount of {tokenIn} has been consumed by the liquidator
  /// @param receivedAmountOut Amount of {tokenOut_} has been returned by the liquidator
  function _liquidate(
    ITetuLiquidator liquidator_,
    address tokenIn_,
    address tokenOut_,
    uint amountIn_,
    uint slippage_,
    uint liquidationThresholdForTokenOut_
  ) internal returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    (ITetuLiquidator.PoolData[] memory route,) = liquidator_.buildRoute(tokenIn_, tokenOut_);

    require(route.length != 0, AppErrors.NO_LIQUIDATION_ROUTE);

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

      emit Liquidation(
        tokenIn_,
        tokenOut_,
        amountIn_,
        spentAmountIn,
        receivedAmountOut
      );
    }

    return (spentAmountIn, receivedAmountOut);
  }

  /////////////////////////////////////////////////////////////////////
  ///                 requirePayAmountBack
  /////////////////////////////////////////////////////////////////////

  /// @notice Swap available {amounts_} of {tokens_} to receive {targetAmount_} of {tokens[indexTheAsset_]}
  /// @param targetAmount_ Required amount of tokens[indexTheAsset_] that should be received by swap(s)
  /// @param tokens_ tokens received from {_depositorPoolAssets}
  /// @param indexTargetAsset_ Index of target asset in tokens_ array
  /// @param underlying_ Index of underlying
  /// @param withdrawnAmounts_ Amounts withdrawn from the pool
  /// @param liquidationThresholdForTargetAsset_ Liquidation thresholds for the target asset
  /// @param overswap_ Allow to swap more then required (i.e. 1_000 => +1%)
  ///                  to avoid additional swap if the swap return amount a bit less than we expected
  /// @return spentAmounts Any amounts spent during the swaps
  /// @return withdrawnAmountsOut withdrawnAmounts + any amounts received during the swaps
  function swapToGivenAmount(
    uint targetAmount_,
    address[] memory tokens_,
    uint indexTargetAsset_,
    address underlying_,
    uint[] memory withdrawnAmounts_,
    ITetuConverter converter_,
    ITetuLiquidator liquidator_,
    uint liquidationThresholdForTargetAsset_,
    uint overswap_
  ) external returns (
    uint[] memory spentAmounts,
    uint[] memory withdrawnAmountsOut
  ) {
    SwapToGivenAmountLocal memory v;
    v.len = tokens_.length;

    spentAmounts = new uint[](v.len);
    withdrawnAmountsOut = new uint[](v.len);

    v.availableAmounts = new uint[](v.len);
    for (; v.i < v.len; v.i = AppLib.uncheckedInc(v.i)) {
      v.availableAmounts[v.i] = withdrawnAmounts_[v.i] + IERC20(tokens_[v.i]).balanceOf(address(this));
    }
    (spentAmounts, v.receivedAmounts) = _swapToGivenAmount(
      SwapToGivenAmountInputParams({
        targetAmount: targetAmount_,
        tokens: tokens_,
        indexTargetAsset: indexTargetAsset_,
        underlying: underlying_,
        amounts: v.availableAmounts,
        converter: converter_,
        liquidator: liquidator_,
        liquidationThresholdForTargetAsset: Math.max(liquidationThresholdForTargetAsset_, DEFAULT_LIQUIDATION_THRESHOLD),
        overswap: overswap_
      })
    );
    for (v.i = 0; v.i < v.len; v.i = AppLib.uncheckedInc(v.i)) {
      withdrawnAmountsOut[v.i] = withdrawnAmounts_[v.i] + v.receivedAmounts[v.i];
    }
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
        p.liquidator,
        p.tokens[indexTokenIn],
        p.tokens[p.indexTargetAsset],
        Math.min(amountIn, p.amounts[indexTokenIn]),
        _ASSET_LIQUIDATION_SLIPPAGE,
        p.liquidationThresholdForTargetAsset
      );
    }

    return (amountSpent, amountReceived);
  }

  /////////////////////////////////////////////////////////////////////
  ///                      Recycle rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  /// We have two kinds of rewards:
  /// 1) rewards in depositor's assets (the assets returned by _depositorPoolAssets)
  /// 2) any other rewards
  /// All received rewards are immediately "recycled".
  /// It means, they are divided on two parts: to forwarder, to compound
  ///   Compound-part of Rewards-2 can be liquidated
  ///   Compound part of Rewards-1 should be just added to baseAmounts
  /// All forwarder-parts are returned in amountsToForward and should be transferred to the forwarder.
  /// @param tokens_ tokens received from {_depositorPoolAssets}
  /// @param rewardTokens_ Full list of reward tokens received from tetuConverter and depositor
  /// @param rewardAmounts_ Amounts of {rewardTokens_}; we assume, there are no zero amounts here
  /// @param liquidationThresholds_ Liquidation thresholds for rewards tokens
  /// @return amountsToForward Amounts to be sent to forwarder
  function recycle(
    address asset_,
    uint compoundRatio_,
    address[] memory tokens_,
    ITetuLiquidator liquidator_,
    mapping(address => uint) storage liquidationThresholds_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) external returns (
    uint[] memory amountsToForward
  ) {
    amountsToForward = _recycle(
      asset_,
      compoundRatio_,
      tokens_,
      liquidator_,
      rewardTokens_,
      rewardAmounts_,
      liquidationThresholds_
    );
  }

  /// @dev Implementation of {recycle}
  function _recycle(
    address asset,
    uint compoundRatio,
    address[] memory tokens,
    ITetuLiquidator liquidator,
    address[] memory rewardTokens,
    uint[] memory rewardAmounts,
    mapping(address => uint) storage liquidationThresholds
  ) internal returns (uint[] memory amountsToForward) {
    RecycleLocalParams memory p;

    p.len = rewardTokens.length;
    require(p.len == rewardAmounts.length, AppErrors.WRONG_LENGTHS);

    p.liquidationThresholdAsset = Math.max(liquidationThresholds[asset], DEFAULT_LIQUIDATION_THRESHOLD);

    amountsToForward = new uint[](p.len);

    // split each amount on two parts: a part-to-compound and a part-to-transfer-to-the-forwarder
    for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
      p.rewardToken = rewardTokens[i];
      p.amountToCompound = rewardAmounts[i] * compoundRatio / COMPOUND_DENOMINATOR;

      if (p.amountToCompound > 0) {
        if (ConverterStrategyBaseLib.getAssetIndex(tokens, p.rewardToken) != type(uint).max) {
          // The asset is in the list of depositor's assets, liquidation is not allowed
          // just keep on the balance, should be handled later
        } else {
          if (p.amountToCompound < Math.max(liquidationThresholds[p.rewardToken], DEFAULT_LIQUIDATION_THRESHOLD)) {
            // amount is too small, liquidation is not allowed
            // just keep on the balance, should be handled later
          } else {
            // The asset is not in the list of depositor's assets, its amount is big enough and should be liquidated
            // We assume here, that {token} cannot be equal to {_asset}
            // because the {_asset} is always included to the list of depositor's assets
            (p.spentAmountIn, p.receivedAmountOut) = _liquidate(
              liquidator,
              p.rewardToken,
              asset,
              p.amountToCompound,
              _REWARD_LIQUIDATION_SLIPPAGE,
              p.liquidationThresholdAsset
            );
          }
        }
      }
      amountsToForward[i] = rewardAmounts[i] - p.amountToCompound;
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                      calcInvestedAssets
  /////////////////////////////////////////////////////////////////////
  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because we need to update current balances in the internal protocols.
  /// @return amountOut Invested asset amount under control (in terms of {asset})
  function calcInvestedAssets(
    address[] memory tokens,
    uint[] memory amountsOut,
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
        amountOut += amountsOut[i];
      } else {
        // available amount to repay
        uint toRepay = IERC20(tokens[i]).balanceOf(address(this)) + amountsOut[i];

        (uint toPay, uint collateral) = converter_.getDebtAmountCurrent(address(this), tokens[indexAsset], tokens[i]);
        amountOut += collateral;
        if (toRepay >= toPay) {
          amountOut += (toRepay - toPay) * v.prices[i] * v.decs[indexAsset] / v.prices[indexAsset] / v.decs[i];
        } else {
          // there is not enough amount to pay the debt
          // let's register a debt and try to resolve it later below
          if (v.debts.length == 0) {
            // lazy initialization
            v.debts = new uint[](v.len);
          }
          // to pay the following amount we need to swap some other asset at first
          v.debts[i] = toPay - toRepay;
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

  /////////////////////////////////////////////////////////////////////
  ///                      getExpectedAmountMainAsset
  /////////////////////////////////////////////////////////////////////

  /// @notice Calculate expected amount of the main asset after withdrawing
  /// @param withdrawnAmounts_ Expected amounts to be withdrawn from the pool
  /// @param amountsToConvert_ Amounts on balance initially available for the conversion
  /// @return amountOut Expected amount of the main asset
  function getExpectedAmountMainAsset(
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint[] memory withdrawnAmounts_,
    uint[] memory amountsToConvert_
  ) internal returns (
    uint amountOut
  ) {
    uint len = tokens.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) {
        amountOut += withdrawnAmounts_[i];
      } else {
        uint amount = withdrawnAmounts_[i] + amountsToConvert_[i];
        if (amount != 0) {
          amountOut += converter.quoteRepay(address(this), tokens[indexAsset], tokens[i], amount);
        }
      }
    }

    return amountOut;
  }

  /////////////////////////////////////////////////////////////////////
  ///              Reduce size of ConverterStrategyBase
  /////////////////////////////////////////////////////////////////////
  /// @notice Make borrow and save amounts of tokens available for deposit to tokenAmounts
  /// @param thresholdMainAsset_ Min allowed value of collateral in terms of main asset, 0 - use default min value
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
    uint[] memory borrowedAmounts = new uint[](len);
    uint spentCollateral;
    tokenAmountsOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset_) {
        tokenAmountsOut[i] = collaterals_[i];
      } else {
        if (collaterals_[i] > 0) {
          uint collateral;
          AppLib.approveIfNeeded(tokens_[indexAsset_], collaterals_[i], address(tetuConverter_));
          (collateral, borrowedAmounts[i]) = _openPosition(
            tetuConverter_,
            "", // entry kind = 0: fixed collateral amount, max possible borrow amount
            tokens_[indexAsset_],
            tokens_[i],
            collaterals_[i],
            Math.max(thresholdMainAsset_, DEFAULT_LIQUIDATION_THRESHOLD)
          );
          // collateral should be equal to tokenAmounts[i] here because we use default entry kind
          spentCollateral += collateral;

          // zero amount are possible (conversion is not available) but it's not suitable for depositor
          require(borrowedAmounts[i] != 0, AppErrors.ZERO_AMOUNT_BORROWED);
        }
        tokenAmountsOut[i] = IERC20(tokens_[i]).balanceOf(address(this));
      }
    }
  }

  /// @notice Claim rewards from tetuConverter, generate result list of all available rewards and airdrops
  /// @dev The post-processing is rewards conversion to the main asset
  /// @param tokens_ tokens received from {_depositorPoolAssets}
  /// @param rewardTokens_ List of rewards claimed from the internal pool
  /// @param rewardTokens_ Amounts of rewards claimed from the internal pool
  /// @param tokensOut List of available rewards - not zero amounts, reward tokens don't repeat
  /// @param amountsOut Amounts of available rewards
  function prepareRewardsList(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_,
    uint[] memory balancesBefore
  ) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    // Rewards from TetuConverter
    (address[] memory tokensTC, uint[] memory amountsTC) = tetuConverter_.claimRewards(address(this));

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
      for(uint j; j < tokens_.length; j = AppLib.uncheckedInc(j)) {
        if (tokensOut[i] == tokens_[j]) {
          amountsOut[i] = IERC20(tokens_[j]).balanceOf(address(this)) - balancesBefore[j];
        }
      }
    }

    // filter zero amounts out
    (tokensOut, amountsOut) = TokenAmountsLib.filterZeroAmounts(tokensOut, amountsOut);
  }

  /////////////////////////////////////////////////////////////////////
  ///                       WITHDRAW HELPERS
  /////////////////////////////////////////////////////////////////////

  function postWithdrawActions(
    uint[] memory reserves,
    uint depositorLiquidity,
    uint liquidityAmount,
    uint totalSupply,
    uint[] memory amountsToConvert,

    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,

    uint _depositorLiquidityNew,
    uint[] memory withdrawnAmounts
  ) external returns (uint _expectedAmountMainAsset, uint[] memory _amountsToConvert){

    // estimate, how many assets should be withdrawn
    // the depositor is able to use less liquidity than it was asked
    // (i.e. Balancer-depositor leaves some BPT unused)
    // so, we need to fix liquidityAmount on this amount

    // we assume here, that liquidity cannot increase in _depositorExit
    uint depositorLiquidityDelta = depositorLiquidity - _depositorLiquidityNew;
    if (liquidityAmount > depositorLiquidityDelta) {
      liquidityAmount = depositorLiquidityDelta;
    }

    // now we can estimate expected amount of assets to be withdrawn
    uint[] memory expectedWithdrawAmounts = getExpectedWithdrawnAmounts(
      reserves,
      liquidityAmount,
      totalSupply
    );

    uint expectedAmountMainAsset = getExpectedAmountMainAsset(
      tokens,
      indexAsset,
      converter,
      expectedWithdrawAmounts,
      amountsToConvert
    );
    for (uint i; i < tokens.length; i = AppLib.uncheckedInc(i)) {
      amountsToConvert[i] += withdrawnAmounts[i];
    }

    return (expectedAmountMainAsset, amountsToConvert);
  }

  function postWithdrawActionsEmpty(
    address[] memory tokens,
    uint indexAsset,
    ITetuConverter converter,
    uint[] memory withdrawnAmounts_,
    uint[] memory amountsToConvert_
  ) external returns (uint[] memory withdrawnAmounts, uint expectedAmountMainAsset){
    withdrawnAmounts = withdrawnAmounts_;
    expectedAmountMainAsset = getExpectedAmountMainAsset(
      tokens,
      indexAsset,
      converter,
      withdrawnAmounts_,
      amountsToConvert_
    );
  }

  /////////////////////////////////////////////////////////////////////
  ///                      convertAfterWithdraw
  /////////////////////////////////////////////////////////////////////
  /// @notice Convert {p.amountsToConvert_} to the main asset
  /// @return collateralOut Total amount of collateral returned after closing positions
  /// @return repaidAmountsOut What amounts were spent in exchange of the {collateralOut}
  function convertAfterWithdraw(
    ITetuConverter tetuConverter,
    ITetuLiquidator liquidator,
    uint liquidationThreshold,
    address[] memory tokens,
    uint indexAsset,
    uint[] memory amountsToConvert
  ) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    ConvertAfterWithdrawLocalParams memory vars;
    vars.asset = tokens[indexAsset];

    uint len = tokens.length;
    repaidAmountsOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) continue;
      (vars.collateral, repaidAmountsOut[i]) = _closePosition(
        tetuConverter,
        vars.asset,
        tokens[i],
        amountsToConvert[i]
      );
      collateralOut += vars.collateral;
    }

    // Manually swap remain leftovers
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) continue;
      if (amountsToConvert[i] > repaidAmountsOut[i]) {
        (vars.spentAmountIn, vars.receivedAmountOut) = _liquidate(
          liquidator,
          tokens[i],
          vars.asset,
          amountsToConvert[i] - repaidAmountsOut[i],
          _ASSET_LIQUIDATION_SLIPPAGE,
          Math.max(liquidationThreshold, DEFAULT_LIQUIDATION_THRESHOLD)
        );
        if (vars.receivedAmountOut != 0) {
          collateralOut += vars.receivedAmountOut;
        }
        if (vars.spentAmountIn != 0) {
          repaidAmountsOut[i] += vars.spentAmountIn;
          require(
            tetuConverter.isConversionValid(
              tokens[i],
              vars.spentAmountIn,
              vars.asset,
              vars.receivedAmountOut,
              PRICE_IMPACT_TOLERANCE
            ),
            AppErrors.PRICE_IMPACT
          );
        }
      }
    }

    return (collateralOut, repaidAmountsOut);
  }

  /////////////////////////////////////////////////////////////////////
  ///                       OTHER HELPERS
  /////////////////////////////////////////////////////////////////////

  function getAssetPriceFromConverter(ITetuConverter converter, address token) external view returns (uint) {
    return IPriceOracle(IConverterController(converter.controller()).priceOracle()).getAssetPrice(token);
  }

  function registerIncome(
    uint assetBefore,
    uint assetAfter,
    uint earned,
    uint lost
  ) internal pure returns (uint _earned, uint _lost) {
    if (assetAfter > assetBefore) {
      earned += assetAfter - assetBefore;
    } else {
      lost += assetBefore - assetAfter;
    }
    return (earned, lost);
  }

}

