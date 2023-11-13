// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "./AlgebraLib.sol";
import "./AlgebraDebtLib.sol";
import "./AlgebraStrategyErrors.sol";
import "../../libs/AppLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../pair/PairBasedStrategyLogicLib.sol";
import "../../libs/BookkeeperLib.sol";

library AlgebraConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //region ------------------------------------------------ Constants
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  uint internal constant HARD_WORK_USD_FEE_THRESHOLD = 100;

  INonfungiblePositionManager internal constant ALGEBRA_NFT = INonfungiblePositionManager(0x8eF88E4c7CfbbaC1C163f7eddd4B578792201de6);
  IFarmingCenter internal constant FARMING_CENTER = IFarmingCenter(0x7F281A8cdF66eF5e9db8434Ec6D97acc1bc01E78);
  //endregion ------------------------------------------------ Constants

  //region ------------------------------------------------ Events
  event Rebalanced(uint loss, uint profitToCover, uint coveredByRewards);
  event RebalancedDebt(uint loss, uint profitToCover, uint coveredByRewards);
  event AlgebraFeesClaimed(uint fee0, uint fee1);
  event AlgebraRewardsClaimed(uint reward, uint bonusReward);
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Data types

  struct State {
    PairBasedStrategyLogicLib.PairState pair;
    // additional (specific) state

    uint tokenId;
    // farming
    address rewardToken;
    address bonusRewardToken;
    uint256 startTime;
    uint256 endTime;

    /// @notice reserve space for future needs
    uint[10] __gap;
  }

  struct RebalanceLocal {
    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams fuseAB;
    ITetuConverter converter;
    IAlgebraPool pool;
    address tokenA;
    address tokenB;
    bool isStablePool;
    uint[2] liquidationThresholdsAB;

    bool fuseStatusChangedAB;
    PairBasedStrategyLib.FuseStatus fuseStatusAB;

    uint poolPrice;
    uint poolPriceAdjustment;
  }

  struct EnterLocalVariables {
    bool depositorSwapTokens;
    uint128 liquidity;
    uint tokenId;
    int24 lowerTick;
    int24 upperTick;
  }

  struct IsReadyToHardWorkLocal {
    address tokenA;
    address tokenB;
    uint rewardInTermOfTokenA;
    uint bonusRewardInTermOfTokenA;
    uint fee0;
    uint fee1;
  }
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Helpers

  /// @param controllerPool [controller, pool]
  /// @param fuseThresholds Fuse thresholds for tokens (stable pool only)
  function initStrategyState(
    State storage state,
    address[2] calldata controllerPool,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    bool isStablePool,
    uint[4] calldata fuseThresholds
  ) external {
    require(controllerPool[1] != address(0), AppErrors.ZERO_ADDRESS);
    address token0 = IAlgebraPool(controllerPool[1]).token0();
    address token1 = IAlgebraPool(controllerPool[1]).token1();

    int24[4] memory tickData;
    {
      int24 tickSpacing = AlgebraLib.tickSpacing();
      if (tickRange != 0) {
        require(tickRange == tickRange / tickSpacing * tickSpacing, AlgebraStrategyErrors.INCORRECT_TICK_RANGE);
        require(rebalanceTickRange == rebalanceTickRange / tickSpacing * tickSpacing, AlgebraStrategyErrors.INCORRECT_REBALANCE_TICK_RANGE);
      }
      tickData[0] = tickSpacing;
      (tickData[1], tickData[2]) = AlgebraDebtLib.calcTickRange(IAlgebraPool(controllerPool[1]), tickRange, tickSpacing);
      tickData[3] = rebalanceTickRange;
    }

    PairBasedStrategyLogicLib.setInitialDepositorValues(
      state.pair,
      [controllerPool[1], asset_, token0, token1],
      tickData,
      isStablePool,
      fuseThresholds
    );

    address liquidator = IController(controllerPool[0]).liquidator();
    IERC20(token0).approve(liquidator, type(uint).max);
    IERC20(token1).approve(liquidator, type(uint).max);
    IERC20(token0).approve(address(ALGEBRA_NFT), type(uint).max);
    IERC20(token1).approve(address(ALGEBRA_NFT), type(uint).max);
  }

  function initFarmingState(
    State storage state,
    IncentiveKey calldata key
  ) external {
    state.rewardToken = key.rewardToken;
    state.bonusRewardToken = key.bonusRewardToken;
    state.startTime = key.startTime;
    state.endTime = key.endTime;
  }

  function createSpecificName(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (string memory) {
    return string(abi.encodePacked("Algebra ", IERC20Metadata(pairState.tokenA).symbol(), "/", IERC20Metadata(pairState.tokenB).symbol()));
  }

  function getIncentiveKey(State storage state) internal view returns (IncentiveKey memory) {
    return IncentiveKey(state.rewardToken, state.bonusRewardToken, state.pair.pool, state.startTime, state.endTime);
  }

  function getFees(State storage state) public view returns (uint fee0, uint fee1) {
    (fee0, fee1) = AlgebraLib.getFees(IAlgebraPool(state.pair.pool), ALGEBRA_NFT, state.tokenId);
  }

  function getPoolReserves(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (
    uint[] memory reserves
  ) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = IAlgebraPool(pairState.pool).globalState();

    (reserves[0], reserves[1]) = AlgebraLib.getAmountsForLiquidity(
      sqrtRatioX96,
      pairState.lowerTick,
      pairState.upperTick,
      pairState.totalLiquidity
    );

    if (pairState.depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  /// @dev Gets the liquidator swap slippage based on the pool type (stable or volatile).
  /// @return The liquidator swap slippage percentage.
  function _getLiquidatorSwapSlippage(bool isStablePool) internal pure returns (uint) {
    return isStablePool ? LIQUIDATOR_SWAP_SLIPPAGE_STABLE : LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE;
  }

  /// @notice Calculate proportions of the tokens for entry kind 1
  /// @param pool Pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return prop0 Proportion onf token A. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  /// @return prop1 Proportion onf token B. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  function getEntryDataProportions(IAlgebraPool pool, int24 lowerTick, int24 upperTick, bool depositorSwapTokens) external view returns (uint, uint) {
    return AlgebraDebtLib.getEntryDataProportions(pool, lowerTick, upperTick, depositorSwapTokens);
  }
  //endregion ------------------------------------------------ Helpers

  //region ------------------------------------------------ Join the pool

  function enter(
    State storage state,
    uint[] memory amountsDesired_
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    EnterLocalVariables memory vars = EnterLocalVariables({
      depositorSwapTokens : state.pair.depositorSwapTokens,
      liquidity : 0,
      tokenId : state.tokenId,
      lowerTick : state.pair.lowerTick,
      upperTick : state.pair.upperTick
    });

    (address token0, address token1) = vars.depositorSwapTokens
      ? (state.pair.tokenB, state.pair.tokenA)
      : (state.pair.tokenA, state.pair.tokenB);
    if (vars.depositorSwapTokens) {
      (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
    }

    amountsConsumed = new uint[](2);

    if (vars.tokenId > 0) {
      (,,,,int24 nftLowerTick, int24 nftUpperTick,,,,,) = ALGEBRA_NFT.positions(vars.tokenId);
      if (nftLowerTick != vars.lowerTick || nftUpperTick != vars.upperTick) {
        ALGEBRA_NFT.burn(vars.tokenId);
        vars.tokenId = 0;
      }
    }

    IncentiveKey memory key = getIncentiveKey(state);

    if (vars.tokenId == 0) {
      (vars.tokenId, vars.liquidity, amountsConsumed[0], amountsConsumed[1]) = ALGEBRA_NFT.mint(INonfungiblePositionManager.MintParams(
        token0,
        token1,
        vars.lowerTick,
        vars.upperTick,
        amountsDesired_[0],
        amountsDesired_[1],
        0,
        0,
        address(this),
        block.timestamp
      ));

      state.tokenId = vars.tokenId;

      ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), vars.tokenId);
    } else {
      (vars.liquidity, amountsConsumed[0], amountsConsumed[1]) = ALGEBRA_NFT.increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams(
        vars.tokenId,
        amountsDesired_[0],
        amountsDesired_[1],
        0,
        0,
        block.timestamp
      ));

      if (state.pair.totalLiquidity > 0) {
        // get reward amounts
        (uint reward, uint bonusReward) = FARMING_CENTER.collectRewards(key, vars.tokenId);

        // exit farming (undeposit)
        FARMING_CENTER.exitFarming(key, vars.tokenId, false);

        // claim rewards and send to profit holder
        {
          address strategyProfitHolder = state.pair.strategyProfitHolder;

          if (reward > 0) {
            address token = state.rewardToken;
            reward = FARMING_CENTER.claimReward(token, address(this), 0, reward);
            IERC20(token).safeTransfer(strategyProfitHolder, reward);
          }
          if (bonusReward > 0) {
            address token = state.bonusRewardToken;
            bonusReward = FARMING_CENTER.claimReward(token, address(this), 0, bonusReward);
            IERC20(token).safeTransfer(strategyProfitHolder, bonusReward);
          }
        }
      } else {
        ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), vars.tokenId);
      }
    }

    FARMING_CENTER.enterFarming(key, vars.tokenId, 0, false);

    state.pair.totalLiquidity += vars.liquidity;
    liquidityOut = uint(vars.liquidity);
  }
  //endregion ------------------------------------------------ Join the pool

  //region ------------------------------------------------ Exit the pool

  function exit(
    State storage state,
    uint128 liquidityAmountToExit
  ) external returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    address strategyProfitHolder = state.pair.strategyProfitHolder;
    IncentiveKey memory key = getIncentiveKey(state);

    uint128 liquidity = state.pair.totalLiquidity;

    require(liquidity >= liquidityAmountToExit, AlgebraStrategyErrors.WRONG_LIQUIDITY);

    // we assume here, that liquidity is not zero (otherwise it doesn't worth to call exit)
    uint tokenId = state.tokenId;

    // get reward amounts
    (uint reward, uint bonusReward) = FARMING_CENTER.collectRewards(key, tokenId);

    // exit farming (undeposit)
    FARMING_CENTER.exitFarming(getIncentiveKey(state), state.tokenId, false);

    // claim rewards and send to profit holder
    {
      if (reward > 0) {
        address token = state.rewardToken;
        reward = FARMING_CENTER.claimReward(token, address(this), 0, reward);
        IERC20(token).safeTransfer(strategyProfitHolder, reward);
      }
      if (bonusReward > 0) {
        address token = state.bonusRewardToken;
        bonusReward = FARMING_CENTER.claimReward(token, address(this), 0, bonusReward);
        IERC20(token).safeTransfer(strategyProfitHolder, bonusReward);
      }
    }

    // withdraw nft
    FARMING_CENTER.withdrawToken(tokenId, address(this), '');

    // burn liquidity
    (amountsOut[0], amountsOut[1]) = ALGEBRA_NFT.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams(tokenId, liquidityAmountToExit, 0, 0, block.timestamp));

    {
      // collect tokens and fee
      (uint collected0, uint collected1) = ALGEBRA_NFT.collect(INonfungiblePositionManager.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max));

      uint fee0 = collected0 > amountsOut[0] ? (collected0 - amountsOut[0]) : 0;
      uint fee1 = collected1 > amountsOut[1] ? (collected1 - amountsOut[1]) : 0;

      emit AlgebraFeesClaimed(fee0, fee1);

      if (state.pair.depositorSwapTokens) {
        (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
        (fee0, fee1) = (fee1, fee0);
      }

      // send fees to profit holder
      if (fee0 > 0) {
        IERC20(state.pair.tokenA).safeTransfer(strategyProfitHolder, fee0);
      }
      if (fee1 > 0) {
        IERC20(state.pair.tokenB).safeTransfer(strategyProfitHolder, fee1);
      }
    }

    liquidity -= liquidityAmountToExit;
    state.pair.totalLiquidity = liquidity;

    if (liquidity > 0) {
      ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), tokenId);
      FARMING_CENTER.enterFarming(key, tokenId, 0, false);
    }
  }

  function quoteExit(
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    (uint160 sqrtRatioX96, , , , , ,) = IAlgebraPool(pairState.pool).globalState();
    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = AlgebraLib.getAmountsForLiquidity(
      sqrtRatioX96,
      pairState.lowerTick,
      pairState.upperTick,
      liquidityAmountToExit
    );
    if (pairState.depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }
  //endregion ------------------------------------------------ Exit the pool

  //region ------------------------------------------------ Rewards

  function isReadyToHardWork(State storage state, ITetuConverter converter, address controller) external view returns (bool isReady) {
    IsReadyToHardWorkLocal memory v;
    v.tokenA = state.pair.tokenA;
    v.tokenB = state.pair.tokenB;
    address h = state.pair.strategyProfitHolder;

    if (state.pair.totalLiquidity != 0) {
      address rewardToken = state.rewardToken;
      address bonusRewardToken = state.bonusRewardToken;
      IncentiveKey memory key = getIncentiveKey(state);
      (uint reward, uint bonusReward) = FARMING_CENTER.eternalFarming().getRewardInfo(key, state.tokenId);
      reward += IERC20(rewardToken).balanceOf(h);
      bonusReward += IERC20(bonusRewardToken).balanceOf(h);
      ITetuLiquidator liquidator = ITetuLiquidator(IController(controller).liquidator());
      if (reward > 0) {
        v.rewardInTermOfTokenA = liquidator.getPrice(rewardToken, v.tokenA, reward);
      }
      if (v.bonusRewardInTermOfTokenA > 0) {
        v.bonusRewardInTermOfTokenA = liquidator.getPrice(bonusRewardToken, v.tokenA, bonusReward);
      }
      (v.fee0, v.fee1) = getFees(state);
    }

    // check claimable amounts and compare with thresholds
    if (state.pair.depositorSwapTokens) {
      (v.fee0, v.fee1) = (v.fee1, v.fee0);
    }

    v.fee0 += IERC20(v.tokenA).balanceOf(h);
    v.fee1 += IERC20(v.tokenB).balanceOf(h);

    IPriceOracle oracle = AppLib._getPriceOracle(converter);
    uint priceA = oracle.getAssetPrice(v.tokenA);
    uint priceB = oracle.getAssetPrice(v.tokenB);

    uint fee0USD = v.fee0 * priceA / 1e18;
    uint fee1USD = v.fee1 * priceB / 1e18;

    return
      fee0USD > HARD_WORK_USD_FEE_THRESHOLD
      || fee1USD > HARD_WORK_USD_FEE_THRESHOLD
      || v.rewardInTermOfTokenA * priceA / 1e18 > HARD_WORK_USD_FEE_THRESHOLD
      || v.bonusRewardInTermOfTokenA * priceA / 1e18 > HARD_WORK_USD_FEE_THRESHOLD
    ;
  }

  function claimRewards(State storage state) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    address strategyProfitHolder = state.pair.strategyProfitHolder;
    uint tokenId = state.tokenId;
    tokensOut = new address[](4);
    tokensOut[0] = state.pair.tokenA;
    tokensOut[1] = state.pair.tokenB;
    tokensOut[2] = state.rewardToken;
    tokensOut[3] = state.bonusRewardToken;

    balancesBefore = new uint[](4);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = IERC20(tokensOut[i]).balanceOf(address(this));
    }

    amountsOut = new uint[](4);
    if (tokenId > 0 && state.pair.totalLiquidity > 0) {
      (amountsOut[0], amountsOut[1]) = FARMING_CENTER.collect(INonfungiblePositionManager.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max));

      emit AlgebraFeesClaimed(amountsOut[0], amountsOut[1]);

      if (state.pair.depositorSwapTokens) {
        (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
      }

      (amountsOut[2], amountsOut[3]) = FARMING_CENTER.collectRewards(getIncentiveKey(state), tokenId);

      if (amountsOut[2] > 0) {
        amountsOut[2] = FARMING_CENTER.claimReward(tokensOut[2], address(this), 0, amountsOut[2]);
      }

      if (amountsOut[3] > 0) {
        amountsOut[3] = FARMING_CENTER.claimReward(tokensOut[3], address(this), 0, amountsOut[3]);
      }

      emit AlgebraRewardsClaimed(amountsOut[2], amountsOut[3]);
    }

    for (uint i; i < tokensOut.length; ++i) {
      uint b = IERC20(tokensOut[i]).balanceOf(strategyProfitHolder);
      if (b > 0) {
        IERC20(tokensOut[i]).transferFrom(strategyProfitHolder, address(this), b);
        amountsOut[i] += b;
      }
    }
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
  //endregion ------------------------------------------------ Rewards

  //region ------------------------------------------------ Rebalance

  /// @notice Determine if the strategy needs to be rebalanced.
  /// @return needRebalance A boolean indicating if {rebalanceNoSwaps} should be called
  function needStrategyRebalance(PairBasedStrategyLogicLib.PairState storage pairState, ITetuConverter converter_) external view returns (
    bool needRebalance
  ) {
    address pool = pairState.pool;
    // poolPrice should have same decimals as a price from oracle == 18
    uint poolPriceAdjustment = PairBasedStrategyLib.getPoolPriceAdjustment(IERC20Metadata(pairState.tokenA).decimals());
    uint poolPrice = AlgebraLib.getPrice(pool, pairState.tokenB) * poolPriceAdjustment;
    (needRebalance, , ) = PairBasedStrategyLogicLib.needStrategyRebalance(
      pairState,
      converter_,
      AlgebraDebtLib.getCurrentTick(IAlgebraPool(pool)),
      poolPrice
    );
  }

  /// @notice Make rebalance without swaps (using borrowing only).
  /// @param converterLiquidator [TetuConverter, TetuLiquidator]
  /// @param checkNeedRebalance_ True if the function should ensure that the rebalance is required
  /// @param totalAssets_ Current value of totalAssets()
  /// @return tokenAmounts Token amounts for deposit. If length == 0 - rebalance wasn't made and no deposit is required.
  function rebalanceNoSwaps(
    IConverterStrategyBase.ConverterStrategyBaseState storage csbs,
    PairBasedStrategyLogicLib.PairState storage pairState,
    address[2] calldata converterLiquidator,
    uint totalAssets_,
    uint profitToCover,
    address splitter,
    bool checkNeedRebalance_,
    mapping(address => uint) storage liquidityThresholds_
  ) external returns (
    uint[] memory tokenAmounts
  ) {
    RebalanceLocal memory v;
    _initLocalVars(v, ITetuConverter(converterLiquidator[0]), pairState, liquidityThresholds_);
    v.poolPrice = AlgebraLib.getPrice(address(v.pool), pairState.tokenB) * v.poolPriceAdjustment;
    bool needRebalance;
    int24 tick = AlgebraDebtLib.getCurrentTick(v.pool);
    (needRebalance, v.fuseStatusChangedAB, v.fuseStatusAB) = PairBasedStrategyLogicLib.needStrategyRebalance(
      pairState,
      v.converter,
      tick,
      v.poolPrice
    );

    // update fuse status if necessary
    if (needRebalance) {
      // we assume here, that needRebalance is true if any fuse has changed state, see needStrategyRebalance impl
      PairBasedStrategyLogicLib.updateFuseStatus(pairState, v.fuseStatusChangedAB, v.fuseStatusAB);
    }

    require(!checkNeedRebalance_ || needRebalance, AlgebraStrategyErrors.NO_REBALANCE_NEEDED);

    // rebalancing debt, setting new tick range
    if (needRebalance) {
      AlgebraDebtLib.rebalanceNoSwaps(converterLiquidator, pairState, profitToCover, totalAssets_, splitter, v.liquidationThresholdsAB, tick);

      uint loss;
      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmountsPair(v.converter, totalAssets_, v.tokenA, v.tokenB, v.liquidationThresholdsAB);

      if (loss != 0) {
        BookkeeperLib.coverLossAndCheckResults(csbs, splitter, loss);
      }
      emit Rebalanced(loss, profitToCover, 0);
    }

    return tokenAmounts;
  }

  /// @notice Initialize {v} by state values
  function _initLocalVars(
    RebalanceLocal memory v,
    ITetuConverter converter_,
    PairBasedStrategyLogicLib.PairState storage pairState,
    mapping(address => uint) storage liquidityThresholds_
  ) internal view {
    v.pool = IAlgebraPool(pairState.pool);
    v.fuseAB = pairState.fuseAB;
    v.converter = converter_;
    v.tokenA = pairState.tokenA;
    v.tokenB = pairState.tokenB;
    v.isStablePool = pairState.isStablePool;
    v.liquidationThresholdsAB[0] = AppLib._getLiquidationThreshold(liquidityThresholds_[v.tokenA]);
    v.liquidationThresholdsAB[1] = AppLib._getLiquidationThreshold(liquidityThresholds_[v.tokenB]);
    uint poolPriceDecimals = IERC20Metadata(v.tokenA).decimals();
    v.poolPriceAdjustment = poolPriceDecimals < 18 ? 10**(18 - poolPriceDecimals) : 1;
  }

  /// @notice Get proportion of not-underlying in the pool, [0...1e18]
  ///         prop.underlying : prop.not.underlying = 1e18 - PropNotUnderlying18 : propNotUnderlying18
  function getPropNotUnderlying18(PairBasedStrategyLogicLib.PairState storage pairState) view external returns (uint) {
    // get pool proportions
    IAlgebraPool pool = IAlgebraPool(pairState.pool);
    bool depositorSwapTokens = pairState.depositorSwapTokens;
    (int24 newLowerTick, int24 newUpperTick) = AlgebraDebtLib._calcNewTickRange(pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
    (uint consumed0, uint consumed1) = AlgebraDebtLib.getEntryDataProportions(pool, newLowerTick, newUpperTick, depositorSwapTokens);

    require(consumed0 + consumed1 > 0, AppErrors.ZERO_VALUE);
    return consumed1 * 1e18 / (consumed0 + consumed1);
  }
  //endregion ------------------------------------------------ Rebalance

  //region ------------------------------------------------ WithdrawByAgg
  /// @param addr_ [tokenToSwap, aggregator, controller, converter, splitter]
  /// @param values_ [amountToSwap_, profitToCover, oldTotalAssets, entryToPool]
  /// @return completed All debts were closed, leftovers were swapped to proper proportions
  /// @return tokenAmountsOut Amounts to be deposited to pool. This array is empty if no deposit allowed/required.
  function withdrawByAggStep(
    IConverterStrategyBase.ConverterStrategyBaseState storage csbs,
    address[5] calldata addr_,
    uint[4] calldata values_,
    bytes memory swapData,
    bytes memory planEntryData,
    PairBasedStrategyLogicLib.PairState storage pairState,
    mapping(address => uint) storage liquidationThresholds
  ) external returns (
    bool completed,
    uint[] memory tokenAmountsOut
  ) {
    address splitter = addr_[4];
    uint entryToPool = values_[3];
    address[2] memory tokens = [pairState.tokenA, pairState.tokenB];
    IAlgebraPool pool = IAlgebraPool(pairState.pool);

    // Calculate amounts to be deposited to pool, calculate loss, fix profitToCover
    uint[] memory tokenAmounts;
    uint loss;
    (completed, tokenAmounts, loss) = PairBasedStrategyLogicLib.withdrawByAggStep(addr_, values_, swapData, planEntryData, tokens, liquidationThresholds);

    // cover loss
    if (loss != 0) {
      BookkeeperLib.coverLossAndCheckResults(csbs, splitter, loss);
    }
    emit RebalancedDebt(loss, values_[1], 0);

    if (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED
      || (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
    ) {
      // We are going to enter to the pool: update lowerTick and upperTick, initialize tokenAmountsOut
      (pairState.lowerTick, pairState.upperTick) = AlgebraDebtLib._calcNewTickRange(pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
      tokenAmountsOut = tokenAmounts;
    }

    return (completed, tokenAmountsOut); // hide warning
  }
  //endregion ------------------------------------------------ WithdrawByAgg

}

