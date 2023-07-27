// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./UniswapV3Lib.sol";
import "./UniswapV3DebtLib.sol";
import "./Uni3StrategyErrors.sol";
import "../../libs/AppLib.sol";
import "../../libs/AppErrors.sol";
import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "../pair/PairBasedStrategyLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

library UniswapV3ConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //region ------------------------------------------------ Constants
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  uint internal constant HARD_WORK_USD_FEE_THRESHOLD = 100;
  //endregion ------------------------------------------------ Constants

  //region ------------------------------------------------ Events
  event Rebalanced(uint loss, uint coveredByRewards);
  event UniV3FeesClaimed(uint fee0, uint fee1);
  //endregion ------------------------------------------------ Events

  //region ------------------------------------------------ Data types

  struct State {
    PairBasedStrategyLogicLib.PairState pair;

    // place for additional (specific) state
  }

  struct RebalanceLocal {
    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams[2] fuseAB;
    ITetuConverter converter;
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    bool isStablePool;

    bool[2] fuseStatusChangedAB;
    PairBasedStrategyLib.FuseStatus[2] fuseStatusAB;
  }

  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Helpers

  /// @dev Gets the liquidator swap slippage based on the pool type (stable or volatile).
  /// @param pool The IUniswapV3Pool instance.
  /// @return The liquidator swap slippage percentage.
  function _getLiquidatorSwapSlippage(IUniswapV3Pool pool) internal view returns (uint) {
    return isStablePool(pool) ? LIQUIDATOR_SWAP_SLIPPAGE_STABLE : LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE;
  }

  /// @notice Check if the given pool is a stable pool.
  /// @param pool The Uniswap V3 pool.
  /// @return A boolean indicating if the pool is stable.
  function isStablePool(IUniswapV3Pool pool) public view returns (bool) {
    return pool.fee() == 100;
  }

  /// @notice Get the token amounts held by the contract
  /// @param state The state of the pool.
  /// @return amountA The balance of tokenA.
  /// @return amountB The balance of tokenB.
  function getTokenAmounts(State storage state) external view returns (uint amountA, uint amountB) {
    amountA = AppLib.balance(state.pair.tokenA);
    amountB = AppLib.balance(state.pair.tokenB);
  }

  /// @param fuseThresholdsA Fuse thresholds for token A (stable pool only)
  /// @param fuseThresholdsB Fuse thresholds for token B (stable pool only)
  function initStrategyState(
    State storage state,
    address controller_,
    address pool,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
  ) external {
    require(pool != address(0), AppErrors.ZERO_ADDRESS);

    int24[4] memory tickData;
    {
      int24 tickSpacing = UniswapV3Lib.getTickSpacing(IUniswapV3Pool(pool).fee());
      if (tickRange != 0) {
        require(tickRange == tickRange / tickSpacing * tickSpacing, PairBasedStrategyLib.INCORRECT_TICK_RANGE);
        require(rebalanceTickRange == rebalanceTickRange / tickSpacing * tickSpacing, PairBasedStrategyLib.INCORRECT_REBALANCE_TICK_RANGE);
      }
      tickData[0] = tickSpacing;
      (tickData[1], tickData[2]) = UniswapV3DebtLib.calcTickRange(pool, tickRange, tickSpacing);
      tickData[3] = tickRange;
    }

    address[4] memory addr = [pool, asset_, IUniswapV3Pool(pool).token0(), IUniswapV3Pool(pool).token1()];
    PairBasedStrategyLogicLib._setInitialDepositorValues(
      state.pair,
      addr,
      tickData,
      isStablePool(IUniswapV3Pool(pool)),
      fuseThresholdsA,
      fuseThresholdsB
    );

    address liquidator = IController(controller_).liquidator();
    IERC20(addr[2]).approve(liquidator, type(uint).max); // token0
    IERC20(addr[3]).approve(liquidator, type(uint).max); // token1
  }

  function createSpecificName(State storage state) external view returns (string memory) {
    return string(abi.encodePacked(
      "UniV3 ",
      IERC20Metadata(state.pair.tokenA).symbol(),
      "/",
      IERC20Metadata(state.pair.tokenB).symbol(),
      "-",
      StringLib._toString(IUniswapV3Pool(state.pair.pool).fee()))
    );
  }
  //endregion ------------------------------------------------ Helpers

  //region ------------------------------------------------ Pool info
  /// @notice Retrieve the reserves of a Uniswap V3 pool managed by this contract.
  /// @param pairState The State storage containing the pool's information.
  /// @return reserves An array containing the reserve amounts of the contract owned liquidity.
  function getPoolReserves(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (
    uint[] memory reserves
  ) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = IUniswapV3Pool(pairState.pool).slot0();

    (reserves[0], reserves[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      pairState.lowerTick,
      pairState.upperTick,
      pairState.totalLiquidity
    );

    if (pairState.depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  /// @notice Retrieve the fees generated by a Uniswap V3 pool managed by this contract.
  /// @param pairState The State storage containing the pool's information.
  /// @return fee0 The fees generated for the first token in the pool.
  /// @return fee1 The fees generated for the second token in the pool.
  function getFees(PairBasedStrategyLogicLib.PairState storage pairState) public view returns (uint fee0, uint fee1) {
    UniswapV3Lib.PoolPosition memory position = UniswapV3Lib.PoolPosition(pairState.pool, pairState.lowerTick, pairState.upperTick, pairState.totalLiquidity, address(this));
    (fee0, fee1) = UniswapV3Lib.getFees(position);
  }

  /// @notice Estimate the exit amounts for a given liquidity amount in a Uniswap V3 pool.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @return amountsOut An array containing the estimated exit amounts for each token in the pool.
  function quoteExit(
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = IUniswapV3Pool(pairState.pool).slot0();

    (amountsOut[0], amountsOut[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      pairState.lowerTick,
      pairState.upperTick,
      liquidityAmountToExit
    );

    if (pairState.depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  /// @notice Get entry data for a Uniswap V3 pool.
  /// @param pool The Uniswap V3 pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return entryData A byte array containing the entry data for the pool.
  function getEntryData(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    return UniswapV3DebtLib.getEntryData(pool, lowerTick, upperTick, depositorSwapTokens);
  }
  //endregion ------------------------------------------------ Pool info

  //region ------------------------------------------------ Join the pool
  /// @notice Enter the pool and provide liquidity with desired token amounts.
  /// @param pool The Uniswap V3 pool to provide liquidity to.
  /// @param lowerTick The lower tick value for the pool.
  /// @param upperTick The upper tick value for the pool.
  /// @param amountsDesired_ An array containing the desired amounts of tokens to provide liquidity.
  /// @param totalLiquidity The current total liquidity in the pool.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsConsumed An array containing the consumed amounts for each token in the pool.
  /// @return liquidityOut The amount of liquidity added to the pool.
  /// @return totalLiquidityNew The updated total liquidity after providing liquidity.
  function enter(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    uint[] memory amountsDesired_,
    uint128 totalLiquidity,
    bool _depositorSwapTokens
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut, uint128 totalLiquidityNew) {
    amountsConsumed = new uint[](2);

    if (amountsDesired_[1] > 0) {
      if (_depositorSwapTokens) {
        (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
      }
      uint128 newLiquidity;
      (amountsConsumed[0], amountsConsumed[1], newLiquidity) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTick, upperTick, amountsDesired_[0], amountsDesired_[1]);
      pool.mint(address(this), lowerTick, upperTick, newLiquidity, "");
      liquidityOut = uint(newLiquidity);
      totalLiquidityNew = totalLiquidity + newLiquidity;
      if (_depositorSwapTokens) {
        (amountsConsumed[0], amountsConsumed[1]) = (amountsConsumed[1], amountsConsumed[0]);
      }
    }

    return (amountsConsumed, liquidityOut, totalLiquidityNew);
  }

  //endregion ------------------------------------------------ Join the pool

  //region ------------------------------------------------ Exit from the pool
  /// @notice Exit the pool and collect tokens proportional to the liquidity amount to exit.
  /// @param pairState The State storage object.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @return amountsOut An array containing the collected amounts for each token in the pool.
  function exit(
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint128 liquidityAmountToExit
  ) external returns (uint[] memory amountsOut) {
    IUniswapV3Pool pool = IUniswapV3Pool(pairState.pool);
    int24 lowerTick = pairState.lowerTick;
    int24 upperTick = pairState.upperTick;
    uint128 liquidity = pairState.totalLiquidity;
    bool _depositorSwapTokens = pairState.depositorSwapTokens;

    require(liquidity >= liquidityAmountToExit, Uni3StrategyErrors.WRONG_LIQUIDITY);

    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = pool.burn(lowerTick, upperTick, liquidityAmountToExit);
    // all fees will be collected but not returned in amountsOut
    pool.collect(address(this), lowerTick, upperTick, type(uint128).max, type(uint128).max);

    pairState.totalLiquidity = liquidity - liquidityAmountToExit;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }
  //endregion ------------------------------------------------ Exit from the pool

  //region ------------------------------------------------ Claims
  /// @notice Claim rewards from the Uniswap V3 pool.
  /// @return tokensOut An array containing tokenA and tokenB.
  /// @return amountsOut An array containing the amounts of token0 and token1 claimed as rewards.
  function claimRewards(PairBasedStrategyLogicLib.PairState storage pairState) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    address strategyProfitHolder = pairState.strategyProfitHolder;
    IUniswapV3Pool pool = IUniswapV3Pool(pairState.pool);
    int24 lowerTick = pairState.lowerTick;
    int24 upperTick = pairState.upperTick;
    tokensOut = new address[](2);
    tokensOut[0] = pairState.tokenA;
    tokensOut[1] = pairState.tokenB;

    balancesBefore = new uint[](2);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = IERC20(tokensOut[i]).balanceOf(address(this));
    }

    amountsOut = new uint[](2);
    if (pairState.totalLiquidity > 0) {
      pool.burn(lowerTick, upperTick, 0);
      (amountsOut[0], amountsOut[1]) = pool.collect(
        address(this),
        lowerTick,
        upperTick,
        type(uint128).max,
        type(uint128).max
      );
    }

    emit UniV3FeesClaimed(amountsOut[0], amountsOut[1]);

    if (pairState.depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }

    for (uint i; i < tokensOut.length; ++i) {
      uint b = IERC20(tokensOut[i]).balanceOf(strategyProfitHolder);
      if (b > 0) {
        IERC20(tokensOut[i]).transferFrom(strategyProfitHolder, address(this), b);
        amountsOut[i] += b;
      }
    }
  }

  function isReadyToHardWork(PairBasedStrategyLogicLib.PairState storage pairState, ITetuConverter converter) external view returns (
    bool isReady
  ) {
    // check claimable amounts and compare with thresholds
    (uint fee0, uint fee1) = getFees(pairState);

    if (pairState.depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

    address tokenA = pairState.tokenA;
    address tokenB = pairState.tokenB;
    address h = pairState.strategyProfitHolder;

    fee0 += IERC20(tokenA).balanceOf(h);
    fee1 += IERC20(tokenB).balanceOf(h);

    IPriceOracle oracle = AppLib._getPriceOracle(converter);
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);

    uint fee0USD = fee0 * priceA / 1e18;
    uint fee1USD = fee1 * priceB / 1e18;

    return fee0USD > HARD_WORK_USD_FEE_THRESHOLD || fee1USD > HARD_WORK_USD_FEE_THRESHOLD;
  }

  function sendFeeToProfitHolder(PairBasedStrategyLogicLib.PairState storage pairState, uint fee0, uint fee1) external {
    address strategyProfitHolder = pairState.strategyProfitHolder;
    require(strategyProfitHolder != address (0), Uni3StrategyErrors.ZERO_PROFIT_HOLDER);
    if (pairState.depositorSwapTokens) {
      IERC20(pairState.tokenA).safeTransfer(strategyProfitHolder, fee1);
      IERC20(pairState.tokenB).safeTransfer(strategyProfitHolder, fee0);
    } else {
      IERC20(pairState.tokenA).safeTransfer(strategyProfitHolder, fee0);
      IERC20(pairState.tokenB).safeTransfer(strategyProfitHolder, fee1);
    }
    emit UniV3FeesClaimed(fee0, fee1);
  }

  function calcEarned(address asset, address controller, address[] memory rewardTokens, uint[] memory amounts) external view returns (uint) {
    ITetuLiquidator liquidator = ITetuLiquidator(IController(controller).liquidator());
    uint len = rewardTokens.length;
    uint earned;
    for (uint i; i < len; ++i) {
      address token = rewardTokens[i];
      if (token == asset) {
        earned += amounts[i];
      } else {
        earned += liquidator.getPrice(rewardTokens[i], asset, amounts[i]);
      }
    }

    return earned;
  }
  //endregion ------------------------------------------------ Claims

  //region ------------------------------------------------ Rebalance
  /// @notice Determine if the strategy needs to be rebalanced.
  /// @return needRebalance A boolean indicating if {rebalanceNoSwaps} should be called
  function needStrategyRebalance(PairBasedStrategyLogicLib.PairState storage state, ITetuConverter converter_) external view returns (
    bool needRebalance
  ) {
    if (state.isStablePool) {
      address tokenA = state.tokenA;
      address tokenB = state.tokenB;
      (uint priceA, uint priceB) = ConverterStrategyBaseLib2.getOracleAssetsPrices(converter_, tokenA, tokenB);
      (bool fuseStatusChangedA, PairBasedStrategyLib.FuseStatus fuseStatusA) = PairBasedStrategyLib.needChangeFuseStatus(state.fuseAB[0], priceA);
      if (fuseStatusChangedA) {
        needRebalance = true;
      } else {
        (bool fuseStatusChangedB, PairBasedStrategyLib.FuseStatus fuseStatusB) = PairBasedStrategyLib.needChangeFuseStatus(state.fuseAB[1], priceB);
        if (fuseStatusChangedB) {
          needRebalance = true;
        } else {
          needRebalance =
              !PairBasedStrategyLib.isFuseTriggeredOn(fuseStatusA)
              && !PairBasedStrategyLib.isFuseTriggeredOn(fuseStatusB)
                && _needPoolRebalance(IUniswapV3Pool(state.pool), state);
        }
      }
    } else {
      needRebalance = _needPoolRebalance(IUniswapV3Pool(state.pool), state);
    }
  }

  /// @notice Determine if the pool needs to be rebalanced.
  /// @return A boolean indicating if the pool needs to be rebalanced.
  function _needPoolRebalance(IUniswapV3Pool pool_, PairBasedStrategyLogicLib.PairState storage pairState) internal view returns (bool) {
    (, int24 tick, , , , ,) = pool_.slot0();
    return PairBasedStrategyLogicLib._needPoolRebalance(
      tick,
      pairState.lowerTick,
      pairState.upperTick,
      pairState.tickSpacing,
      pairState.rebalanceTickRange
    );
  }

  /// @notice Make rebalance without swaps (using borrowing only).
  /// @param converterLiquidator [TetuConverter, TetuLiquidator]
  /// @param oldTotalAssets Current value of totalAssets()
  /// @param checkNeedRebalance_ True if the function should ensure that the rebalance is required
  /// @return tokenAmounts Token amounts for deposit. If length == 0 no deposit is required.
  function rebalanceNoSwaps(
    PairBasedStrategyLogicLib.PairState storage state,
    address[2] calldata converterLiquidator,
    uint oldTotalAssets,
    uint profitToCover,
    address splitter,
    bool checkNeedRebalance_,
    mapping(address => uint) storage liquidityThresholds_
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    RebalanceLocal memory v;
    _initLocalVars(v, ITetuConverter(converterLiquidator[0]), state);

    bool needRebalance;
    if (v.isStablePool) {
      uint[2] memory prices;
      (prices[0], prices[1]) = ConverterStrategyBaseLib2.getOracleAssetsPrices(v.converter, v.tokenA, v.tokenB);
      for (uint i = 0; i < 2; i = AppLib.uncheckedInc(i)) {
        (v.fuseStatusChangedAB[i], v.fuseStatusAB[i]) = PairBasedStrategyLib.needChangeFuseStatus(state.fuseAB[i], prices[i]);
      }

      // check if rebalance required and/or fuse-status is changed
      needRebalance =
          v.fuseStatusChangedAB[0]
          || v.fuseStatusChangedAB[1]
          || (
            !PairBasedStrategyLib.isFuseTriggeredOn(v.fuseStatusAB[0])
            && !PairBasedStrategyLib.isFuseTriggeredOn(v.fuseStatusAB[1])
            && _needPoolRebalance(v.pool, state)
          );

      // update fuse status if necessary
      for (uint i = 0; i < 2; i = AppLib.uncheckedInc(i)) {
        if (v.fuseStatusChangedAB[i]) {
          PairBasedStrategyLib.setFuseStatus(state.fuseAB[i], v.fuseStatusAB[i]);
          // if fuse is triggered ON, full-withdraw is required
          // if fuse is triggered OFF, the assets will be deposited back to pool
          // in both cases withdrawDone should be reset
          state.withdrawDone = 0;
        }
      }
    } else {
      needRebalance = _needPoolRebalance(v.pool, state);
    }

    require(checkNeedRebalance_ || needRebalance, Uni3StrategyErrors.NO_REBALANCE_NEEDED);

    // rebalancing debt, setting new tick range
    if (needRebalance) {
      UniswapV3DebtLib.rebalanceNoSwaps(converterLiquidator, state, profitToCover, oldTotalAssets, splitter, liquidityThresholds_);

      uint loss;
      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmounts(v.converter, oldTotalAssets, v.tokenA, v.tokenB);
      if (loss != 0) {
        _coverLoss(splitter, loss, state.strategyProfitHolder, v.tokenA, v.tokenB, address(v.pool));
      }
    }

    return tokenAmounts;
  }

  /// @notice Cover possible loss after call of {withdrawByAggStep}
  /// @param tokens [underlying, not-underlying]
  function afterWithdrawStep(
    ITetuConverter converter,
    IUniswapV3Pool pool,
    address[] memory tokens,
    uint oldTotalAssets,
    uint profitToCover,
    address strategyProfitHolder,
    address splitter
  ) internal returns (uint[] memory tokenAmounts) {
    if (profitToCover > 0) {
      uint profitToSend = Math.min(profitToCover, IERC20(tokens[0]).balanceOf(address(this)));
      ConverterStrategyBaseLib2.sendToInsurance(tokens[0], profitToSend, splitter, oldTotalAssets);
    }

    uint loss;
    (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmounts(converter, oldTotalAssets, tokens[0], tokens[1]);

    if (loss != 0) {
      _coverLoss(splitter, loss, strategyProfitHolder, tokens[0], tokens[1], address(pool));
    }
  }

  /// @notice Try to cover loss from rewards then cover remain loss from insurance.
  function _coverLoss(address splitter, uint loss, address profitHolder, address tokenA, address tokenB, address pool) internal {
    uint coveredByRewards;
    if (loss != 0) {
      coveredByRewards = UniswapV3DebtLib.coverLossFromRewards(loss, profitHolder, tokenA, tokenB, pool);
      uint notCovered = loss - coveredByRewards;
      if (notCovered != 0) {
        ISplitter(splitter).coverPossibleStrategyLoss(0, notCovered);
      }
    }

    emit Rebalanced(loss, coveredByRewards);
  }

  /// @notice Initialize {v} by state values
  function _initLocalVars(
    RebalanceLocal memory v,
    ITetuConverter converter_,
    PairBasedStrategyLogicLib.PairState storage pairState
  ) internal view {
    v.pool = IUniswapV3Pool(pairState.pool);
    v.fuseAB = pairState.fuseAB;
    v.converter = converter_;
    v.tokenA = pairState.tokenA;
    v.tokenB = pairState.tokenB;
    v.isStablePool = pairState.isStablePool;
  }

  /// @notice Get proportion of not-underlying in the pool, [0...1e18]
  ///         prop.underlying : prop.not.underlying = 1e18 - PropNotUnderlying18 : propNotUnderlying18
  function getPropNotUnderlying18(PairBasedStrategyLogicLib.PairState storage pairState) view external returns (uint) {
    // get pool proportions
    IUniswapV3Pool pool = IUniswapV3Pool(pairState.pool);
    bool depositorSwapTokens = pairState.depositorSwapTokens;
    (int24 newLowerTick, int24 newUpperTick) = UniswapV3DebtLib._calcNewTickRange(pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
    (uint consumed0, uint consumed1) = UniswapV3DebtLib.getEntryDataProportions(pool, newLowerTick, newUpperTick, depositorSwapTokens);

    require(consumed0 + consumed1 > 0, AppErrors.ZERO_VALUE);
    return consumed1 * 1e18 / (consumed0 + consumed1);
  }
  //endregion ------------------------------------------------ Rebalance

  //region ------------------------------------------------ WithdrawByAgg
  struct WithdrawByAggStepLocal {
    PairBasedStrategyLogicLib.WithdrawLocal w;
    address tokenToSwap;
    address aggregator;
    address controller;
    address converter;
    address asset;
    address splitter;
    IUniswapV3Pool pool;
    uint amountToSwap;
    uint profitToCover;
    uint oldTotalAssets;
    uint entryToPool;
    int24 newLowerTick;
    int24 newUpperTick;
    uint[] tokenAmounts;
  }

  /// @param addr_ [tokenToSwap, aggregator, controller, converter, asset, splitter]
  /// @param values_ [amountToSwap_, profitToCover, oldTotalAssets, entryToPool]
  /// @return completed All debts were closed, leftovers were swapped to proper proportions
  /// @return tokenAmounts Amounts to be deposited to pool. This array is empty if no deposit allowed/required.
  function withdrawByAggStep(
    address[6] calldata addr_,
    uint[4] calldata values_,
    bytes memory swapData,
    bytes memory planEntryData,
    PairBasedStrategyLogicLib.PairState storage pairState,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    bool completed,
    uint[] memory tokenAmounts
  ) {
    WithdrawByAggStepLocal memory v;

    v.tokenToSwap = addr_[0];
    v.aggregator = addr_[1];
    v.controller = addr_[2];
    v.converter = addr_[3];
    v.asset = addr_[4];
    v.splitter = addr_[5];

    v.amountToSwap = values_[0];
    v.profitToCover = values_[1];
    v.oldTotalAssets = values_[2];
    v.entryToPool = values_[3];

    v.pool = IUniswapV3Pool(pairState.pool);

    // check operator-only, initialize v
    PairBasedStrategyLogicLib.initWithdrawLocal(
      v.w,
      [pairState.tokenA, pairState.tokenB],
      v.asset,
      liquidationThresholds,
      planEntryData,
      v.controller
    );

    // make withdraw iteration according to the selected plan
    completed = PairBasedStrategyLib.withdrawStep(
      [v.converter, address(AppLib._getLiquidator(v.w.controller))],
      v.w.tokens,
      v.w.liquidationThresholds,
      v.tokenToSwap,
      v.amountToSwap,
      v.aggregator,
      swapData,
      v.aggregator == address(0),
      v.w.planKind,
      v.w.propNotUnderlying18
    );

    // fix loss / profitToCover
    v.tokenAmounts = UniswapV3ConverterStrategyLogicLib.afterWithdrawStep(
      ITetuConverter(v.converter),
      v.pool,
      v.w.tokens,
      v.oldTotalAssets,
      v.profitToCover,
      pairState.strategyProfitHolder,
      v.splitter
    );

    if (v.entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED
      || (v.entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
    ) {
      (v.newLowerTick, v.newUpperTick) = UniswapV3DebtLib._calcNewTickRange(v.pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
      pairState.lowerTick = v.newLowerTick;
      pairState.upperTick = v.newUpperTick;
      tokenAmounts = v.tokenAmounts;
    }

    return (completed, tokenAmounts);
  }
  //endregion ------------------------------------------------ WithdrawByAgg

}
