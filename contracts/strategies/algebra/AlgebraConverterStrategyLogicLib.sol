// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./AlgebraLib.sol";
import "./AlgebraDebtLib.sol";
import "./AlgebraStrategyErrors.sol";
import "../../libs/AppLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "../pair/PairBasedStrategyLogicLib.sol";


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
  event Rebalanced(uint loss, uint coveredByRewards);
  event AlgebraFeesClaimed(uint fee0, uint fee1);
  event AlgebraRewardsClaimed(uint reward, uint bonusReward);
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Data types

  struct State {
    IAlgebraPool pool;

    address tokenA;
    address tokenB;
    address strategyProfitHolder;

    bool isStablePool;
    bool depositorSwapTokens;

    int24 tickSpacing;
    int24 lowerTick;
    int24 upperTick;
    int24 rebalanceTickRange;
    uint128 totalLiquidity;

    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams[2] fuseAB;
    /// @notice 1 means that the fuse was triggered ON and then all debts were closed
    ///         and assets were converter to underlying using withdrawStepByAgg.
    ///         This flag is automatically cleared to 0 if fuse is triggered OFF.
    uint withdrawDone;

    uint tokenId;
    // farming
    address rewardToken;
    address bonusRewardToken;
    uint256 startTime;
    uint256 endTime;
  }

  struct RebalanceLocal {
    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams[2] fuseAB;
    ITetuConverter converter;
    IAlgebraPool pool;
    address tokenA;
    address tokenB;
    bool isStablePool;

    bool[2] fuseStatusChangedAB;
    PairBasedStrategyLib.FuseStatus[2] fuseStatusAB;
  }

  struct EnterLocalVariables {
    bool depositorSwapTokens;
    uint128 liquidity;
    uint tokenId;
    int24 lowerTick;
    int24 upperTick;
  }
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Helpers

  /// @param controllerPool [controller, pool]
  /// @param fuseThresholdsA Fuse thresholds for token A (stable pool only)
  /// @param fuseThresholdsB Fuse thresholds for token B (stable pool only)
  function initStrategyState(
    State storage state,
    address[2] calldata controllerPool,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    bool isStablePool,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
  ) external {
    require(controllerPool[1] != address(0), AppErrors.ZERO_ADDRESS);
    state.pool = IAlgebraPool(controllerPool[1]);

    state.isStablePool = isStablePool;

    state.rebalanceTickRange = rebalanceTickRange;

    _setInitialDepositorValues(
      state,
      IAlgebraPool(controllerPool[1]),
      tickRange,
      rebalanceTickRange,
      asset_
    );

    address liquidator = IController(controllerPool[0]).liquidator();
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    IERC20(tokenA).approve(liquidator, type(uint).max);
    IERC20(tokenB).approve(liquidator, type(uint).max);
    IERC20(tokenA).approve(address(ALGEBRA_NFT), type(uint).max);
    IERC20(tokenB).approve(address(ALGEBRA_NFT), type(uint).max);

    if (isStablePool) {
      /// for stable pools fuse can be enabled
      PairBasedStrategyLib.setFuseStatus(state.fuseAB[0], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(state.fuseAB[0], fuseThresholdsA);
      PairBasedStrategyLib.setFuseStatus(state.fuseAB[1], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(state.fuseAB[1], fuseThresholdsB);
    }
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

  function createSpecificName(State storage state) external view returns (string memory) {
    return string(abi.encodePacked("Algebra ", IERC20Metadata(state.tokenA).symbol(), "/", IERC20Metadata(state.tokenB).symbol()));
  }

  function getIncentiveKey(State storage state) internal view returns (IncentiveKey memory) {
    return IncentiveKey(state.rewardToken, state.bonusRewardToken, address(state.pool), state.startTime, state.endTime);
  }

  function getFees(State storage state) public view returns (uint fee0, uint fee1) {
    (fee0, fee1) = AlgebraLib.getFees(state.pool, ALGEBRA_NFT, state.tokenId);
  }

  function getPoolReserves(State storage state) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = state.pool.globalState();

    (reserves[0], reserves[1]) = AlgebraLib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTick,
      state.upperTick,
      state.totalLiquidity
    );

    if (state.depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  /// @dev Gets the liquidator swap slippage based on the pool type (stable or volatile).
  /// @return The liquidator swap slippage percentage.
  function _getLiquidatorSwapSlippage(bool isStablePool) internal pure returns (uint) {
    return isStablePool ? LIQUIDATOR_SWAP_SLIPPAGE_STABLE : LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE;
  }
  //endregion ------------------------------------------------ Helpers

  //region ------------------------------------------------ Pool info
  function getEntryData(
    IAlgebraPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    return AlgebraDebtLib.getEntryData(pool, lowerTick, upperTick, depositorSwapTokens);
  }
  //endregion ------------------------------------------------ Helpers

  //region ------------------------------------------------ Calculations

  /// @notice Calculate and set the initial values for a QuickSwap V3 pool Depositor.
  /// @param state Depositor storage state struct
  /// @param pool The QuickSwap V3 pool to get the initial values from.
  /// @param tickRange_ The tick range for the pool.
  /// @param rebalanceTickRange_ The rebalance tick range for the pool.
  /// @param asset_ Underlying asset of the depositor.
  function _setInitialDepositorValues(
    State storage state,
    IAlgebraPool pool,
    int24 tickRange_,
    int24 rebalanceTickRange_,
    address asset_
  ) internal {
    int24 tickSpacing = AlgebraLib.tickSpacing();
    if (tickRange_ != 0) {
      require(tickRange_ == tickRange_ / tickSpacing * tickSpacing, AlgebraStrategyErrors.INCORRECT_TICK_RANGE);
      require(rebalanceTickRange_ == rebalanceTickRange_ / tickSpacing * tickSpacing, AlgebraStrategyErrors.INCORRECT_REBALANCE_TICK_RANGE);
    }
    state.tickSpacing = tickSpacing;
    (state.lowerTick, state.upperTick) = AlgebraDebtLib.calcTickRange(pool, tickRange_, tickSpacing);
    require(asset_ == pool.token0() || asset_ == pool.token1(), AlgebraStrategyErrors.INCORRECT_ASSET);
    if (asset_ == pool.token0()) {
      state.tokenA = pool.token0();
      state.tokenB = pool.token1();
      state.depositorSwapTokens = false;
    } else {
      state.tokenA = pool.token1();
      state.tokenB = pool.token0();
      state.depositorSwapTokens = true;
    }
  }
  //endregion ------------------------------------------------ Helpers

  //region ------------------------------------------------ Join the pool

  function enter(
    State storage state,
    uint[] memory amountsDesired_
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    EnterLocalVariables memory vars = EnterLocalVariables({
      depositorSwapTokens : state.depositorSwapTokens,
      liquidity : 0,
      tokenId : state.tokenId,
      lowerTick : state.lowerTick,
      upperTick : state.upperTick
    });

    (address token0, address token1) = vars.depositorSwapTokens ? (state.tokenB, state.tokenA) : (state.tokenA, state.tokenB);
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

      if (state.totalLiquidity > 0) {

        // get reward amounts
        (uint reward, uint bonusReward) = FARMING_CENTER.collectRewards(key, vars.tokenId);

        // exit farming (undeposit)
        FARMING_CENTER.exitFarming(key, vars.tokenId, false);

        // claim rewards and send to profit holder
        {
          address strategyProfitHolder = state.strategyProfitHolder;

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

    state.totalLiquidity += vars.liquidity;
    liquidityOut = uint(vars.liquidity);
  }
  //endregion ------------------------------------------------ Join the pool

  //region ------------------------------------------------ Exit the pool

  function exit(
    State storage state,
    uint128 liquidityAmountToExit
  ) external returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    address strategyProfitHolder = state.strategyProfitHolder;
    IncentiveKey memory key = getIncentiveKey(state);

    uint128 liquidity = state.totalLiquidity;

    require(liquidity >= liquidityAmountToExit, AlgebraStrategyErrors.WRONG_LIQUIDITY);

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

      if (state.depositorSwapTokens) {
        (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
        (fee0, fee1) = (fee1, fee0);
      }

      // send fees to profit holder
      if (fee0 > 0) {
        IERC20(state.tokenA).safeTransfer(strategyProfitHolder, fee0);
      }
      if (fee1 > 0) {
        IERC20(state.tokenB).safeTransfer(strategyProfitHolder, fee1);
      }
    }

    liquidity -= liquidityAmountToExit;
    state.totalLiquidity = liquidity;

    if (liquidity > 0) {
      ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), tokenId);
      FARMING_CENTER.enterFarming(key, tokenId, 0, false);
    }
  }

  function quoteExit(
    State storage state,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    (uint160 sqrtRatioX96, , , , , ,) = state.pool.globalState();
    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = AlgebraLib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTick,
      state.upperTick,
      liquidityAmountToExit
    );
    if (state.depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }
  //endregion ------------------------------------------------ Exit the pool

  //region ------------------------------------------------ Rewards

  function isReadyToHardWork(State storage state, ITetuConverter converter, address controller) external view returns (bool isReady) {
    address tokenA = state.tokenA;
    uint rewardInTermOfTokenA;
    uint bonusRewardInTermOfTokenA;
    address h = state.strategyProfitHolder;

    {
      address rewardToken = state.rewardToken;
      address bonusRewardToken = state.bonusRewardToken;
      IncentiveKey memory key = getIncentiveKey(state);
      (uint reward, uint bonusReward) = FARMING_CENTER.eternalFarming().getRewardInfo(key, state.tokenId);
      reward += IERC20(rewardToken).balanceOf(h);
      bonusReward += IERC20(bonusRewardToken).balanceOf(h);
      ITetuLiquidator liquidator = ITetuLiquidator(IController(controller).liquidator());
      if (reward > 0) {
        rewardInTermOfTokenA = liquidator.getPrice(rewardToken, tokenA, reward);
      }
      if (bonusRewardInTermOfTokenA > 0) {
        bonusRewardInTermOfTokenA = liquidator.getPrice(bonusRewardToken, tokenA, bonusReward);
      }
    }

    address tokenB = state.tokenB;

    // check claimable amounts and compare with thresholds
    (uint fee0, uint fee1) = getFees(state);

    if (state.depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

    fee0 += IERC20(tokenA).balanceOf(h);
    fee1 += IERC20(tokenB).balanceOf(h);

    IPriceOracle oracle = AppLib._getPriceOracle(converter);
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);

    uint fee0USD = fee0 * priceA / 1e18;
    uint fee1USD = fee1 * priceB / 1e18;

    return
      fee0USD > HARD_WORK_USD_FEE_THRESHOLD
      || fee1USD > HARD_WORK_USD_FEE_THRESHOLD
      || rewardInTermOfTokenA * priceA / 1e18 > HARD_WORK_USD_FEE_THRESHOLD
      || bonusRewardInTermOfTokenA * priceA / 1e18 > HARD_WORK_USD_FEE_THRESHOLD
    ;
  }

  function claimRewards(State storage state) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    address strategyProfitHolder = state.strategyProfitHolder;
    uint tokenId = state.tokenId;
    tokensOut = new address[](4);
    tokensOut[0] = state.tokenA;
    tokensOut[1] = state.tokenB;
    tokensOut[2] = state.rewardToken;
    tokensOut[3] = state.bonusRewardToken;

    balancesBefore = new uint[](4);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = IERC20(tokensOut[i]).balanceOf(address(this));
    }

    amountsOut = new uint[](4);
    if (tokenId > 0 && state.totalLiquidity > 0) {
      (amountsOut[0], amountsOut[1]) = FARMING_CENTER.collect(INonfungiblePositionManager.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max));

      emit AlgebraFeesClaimed(amountsOut[0], amountsOut[1]);

      if (state.depositorSwapTokens) {
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
  function needStrategyRebalance(State storage state, ITetuConverter converter_) external view returns (bool needRebalance) {
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
                && _needPoolRebalance(state.pool, state);
        }
      }
    } else {
      needRebalance = _needPoolRebalance(state.pool, state);
    }
  }

  /// @notice Determine if the pool needs to be rebalanced.
  /// @return A boolean indicating if the pool needs to be rebalanced.
  function _needPoolRebalance(IAlgebraPool pool_, State storage state) internal view returns (bool) {
    (, int24 tick, , , , ,) = pool_.globalState();
    return PairBasedStrategyLogicLib._needPoolRebalance(
      tick,
      state.lowerTick,
      state.upperTick,
      state.tickSpacing,
      state.rebalanceTickRange
    );
  }

  /// @notice Make rebalance without swaps (using borrowing only).
  /// @param converterLiquidator [TetuConverter, TetuLiquidator]
  /// @param checkNeedRebalance_ True if the function should ensure that the rebalance is required
  /// @param oldTotalAssets Current value of totalAssets()
  /// @return tokenAmounts Token amounts for deposit. If length == 0 no deposit is required.
  function rebalanceNoSwaps(
    State storage state,
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

    require(checkNeedRebalance_ || needRebalance, AlgebraStrategyErrors.NO_REBALANCE_NEEDED);

    // rebalancing debt, setting new tick range
    if (needRebalance) {
      AlgebraDebtLib.rebalanceNoSwaps(converterLiquidator, state, profitToCover, oldTotalAssets, splitter, liquidityThresholds_);

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
    IAlgebraPool pool,
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
      coveredByRewards = AlgebraDebtLib.coverLossFromRewards(loss, profitHolder, tokenA, tokenB, pool);
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
    State storage state
  ) internal view {
    v.pool = state.pool;
    v.fuseAB = state.fuseAB;
    v.converter = converter_;
    v.tokenA = state.tokenA;
    v.tokenB = state.tokenB;
    v.isStablePool = state.isStablePool;
  }

  /// @notice Get proportion of not-underlying in the pool, [0...1e18]
  ///         prop.underlying : prop.not.underlying = 1e18 - PropNotUnderlying18 : propNotUnderlying18
  function getPropNotUnderlying18(State storage state) view external returns (uint) {
    // get pool proportions
    IAlgebraPool pool = state.pool;
    bool depositorSwapTokens = state.depositorSwapTokens;
    (int24 newLowerTick, int24 newUpperTick) = AlgebraDebtLib._calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    (uint consumed0, uint consumed1) = AlgebraDebtLib.getEntryDataProportions(pool, newLowerTick, newUpperTick, depositorSwapTokens);

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
    IAlgebraPool pool;
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
    State storage state,
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

    v.pool = state.pool;

    // check operator-only, initialize v
    PairBasedStrategyLogicLib.initWithdrawLocal(
      v.w,
      [state.tokenA, state.tokenB],
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
    v.tokenAmounts = AlgebraConverterStrategyLogicLib.afterWithdrawStep(
      ITetuConverter(v.converter),
      v.pool,
      v.w.tokens,
      v.oldTotalAssets,
      v.profitToCover,
      state.strategyProfitHolder,
      v.splitter
    );

    if (v.entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED
      || (v.entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
    ) {
      (v.newLowerTick, v.newUpperTick) = AlgebraDebtLib._calcNewTickRange(v.pool, state.lowerTick, state.upperTick, state.tickSpacing);
      state.lowerTick = v.newLowerTick;
      state.upperTick = v.newUpperTick;
      tokenAmounts = v.tokenAmounts;
    }

    return (completed, tokenAmounts);
  }
  //endregion ------------------------------------------------ WithdrawByAgg

}

