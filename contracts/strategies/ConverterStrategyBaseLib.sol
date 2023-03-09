// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IForwarder.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "../interfaces/converter/IPriceOracle.sol";
import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/IConverterController.sol";
import "../interfaces/converter/EntryKinds.sol";
import "../tools/AppErrors.sol";
import "../tools/AppLib.sol";
import "../tools/TokenAmountsLib.sol";

library ConverterStrategyBaseLib {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        DATA TYPES
  /////////////////////////////////////////////////////////////////////
  /// @notice Local vars for {_recycle}, workaround for stack too deep
  struct RecycleLocalParams {
    uint amountToCompound;
    uint amountToForward;
    address rewardToken;
    uint liquidationThresholdAsset;
    uint len;
    uint baseAmountIn;
    uint totalRewardAmounts;
  }

  /// @notice Input params for {_recycle}, workaround for stack too deep
  struct RecycleInputParams {
    address asset;
    uint compoundRatio;
    address[] tokens;
    ITetuLiquidator liquidator;
    address[] rewardTokens;
    uint[] rewardAmounts;
  }

  /// @notice Input params for {getLiquidityAmountRatio}
  /// @dev Workaround for stack too deep in {_withdrawUniversal}
  struct LiquidityAmountRatioInputParams {
    /// @notice Results of {_depositorPoolAssets}
    address[] tokens;
    /// @notice Index of the main asset in {tokens_}
    uint indexAsset;
    ITetuConverter converter;
    /// @notice Total amount of invested assets of the strategy
    uint investedAssets;
  }

  struct OpenPositionLocal {
    uint entryKind;
    address[] converters;
    uint[] collateralsRequired;
    uint[] amountsToBorrow;
    uint collateral;
    uint amountToBorrow;
  }

  struct OpenPositionEntryKind2Local {
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

  struct ConvertAfterWithdrawInputParams {
    ITetuConverter tetuConverter;
    ITetuLiquidator liquidator;
    uint liquidationThreshold;
    /// @notice Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
    address[] tokens;
    /// Index of main {asset} in {tokens}
    uint indexAsset;
    uint[] amountsToConvert;
  }

  struct ConvertAfterWithdrawLocalParams {
    address asset;
    uint collateral;
    uint spentAmountIn;
    uint receivedAmountOut;
  }

  /////////////////////////////////////////////////////////////////////
  ///                        Constants
  /////////////////////////////////////////////////////////////////////

  /// @notice approx one month for average block time 2 sec
  uint private constant _LOAN_PERIOD_IN_BLOCKS = 30 days / 2;
  uint private constant _REWARD_LIQUIDATION_SLIPPAGE = 5_000; // 5%
  uint private constant COMPOUND_DENOMINATOR = 100_000;
  uint private constant _ASSET_LIQUIDATION_SLIPPAGE = 500; // 0.5%
  uint private constant PRICE_IMPACT_TOLERANCE = 2_000; // 2%

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
  ) external pure returns (
    uint[] memory withdrawnAmountsOut
  ) {
    uint ratio = totalSupply_ == 0
      ? 0
      : (liquidityAmount_ >= totalSupply_
        ? 1e18
        : 1e18 * liquidityAmount_ / totalSupply_
    ); // we need brackets here for npm.run.coverage

    uint len = reserves_.length;
    withdrawnAmountsOut = new uint[](len);

    if (ratio != 0) {
      for (uint i; i < len; ++i) {
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
        uint tokenAmountToBeBorrowed =  amountAssetForToken
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
        decs[i] = 10**IERC20Metadata(tokens_[i]).decimals();
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

  /// @notice Get a ratio to calculate amount of liquidity that should be withdrawn from the pool to get {targetAmount_}
  ///               liquidityAmount = _depositorLiquidity() * {liquidityRatioOut} / 1e18
  ///         User needs to withdraw {targetAmount_} in main asset.
  ///         There are two kinds of available liquidity:
  ///         1) liquidity in the pool - {depositorLiquidity_}
  ///         2) Converted amounts on balance of the strategy - {baseAmounts_}
  ///         To withdraw {targetAmount_} we need
  ///         1) Reconvert converted amounts back to main asset
  ///         2) IF result amount is not necessary - extract withdraw some liquidity from the pool
  ///            and also convert it to the main asset.
  /// @dev This is a writable function with read-only behavior (because of the quote-call)
  /// @param targetAmount_ Required amount of main asset to be withdrawn from the strategy
  ///                      0 - withdraw all
  /// @param baseAmounts_ Available balances of the converted assets
  /// @param strategy_ Address of the strategy
  /// @param params_ To withdraw all set params_.investedAssets to zero
  function getLiquidityAmountRatio(
    uint targetAmount_,
    mapping(address => uint) storage baseAmounts_,
    address strategy_,
    LiquidityAmountRatioInputParams memory params_
  ) external returns (
    uint liquidityRatioOut,
    uint[] memory amountsToConvertOut
  ) {
    bool all = targetAmount_ == 0;
    uint investedAssets = params_.investedAssets;

    uint len = params_.tokens.length;
    amountsToConvertOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == params_.indexAsset) continue;

      uint baseAmount = baseAmounts_[params_.tokens[i]];
      if (baseAmount != 0) {
        // let's estimate collateral that we received back after repaying baseAmount
        uint expectedCollateral = params_.converter.quoteRepay(
          strategy_,
          params_.tokens[params_.indexAsset],
          params_.tokens[i],
          baseAmount
        );

        if (all || targetAmount_ != 0) {
          // We always repay WHOLE available baseAmount even if it gives us much more amount then we need.
          // We cannot repay a part of it because converter doesn't allow to know
          // what amount should be repaid to get given amount of collateral.
          // And it's too dangerous to assume that we can calculate this amount
          // by reducing baseAmount proportionally to expectedCollateral/targetAmount_
          amountsToConvertOut[i] = baseAmount;
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
    uint amountIn_
  ) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    OpenPositionLocal memory vars;
    // we assume here, that max possible collateral amount is already approved (as it's required by TetuConverter)
    vars.entryKind = EntryKinds.getEntryKind(entryData_);
    if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
      return openPositionEntryKind2(
        tetuConverter_,
        entryData_,
        collateralAsset_,
        borrowAsset_,
        amountIn_
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
          if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
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

      //!! console.log('>>> BORROW collateralAmount collateralAsset', collateralAmount, collateralAsset);
      //!! console.log('>>> BORROW borrowedAmount borrowAsset', borrowedAmountOut, borrowAsset);
      return (collateralAmountOut, borrowedAmountOut);
    }
  }

  function openPositionEntryKind2(
    ITetuConverter tetuConverter_,
    bytes memory entryData_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountIn_
  ) internal returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    OpenPositionEntryKind2Local memory vars;
    (vars.converters, vars.collateralsRequired, vars.amountsToBorrow, ) = tetuConverter_.findBorrowStrategies(
      entryData_,
      collateralAsset_,
      amountIn_,
      borrowAsset_,
      _LOAN_PERIOD_IN_BLOCKS
    );

    collateralAmountOut = 0; // hide warning
    borrowedAmountOut = 0; // hide warning


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
        // but if lending platform doesn't have enough liquidity
        // it reduces {collateralsRequired[i]} and {amountsToBorrow[i]} proportionally to fit the limits
        // as result, remaining C1 will be too big after conversion and we need to make another borrow
        vars.c3 = vars.alpha * vars.amountsToBorrow[i] / 1e18;
        vars.c1 = x * vars.c3 / y;
        vars.ratio = vars.collateralsRequired[i] + vars.c1 > amountIn_
          ? 1e18 * amountIn_ / (vars.collateralsRequired[i] + vars.c1)
          : 1e18;
        vars.collateral = vars.collateralsRequired[i] * vars.ratio / 1e18;
        vars.amountToBorrow = vars.amountsToBorrow[i] * vars.ratio / 1e18;

        require(
          tetuConverter_.borrow(
            vars.converters[i],
            collateralAsset_,
            vars.collateral,
            borrowAsset_,
            vars.amountToBorrow,
            address(this)
          ) == vars.amountToBorrow,
          AppErrors.WRONG_VALUE
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

        vars.c3 = vars.alpha * vars.amountToBorrow / 1e18;
        vars.c1 = x * vars.c3 / y;

        if (amountIn_ > vars.c1 + vars.collateral) {
          amountIn_ -= (vars.c1 + vars.collateral);
        } else {
          break;
        }
      }

      //!! console.log('>>> BORROW collateralAmount collateralAsset', collateralAmount, collateralAsset);
      //!! console.log('>>> BORROW borrowedAmount borrowAsset', borrowedAmountOut, borrowAsset);
      return (collateralAmountOut, borrowedAmountOut);
    }
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
    return 1e18 * priceBorrow * 10**IERC20Metadata(collateralAsset_).decimals()
                / priceCollateral / 10**IERC20Metadata(borrowAsset_).decimals();
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

    require(returnedBorrowAmountOut == 0, AppErrors.REPAY_MAKES_SWAP);
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
    uint liquidationThresholdForTokenOut_ // todo Probably it worth to use threshold for amount IN? it would be more gas efficient
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
    uint liquidationThresholdForTokenOut_ // todo Probably it worth to use threshold for amount IN? it would be more gas efficient
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
  /// @param baseAmounts_ Base amounts for rewards tokens
  ///                     The base amounts allow to separate just received and previously received rewards.
  /// @return receivedAmounts Received amounts of the tokens
  ///         This array has +1 item at the end: received amount of the main asset
  ///                                            there was no possibility to use separate var for it, stack too deep
  /// @return spentAmounts Spent amounts of the tokens
  /// @return amountsToForward Amounts to be sent to forwarder
  function recycle(
    address asset_,
    uint compoundRatio_,
    address[] memory tokens_,
    ITetuLiquidator liquidator_,
    mapping(address => uint) storage liquidationThresholds_,
    mapping(address => uint) storage baseAmounts_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) external returns (
    uint[] memory receivedAmounts,
    uint[] memory spentAmounts,
    uint[] memory amountsToForward
  ) {
    RecycleInputParams memory p = RecycleInputParams({
      asset: asset_,
      compoundRatio: compoundRatio_,
      tokens: tokens_,
      liquidator: liquidator_,
      rewardTokens: rewardTokens_,
      rewardAmounts: rewardAmounts_
    });
    (receivedAmounts, spentAmounts, amountsToForward) = _recycle(p, liquidationThresholds_, baseAmounts_);
  }

  /// @dev Implementation of {recycle}, input params are packed to a struct to avoid stack too deep.
  function _recycle(
    RecycleInputParams memory params,
    mapping(address => uint) storage liquidationThresholds,
    mapping(address => uint) storage baseAmounts
  ) internal returns (
    uint[] memory receivedAmounts,
    uint[] memory spentAmounts,
    uint[] memory amountsToForward
  ) {
    RecycleLocalParams memory p;

    p.len = params.rewardTokens.length;
    require(p.len == params.rewardAmounts.length, AppErrors.WRONG_LENGTHS);

    p.liquidationThresholdAsset = liquidationThresholds[params.asset];

    amountsToForward = new uint[](p.len);
    receivedAmounts = new uint[](p.len + 1);
    spentAmounts = new uint[](p.len);

    // split each amount on two parts: a part-to-compound and a part-to-transfer-to-the-forwarder
    for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
      p.rewardToken = params.rewardTokens[i];
      p.amountToCompound = params.rewardAmounts[i] * params.compoundRatio / COMPOUND_DENOMINATOR;

      if (p.amountToCompound > 0) {
        if (ConverterStrategyBaseLib.getAssetIndex(params.tokens, p.rewardToken) != type(uint).max) {
          // The asset is in the list of depositor's assets, liquidation is not allowed
          receivedAmounts[i] += p.amountToCompound;
        } else {
          p.baseAmountIn = baseAmounts[p.rewardToken];
          p.totalRewardAmounts = p.amountToCompound + p.baseAmountIn; // total amount that can be liquidated

          if (p.totalRewardAmounts < liquidationThresholds[p.rewardToken]) {
            // amount is too small, liquidation is not allowed
            receivedAmounts[i] += p.amountToCompound;
          } else {
            // The asset is not in the list of depositor's assets, its amount is big enough and should be liquidated
            // We assume here, that {token} cannot be equal to {_asset}
            // because the {_asset} is always included to the list of depositor's assets
            (uint spentAmountIn, uint receivedAmountOut) = _liquidate(
              params.liquidator,
              p.rewardToken,
              params.asset,
              p.totalRewardAmounts,
              _REWARD_LIQUIDATION_SLIPPAGE,
              p.liquidationThresholdAsset
            );

            // Adjust amounts after liquidation
            if (receivedAmountOut > 0) {
              receivedAmounts[p.len] += receivedAmountOut;
            }
            if (spentAmountIn == 0) {
              receivedAmounts[i] += p.amountToCompound;
            } else {
              require(spentAmountIn == p.amountToCompound + p.baseAmountIn, AppErrors.WRONG_VALUE);
              spentAmounts[i] += p.baseAmountIn;
            }
          }
        }
      }

      p.amountToForward = params.rewardAmounts[i] - p.amountToCompound;
      amountsToForward[i] = p.amountToForward;
    }

    return (receivedAmounts, spentAmounts, amountsToForward);
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
    ITetuConverter converter_,
    mapping(address => uint) storage baseAmounts
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
        uint toRepay = baseAmounts[tokens[i]] + amountsOut[i];

        (uint toPay, uint collateral) = converter_.getDebtAmountCurrent(address(this), tokens[indexAsset], tokens[i]);
        amountOut += collateral;
        if (toRepay >= toPay) {
          amountOut += (toRepay - toPay) * v.prices[i] * v.decs[indexAsset] / v.prices[indexAsset] / v.decs[i];
        } else {
          // there is not enough amount to pay the debt
          // let's register a debt and try to resolve it later below
          if (v.debts.length == 0) {
            v.debts = new uint[](v.len); // lazy initialization
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
  ///                      convertAfterWithdraw
  /////////////////////////////////////////////////////////////////////
  /// @notice Convert {p.amountsToConvert_} to the main asset
  /// @return collateralOut Total amount of collateral returned after closing positions
  /// @return repaidAmountsOut What amounts were spent in exchange of the {collateralOut}
  function convertAfterWithdraw(ConvertAfterWithdrawInputParams memory p) external returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    ConvertAfterWithdrawLocalParams memory vars;
    vars.asset = p.tokens[p.indexAsset];

    uint len = p.tokens.length;
    repaidAmountsOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == p.indexAsset) continue;
      (vars.collateral, repaidAmountsOut[i]) = _closePosition(
        p.tetuConverter,
        vars.asset,
        p.tokens[i],
        p.amountsToConvert[i]
      );
      collateralOut += vars.collateral;
    }

    // Manually swap remain leftovers
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == p.indexAsset) continue;
      if (p.amountsToConvert[i] > repaidAmountsOut[i]) {
        (vars.spentAmountIn, vars.receivedAmountOut) = _liquidate(
          p.liquidator,
          p.tokens[i],
          vars.asset,
          p.amountsToConvert[i] - repaidAmountsOut[i],
          _ASSET_LIQUIDATION_SLIPPAGE,
          p.liquidationThreshold
        );
        if (vars.receivedAmountOut != 0) {
          collateralOut += vars.receivedAmountOut;
        }
        if (vars.spentAmountIn != 0) {
          repaidAmountsOut[i] += vars.spentAmountIn;
          require(
            p.tetuConverter.isConversionValid(
              p.tokens[i],
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
  ///                      sendTokensToForwarder
  /////////////////////////////////////////////////////////////////////
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

    forwarder.registerIncome(tokens_, amounts_, ISplitter(splitter_).vault(), true);
  }

  /////////////////////////////////////////////////////////////////////
  ///                      getExpectedAmountMainAsset
  /////////////////////////////////////////////////////////////////////

  /// @notice Calculate expected amount of the main asset after withdrawing
  /// @param withdrawnAmounts_ Expected amounts to be withdrawn from the pool
  /// @param amountsToConvert_ Amounts on balance initially available for the conversion
  /// @return amountOut Expected amount of the main asset
  function getExpectedAmountMainAsset(
    LiquidityAmountRatioInputParams memory vars,
    uint[] memory withdrawnAmounts_,
    uint[] memory amountsToConvert_
  ) external returns (
    uint amountOut
  ) {
    uint len = vars.tokens.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == vars.indexAsset) {
        amountOut += withdrawnAmounts_[i];
      } else {
        uint amount = withdrawnAmounts_[i] + amountsToConvert_[i];
        if (amount != 0) {
          amountOut += vars.converter.quoteRepay(address(this), vars.tokens[vars.indexAsset], vars.tokens[i], amount);
        }
      }
    }

    return amountOut;
  }
}