// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../ConverterStrategyBaseLib.sol";
import "../../interfaces/IPoolProportionsProvider.sol";
import "../../libs/BorrowLib.sol";
import "hardhat/console.sol";

/// @notice Library for the UniV3-like strategies with two tokens in the pool
/// @dev The library contains quoteWithdrawStep/withdrawStep-related logic
library PairBasedStrategyLib {
  //region ------------------------------------------------ Constants
  uint internal constant _ASSET_LIQUIDATION_SLIPPAGE = 300;
  /// @notice In all functions below array {token} contains underlying at the first position
  uint internal constant IDX_ASSET = 0;
  /// @notice In all functions below array {token} contains not-underlying at the second position
  uint internal constant IDX_TOKEN = 1;

  uint internal constant IDX_SWAP_1 = 0;
  uint internal constant IDX_REPAY_1 = 1;
  uint internal constant IDX_SWAP_2 = 2;
  uint internal constant IDX_REPAY_2 = 3;

  /// @notice A gap to reduce AmountToSwap calculated inside quoteWithdrawByAgg, [0...100_000]
  uint public constant GAP_AMOUNT_TO_SWAP = 100;

  /// @notice Enter to the pool at the end of withdrawByAggStep
  uint public constant ENTRY_TO_POOL_IS_ALLOWED = 1;
  /// @notice Enter to the pool at the end of withdrawByAggStep only if full withdrawing has been completed
  uint public constant ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;
  /// @notice Make rebalance-without-swaps at the end of withdrawByAggStep and enter to the pool after the rebalancing
  uint public constant ENTRY_TO_POOL_WITH_REBALANCE = 3;

  /// @notice Fuse thresholds are set as array: [LOWER_LIMIT_ON, LOWER_LIMIT_OFF, UPPER_LIMIT_ON, UPPER_LIMIT_OFF]
  ///         If the price falls below LOWER_LIMIT_ON the fuse is turned ON
  ///         When the prices raises back and reaches LOWER_LIMIT_OFF, the fuse is turned OFF
  ///         In the same way, if the price raises above UPPER_LIMIT_ON the fuse is turned ON
  ///         When the prices falls back and reaches UPPER_LIMIT_OFF, the fuse is turned OFF
  ///
  ///         Example: [0.9, 0.92, 1.08, 1.1]
  ///         Price falls below 0.9 - fuse is ON. Price rises back up to 0.92 - fuse is OFF.
  ///         Price raises more and reaches 1.1 - fuse is ON again. Price falls back and reaches 1.08 - fuse OFF again.
  uint public constant FUSE_IDX_LOWER_LIMIT_ON = 0;
  uint public constant FUSE_IDX_LOWER_LIMIT_OFF = 1;
  uint public constant FUSE_IDX_UPPER_LIMIT_ON = 2;
  uint public constant FUSE_IDX_UPPER_LIMIT_OFF = 3;


  /// @notice 1inch router V5
  address internal constant ONEINCH = 0x1111111254EEB25477B68fb85Ed929f73A960582;
  /// @notice OpenOceanExchangeProxy
  address internal constant OPENOCEAN = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64;

  string public constant UNKNOWN_SWAP_ROUTER = "PBS-1 Unknown router";
  //endregion ------------------------------------------------ Constants

  //region ------------------------------------------------ Data types
  /// @notice The fuse is triggered when the price rises above or falls below the limit 1.
  ///         If the fuse was triggered, all assets are withdrawn from the pool on the strategy balance.
  ///         Then all debts should be closed and all assets should be converted to underlying.
  ///         The fuse is turned off automatically when the price falls below or rises above the limit 2
  ///         and all assets are deposited back to the pool.
  enum FuseStatus {
    /// @notice Fuse is not used at all
    FUSE_DISABLED_0,
    /// @notice Fuse is not triggered, assets are deposited to the pool
    FUSE_OFF_1,
    /// @notice Fuse was triggered by lower limit, assets was withdrawn from the pool, but active debts can exist
    FUSE_ON_LOWER_LIMIT_2,
    /// @notice Fuse was triggered by upper limit, assets was withdrawn from the pool, but active debts can exist
    FUSE_ON_UPPER_LIMIT_3,
    /// @notice Fuse was triggered by lower limit, all debts were closed and assets are converted to underlying
    FUSE_ON_LOWER_LIMIT_UNDERLYING_4,
    /// @notice Fuse was triggered by upper limit, all debts were closed and assets are converted to underlying
    FUSE_ON_UPPER_LIMIT_UNDERLYING_5
  }

  struct SwapByAggParams {
    bool useLiquidator;
    address tokenToSwap;
    /// @notice Aggregator to make swap
    ///         It is 0 if useLiquidator is true
    ///         It can be equal to address of liquidator if we use liquidator as aggregator (in tests)
    address aggregator;
    uint amountToSwap;
    /// @notice Swap-data prepared off-chain (route, amounts, etc). 0 - use liquidator to make swap
    bytes swapData;
  }

  struct GetAmountToRepay2Local {
    uint x;
    uint y;
    uint c0;
    uint b0;
    uint alpha;
    int b;
  }

  struct FuseStateParams {
    FuseStatus status;
    /// @notice Price thresholds, see PairBasedStrategyLib.FUSE_IDX_XXX
    uint[4] thresholds;
  }
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Events
  event FuseStatusChanged(uint fuseStatus);
  event NewFuseThresholds(uint[4] newFuseThresholds);
  //endregion ------------------------------------------------ Events

  //region ------------------------------------------------ External withdraw functions

  /// @notice Get info for the swap that will be made on the next call of {withdrawStep}
  /// @param converterLiquidator_ [TetuConverter, TetuLiquidator]
  /// @param tokens Tokens used by depositor (length == 2: underlying and not-underlying)
  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  /// @param propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                            The leftovers should be swapped to get following result proportions of the assets:
  ///                            not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  ///                            Value type(uint).max means that the proportions should be read from the pool.
  /// @param amountsFromPool Amounts of {tokens} that will be received from the pool before calling withdraw
  /// @return tokenToSwap Address of the token that will be swapped on the next swap. 0 - no swap
  /// @return amountToSwap Amount that will be swapped on the next swap. 0 - no swap
  ///                      This amount is NOT reduced on {GAP_AMOUNT_TO_SWAP}, it should be reduced after the call if necessary.
  function quoteWithdrawStep(
    address[2] memory converterLiquidator_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    uint[] memory amountsFromPool,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ){
    (uint[] memory prices,
     uint[] memory decs
    ) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(ITetuConverter(converterLiquidator_[0])), tokens, 2);
    IterationPlanLib.SwapRepayPlanParams memory p = IterationPlanLib.SwapRepayPlanParams({
      converter: ITetuConverter(converterLiquidator_[0]),
      liquidator: ITetuLiquidator(converterLiquidator_[1]),
      tokens: tokens,
      liquidationThresholds: liquidationThresholds,
      propNotUnderlying18: propNotUnderlying18 == type(uint).max
        ? IPoolProportionsProvider(address(this)).getPropNotUnderlying18()
        : propNotUnderlying18,
      prices: prices,
      decs: decs,
      balanceAdditions: amountsFromPool,
      planKind: planKind,
      usePoolProportions: propNotUnderlying18 == type(uint).max
    });
    return _quoteWithdrawStep(p);
  }

  /// @notice Make withdraw step with 0 or 1 swap only. The step can make one of the following actions:
  ///         1) repay direct debt 2) repay reverse debt 3) final swap leftovers of not-underlying asset
  /// @param converterLiquidator_ [TetuConverter, TetuLiquidator]
  /// @param tokens Tokens used by depositor (length == 2: underlying and not-underlying)
  /// @param liquidationThresholds Liquidation thresholds for the {tokens}
  /// @param tokenToSwap_ Address of the token that will be swapped on the next swap. 0 - no swap
  /// @param amountToSwap_ Amount that will be swapped on the next swap. 0 - no swap
  /// @param aggregator_ Aggregator that should be used for the next swap. 0 - no swap
  /// @param swapData_ Swap data to be passed to the aggregator on the next swap.
  ///                  Swap data contains swap-route, amount and all other required info for the swap.
  ///                  Swap data should be prepared on-chain on the base of data received by {quoteWithdrawStep}
  /// @param useLiquidator_ Use liquidator instead of aggregator.
  ///                       Aggregator swaps amount reduced on {GAP_AMOUNT_TO_SWAP}.
  ///                       Liquidator doesn't use {GAP_AMOUNT_TO_SWAP}.
  ///                       It's allowed to pass liquidator address in {aggregator_} and set {useLiquidator_} to false -
  ///                       the liquidator will be used in same way as aggregator in this case.
  /// @param planKind One of IterationPlanLib.PLAN_XXX
  /// @param propNotUnderlying18 Required proportion of not-underlying for the final swap of leftovers, [0...1e18].
  ///                           The leftovers should be swapped to get following result proportions of the assets:
  ///                           not-underlying : underlying === propNotUnderlying18 : 1e18 - propNotUnderlying18
  /// @return completed All debts were closed, leftovers were swapped to the required proportions
  function withdrawStep(
    address[2] memory converterLiquidator_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    address tokenToSwap_,
    uint amountToSwap_,
    address aggregator_,
    bytes memory swapData_,
    bool useLiquidator_,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    bool completed
  ){
    (uint[] memory prices,
     uint[] memory decs
    ) = AppLib._getPricesAndDecs(AppLib._getPriceOracle(ITetuConverter(converterLiquidator_[0])), tokens, 2);

    IterationPlanLib.SwapRepayPlanParams memory p = IterationPlanLib.SwapRepayPlanParams({
      converter: ITetuConverter(converterLiquidator_[0]),
      liquidator: ITetuLiquidator(converterLiquidator_[1]),
      tokens: tokens,
      liquidationThresholds: liquidationThresholds,
      propNotUnderlying18: propNotUnderlying18 == type(uint).max
        ? IPoolProportionsProvider(address(this)).getPropNotUnderlying18()
        : propNotUnderlying18,
      prices: prices,
      decs: decs,
      balanceAdditions: new uint[](2), // 2 = tokens.length
      planKind: planKind,
      usePoolProportions: propNotUnderlying18 == type(uint).max
    });
    SwapByAggParams memory aggParams = SwapByAggParams({
      tokenToSwap: tokenToSwap_,
      amountToSwap: amountToSwap_,
      useLiquidator: useLiquidator_,
      aggregator: aggregator_,
      swapData: swapData_
    });
    return _withdrawStep(p, aggParams);
  }
  //endregion ------------------------------------------------ External withdraw functions

  //region ------------------------------------------------ Fuse functions
  function setFuseStatus(FuseStateParams storage fuse, FuseStatus status) external {
    fuse.status = status;
    emit FuseStatusChanged(uint(status));
  }

  function setFuseThresholds(FuseStateParams storage state, uint[4] memory values) external {
    require(
      (values[FUSE_IDX_LOWER_LIMIT_ON] == 0 && values[FUSE_IDX_LOWER_LIMIT_OFF] == 0)
      || (values[FUSE_IDX_LOWER_LIMIT_ON] <= values[FUSE_IDX_LOWER_LIMIT_OFF]),
      AppErrors.INVALID_VALUE
    );
    require(
      (values[FUSE_IDX_UPPER_LIMIT_ON] == 0 && values[FUSE_IDX_UPPER_LIMIT_OFF] == 0)
      || (values[FUSE_IDX_UPPER_LIMIT_ON] >= values[FUSE_IDX_UPPER_LIMIT_OFF]),
      AppErrors.INVALID_VALUE
    );
    if (values[FUSE_IDX_LOWER_LIMIT_ON] != 0 && values[FUSE_IDX_UPPER_LIMIT_ON] != 0) {
      require(
        values[FUSE_IDX_UPPER_LIMIT_ON] > values[FUSE_IDX_LOWER_LIMIT_ON],
        AppErrors.INVALID_VALUE
      );
    }
    state.thresholds = values;
    emit NewFuseThresholds(values);
  }

  function isFuseTriggeredOn(PairBasedStrategyLib.FuseStatus fuseStatus) internal pure returns (bool) {
    return uint(fuseStatus) > uint(PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
  }

  /// @notice Check if the fuse should be turned ON/OFF
  /// @param price Current price
  /// @return needToChange A boolean indicating if the fuse status should be changed
  /// @return status Exist fuse status or new fuse status (if needToChange is true)
  function needChangeFuseStatus(FuseStateParams memory fuse, uint price) internal view returns (
    bool needToChange,
    FuseStatus status
  ) {
    console.log("needChangeFuseStatus.1", uint(fuse.status));
    if (fuse.status != FuseStatus.FUSE_DISABLED_0) {
      console.log("needChangeFuseStatus.2");
      if (fuse.status == FuseStatus.FUSE_OFF_1) {
        console.log("needChangeFuseStatus.3");
        // currently fuse is OFF
        if (price <= fuse.thresholds[FUSE_IDX_LOWER_LIMIT_ON]) {
          console.log("needChangeFuseStatus.4");
          needToChange = true;
          status = FuseStatus.FUSE_ON_LOWER_LIMIT_2;
        } else if (price >= fuse.thresholds[FUSE_IDX_UPPER_LIMIT_ON]) {
          console.log("needChangeFuseStatus.5");
          needToChange = true;
          status = FuseStatus.FUSE_ON_UPPER_LIMIT_3;
        }
      } else {
        console.log("needChangeFuseStatus.6");
        if (fuse.status == FuseStatus.FUSE_ON_LOWER_LIMIT_2 || fuse.status == FuseStatus.FUSE_ON_LOWER_LIMIT_UNDERLYING_4) {
          console.log("needChangeFuseStatus.7");
          // currently fuse is triggered ON by lower limit
          if (price >= fuse.thresholds[FUSE_IDX_LOWER_LIMIT_OFF]) {
            console.log("needChangeFuseStatus.8");
            needToChange = true;
            if (price >= fuse.thresholds[FUSE_IDX_UPPER_LIMIT_ON]) {
              console.log("needChangeFuseStatus.9");
              status = FuseStatus.FUSE_ON_UPPER_LIMIT_3;
            } else {
              console.log("needChangeFuseStatus.10");
              status = FuseStatus.FUSE_OFF_1;
            }
          }
        } else {
          console.log("needChangeFuseStatus.11");
          // currently fuse is triggered ON by upper limit
          if (price <= fuse.thresholds[FUSE_IDX_UPPER_LIMIT_OFF]) {
            console.log("needChangeFuseStatus.12");
            needToChange = true;
            if (price <= fuse.thresholds[FUSE_IDX_LOWER_LIMIT_OFF]) {
              console.log("needChangeFuseStatus.13");
              status = FuseStatus.FUSE_ON_LOWER_LIMIT_2;
            } else {
              console.log("needChangeFuseStatus.14");
              status = FuseStatus.FUSE_OFF_1;
            }
          }
        }
      }
    }
    console.log("needChangeFuseStatus.15.needToChange", needToChange);
    console.log("needChangeFuseStatus.15.status", uint(needToChange ? status : fuse.status));

    return (needToChange, needToChange ? status : fuse.status);
  }
  //endregion ------------------------------------------------ Fuse functions

  //region ------------------------------------------------ Internal helper functions
  /// @notice Quote amount of the next swap if any.
  ///         Swaps are required if direct-borrow exists OR reverse-borrow exists or not underlying leftovers exist
  ///         Function returns info for first swap only.
  /// @return tokenToSwap What token should be swapped. Zero address if no swap is required
  /// @return amountToSwap Amount to swap. Zero if no swap is required.
  function _quoteWithdrawStep(IterationPlanLib.SwapRepayPlanParams memory p) internal returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    uint indexTokenToSwapPlus1;
    (indexTokenToSwapPlus1, amountToSwap,) = IterationPlanLib.buildIterationPlan(
      [address(p.converter), address(p.liquidator)],
      p.tokens,
      p.liquidationThresholds,
      p.prices,
      p.decs,
      p.balanceAdditions,
      [
        p.usePoolProportions ? 1 : 0,
        p.planKind,
        p.propNotUnderlying18,
        type(uint).max,
        IDX_ASSET,
        IDX_TOKEN
      ]
    );
    if (indexTokenToSwapPlus1 != 0) {
      tokenToSwap = p.tokens[indexTokenToSwapPlus1 - 1];
    }
    return (tokenToSwap, amountToSwap);
  }

  /// @notice Make one iteration of withdraw. Each iteration can make 0 or 1 swap only
  ///         We can make only 1 of the following 3 operations per single call:
  ///         1) repay direct debt 2) repay reverse debt 3) swap leftovers to underlying
  function _withdrawStep(IterationPlanLib.SwapRepayPlanParams memory p, SwapByAggParams memory aggParams) internal returns (
    bool completed
  ) {
    (uint idxToSwap1, uint amountToSwap, uint idxToRepay1) = IterationPlanLib.buildIterationPlan(
      [address(p.converter), address(p.liquidator)],
      p.tokens,
      p.liquidationThresholds,
      p.prices,
      p.decs,
      p.balanceAdditions,
      [
        p.usePoolProportions ? 1 : 0,
        p.planKind,
        p.propNotUnderlying18,
        type(uint).max,
        IDX_ASSET,
        IDX_TOKEN
      ]
    );

    bool[4] memory actions = [
      p.planKind == IterationPlanLib.PLAN_SWAP_ONLY || p.planKind == IterationPlanLib.PLAN_SWAP_REPAY, // swap 1
      p.planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY || p.planKind == IterationPlanLib.PLAN_SWAP_REPAY, // repay 1
      p.planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY, // swap 2
      p.planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY // repay 2
    ];

    if (idxToSwap1 != 0 && actions[IDX_SWAP_1]) {
      (, p.propNotUnderlying18) = _swap(p, aggParams, idxToSwap1 - 1, idxToSwap1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET, amountToSwap);
    }

    if (idxToRepay1 != 0 && actions[IDX_REPAY_1]) {
      ConverterStrategyBaseLib._repayDebt(
        p.converter,
        p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET],
        p.tokens[idxToRepay1 - 1],
        IERC20(p.tokens[idxToRepay1 - 1]).balanceOf(address(this))
      );
    }

    if (idxToSwap1 != 0 && actions[IDX_SWAP_2]) {
      (, p.propNotUnderlying18) = _swap(p, aggParams, idxToSwap1 - 1, idxToSwap1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET, amountToSwap);

      if (actions[IDX_REPAY_2]) {
        // see calculations inside estimateSwapAmountForRepaySwapRepay
        // There are two possibilities here:
        // 1) All collateral asset available on balance was swapped. We need additional repay to get assets in right proportions
        // 2) Only part of collateral asset was swapped, so assets are already in right proportions. Repay 2 is not needed
        (uint amountToRepay2, bool borrowInsteadRepay) = _getAmountToRepay2(
          p,
          idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET,
          idxToRepay1 - 1
        );

        if (borrowInsteadRepay) {
          borrowToProportions(p, idxToRepay1 - 1, idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET);
        } else if (amountToRepay2 > p.liquidationThresholds[idxToRepay1 - 1]) {
          // we need to know repaidAmount
          // we cannot relay on the value returned by _repayDebt because of SCB-710, we need to check balances
          // temporary save current balance to repaidAmount
          uint repaidAmount = IERC20(p.tokens[idxToRepay1 - 1]).balanceOf(address(this));

          ConverterStrategyBaseLib._repayDebt(
            p.converter,
            p.tokens[idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET],
            p.tokens[idxToRepay1 - 1],
            amountToRepay2
          );
          uint balanceAfter = IERC20(p.tokens[idxToRepay1 - 1]).balanceOf(address(this));
          repaidAmount = repaidAmount > balanceAfter
            ? repaidAmount - balanceAfter
            : 0;

          if (repaidAmount < amountToRepay2 && amountToRepay2 - repaidAmount > p.liquidationThresholds[idxToRepay1 - 1]) {
            borrowToProportions(p, idxToRepay1 - 1, idxToRepay1 - 1 == IDX_ASSET ? IDX_TOKEN : IDX_ASSET);
          }
        }
      }
    }

    // Withdraw is completed on last iteration (no debts, swapping leftovers)
    return idxToRepay1 == 0;
  }

  /// @notice borrow borrow-asset under collateral-asset, result balances should match to propNotUnderlying18
  function borrowToProportions(
    IterationPlanLib.SwapRepayPlanParams memory p,
    uint indexCollateral,
    uint indexBorrow
  ) internal {
    BorrowLib.RebalanceAssetsCore memory cac = BorrowLib.RebalanceAssetsCore({
      converterLiquidator: BorrowLib.ConverterLiquidator(p.converter, p.liquidator),
      assetA: p.tokens[indexCollateral],
      assetB: p.tokens[indexBorrow],
      propA: indexCollateral == IDX_ASSET ? 1e18 - p.propNotUnderlying18 : p.propNotUnderlying18,
      propB: indexCollateral == IDX_ASSET ? p.propNotUnderlying18 : 1e18 - p.propNotUnderlying18,
      // {assetA} to {assetB} ratio; {amountB} * {alpha} => {amountA}, decimals 18
      alpha18: 1e18 * p.prices[indexBorrow] * p.decs[indexCollateral] / p.prices[indexCollateral] / p.decs[indexBorrow],
      thresholdA: p.liquidationThresholds[indexCollateral],
      addonA: 0,
      addonB: 0,
      indexA: indexCollateral,
      indexB: indexBorrow
    });

    // we are going to change direction of the borrow
    // let's ensure that there is no debt in opposite direction
    (uint needToRepay,) = p.converter.getDebtAmountStored(address(this), p.tokens[indexBorrow],  p.tokens[indexCollateral], false);
    require(needToRepay == 0, AppErrors.OPPOSITE_DEBT_EXISTS);

    BorrowLib.openPosition(
      cac,
      BorrowLib.PricesDecs({
        prices: p.prices,
        decs: p.decs
      }),
      IERC20(p.tokens[indexCollateral]).balanceOf(address(this)),
      IERC20(p.tokens[indexBorrow]).balanceOf(address(this))
    );
  }

  /// @notice Calculate amount that should be repaid to get right proportions of assets on balance
  ///         Analyse only single borrow-direction: indexCollateral => indexBorrow
  /// @return amountToRepay Amount that should be repaid
  /// @return borrowInsteadRepay true if repay is not necessary at all and borrow is required instead
  ///                            if we need both repay and borrow then false is returned
  function _getAmountToRepay2(
    IterationPlanLib.SwapRepayPlanParams memory p,
    uint indexCollateral,
    uint indexBorrow
  ) internal view returns (
    uint amountToRepay,
    bool borrowInsteadRepay
  ) {
    GetAmountToRepay2Local memory v;
    v.c0 = IERC20(p.tokens[indexCollateral]).balanceOf(address(this)) * p.prices[indexCollateral] / p.decs[indexCollateral];
    v.b0 = IERC20(p.tokens[indexBorrow]).balanceOf(address(this)) * p.prices[indexBorrow] / p.decs[indexBorrow];

    v.x = indexCollateral == IDX_ASSET ? 1e18 - p.propNotUnderlying18 : p.propNotUnderlying18;
    v.y = indexCollateral == IDX_ASSET ? p.propNotUnderlying18 : 1e18 - p.propNotUnderlying18;
    v.alpha = p.prices[indexCollateral] * p.decs[indexBorrow] * 1e18 / p.prices[indexBorrow] / p.decs[indexCollateral];

    (uint needToRepay, uint collateralAmountOut) = p.converter.getDebtAmountStored(
      address(this),
      p.tokens[indexCollateral],
      p.tokens[indexBorrow],
      true
    );

    if (needToRepay == 0) {
      // check if we need to make reverse borrow to fit to proportions: borrow collateral-asset under borrow-asset
      uint targetCollateral = (v.c0 + v.b0) * v.x / (v.x + v.y);
      borrowInsteadRepay = targetCollateral > v.c0
        && targetCollateral - v.c0
        > (p.liquidationThresholds[indexCollateral] * p.prices[indexCollateral] / p.decs[indexCollateral]);
    } else {
      // initial balances: c0, b0
      // we are going to repay amount b and receive (betta * b, b), where betta ~ alpha * totalCollateral / totalBorrow
      // we should have x/y = (c0 + betta * b) / (b0 - b)
      // so b = (x * b0 - y * c0) / (betta * y + x)
      v.b = (int(v.x * v.b0) - int(v.y * v.c0)) / (int(v.y * v.alpha * collateralAmountOut / needToRepay / 1e18) + int(v.x));
      if (v.b > 0) {
        amountToRepay = uint(v.b);
      }
    }

    return (amountToRepay * p.decs[indexBorrow] / p.prices[indexBorrow], borrowInsteadRepay);
  }

  /// @notice Swap {aggParams.amountToSwap} using either liquidator or aggregator
  /// @dev You can use liquidator as aggregator, so aggregator's logic will be used for the liquidator
  /// @param amountIn Calculated amount to be swapped. It can be different from {aggParams.amountToSwap} a bit,
  ///                 but aggregators require exact value {aggParams.amountToSwap}, so amountIn is not used with agg.
  function _swap(
    IterationPlanLib.SwapRepayPlanParams memory p,
    SwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) internal returns (
    uint spentAmountIn,
    uint updatedPropNotUnderlying18
  ) {
    // liquidator and aggregator have different logic here:
    // - liquidator uses amountIn to swap
    // - Aggregator uses amountToSwap for which a route was built off-chain before the call of the swap()
    // It's allowed to use aggregator == liquidator, so in this way liquidator will use aggregator's logic (for tests)

    if (!aggParams.useLiquidator) {
      // aggregator requires exact input amount - aggParams.amountToSwap
      // actual amount can be a bit different because the quote function was called in different block
      amountIn = aggParams.amountToSwap;
    }
    address aggregator = aggParams.useLiquidator
      ? address(p.liquidator)
      : aggParams.aggregator;

    require(amountIn <= IERC20(p.tokens[indexIn]).balanceOf(address(this)), AppErrors.NOT_ENOUGH_BALANCE);
    // let's ensure that "next swap" is made using correct token
    require(aggParams.tokenToSwap == p.tokens[indexIn], AppErrors.INCORRECT_SWAP_BY_AGG_PARAM);

    if (amountIn > AppLib._getLiquidationThreshold(p.liquidationThresholds[indexIn])) {
      AppLib.approveIfNeeded(p.tokens[indexIn], amountIn, aggregator);

      uint balanceTokenOutBefore = AppLib.balance(p.tokens[indexOut]);

      if (aggParams.useLiquidator) {
        (spentAmountIn,) = ConverterStrategyBaseLib._liquidate(
          p.converter,
          ITetuLiquidator(aggregator),
          p.tokens[indexIn],
          p.tokens[indexOut],
          amountIn,
          _ASSET_LIQUIDATION_SLIPPAGE,
          p.liquidationThresholds[indexIn],
          true
        );
      } else {
        if (aggregator != address(p.liquidator)) {
          _checkSwapRouter(aggregator);
        }

        (bool success, bytes memory result) = aggregator.call(aggParams.swapData);
        require(success, string(result));

        spentAmountIn = amountIn;
      }

      require(
        p.converter.isConversionValid(
          p.tokens[indexIn],
          amountIn,
          p.tokens[indexOut],
          AppLib.balance(p.tokens[indexOut]) - balanceTokenOutBefore,
          _ASSET_LIQUIDATION_SLIPPAGE
        ), AppErrors.PRICE_IMPACT);
    }

    return (
      spentAmountIn,
    // p.propNotUnderlying18 contains original proportions that were vaild before the swap
    // after swap() we need to re-read new values from the pool
      p.usePoolProportions
        ? IPoolProportionsProvider(address(this)).getPropNotUnderlying18()
      : p.propNotUnderlying18
    );
  }
  //endregion ------------------------------------------------ Internal helper functions

  //region ----------------------------------------- Utils
  function _checkSwapRouter(address router) internal pure {
    require(router == ONEINCH || router == OPENOCEAN, UNKNOWN_SWAP_ROUTER);
  }

  /// @notice Extract propNotUnderlying18 from {planEntryData} of the given {planKind}
  function _extractProp(uint planKind, bytes memory planEntryData) internal pure returns(uint propNotUnderlying18) {
    if (planKind == IterationPlanLib.PLAN_SWAP_REPAY || planKind == IterationPlanLib.PLAN_SWAP_ONLY) {
      // custom proportions
      (, propNotUnderlying18) = abi.decode(planEntryData, (uint, uint));
      require(propNotUnderlying18 <= 1e18, AppErrors.WRONG_VALUE); // 0 is allowed
    } else if (planKind == IterationPlanLib.PLAN_REPAY_SWAP_REPAY) {
      // the proportions should be taken from the pool
      // new value of the proportions should also be read from the pool after each swap
      propNotUnderlying18 = type(uint).max;
    }

    return propNotUnderlying18;
  }
  //endregion ------------------------------------------ Utils
}