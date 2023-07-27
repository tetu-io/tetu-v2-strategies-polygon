// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./KyberLib.sol";
import "./KyberDebtLib.sol";
import "./KyberStrategyErrors.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

library KyberConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //region ------------------------------------------------ Constants
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  /// @dev 0.5% by default
  uint internal constant DEFAULT_FUSE_THRESHOLD = 5e15;
  IBasePositionManager internal constant KYBER_NFT = IBasePositionManager(0xe222fBE074A436145b255442D919E4E3A6c6a480);
  IKyberSwapElasticLM internal constant FARMING_CENTER = IKyberSwapElasticLM(0x7D5ba536ab244aAA1EA42aB88428847F25E3E676);
  ITicksFeesReader internal constant TICKS_FEES_READER = ITicksFeesReader(0x8Fd8Cb948965d9305999D767A02bf79833EADbB3);
  address public constant KNC = 0x1C954E8fe737F99f68Fa1CCda3e51ebDB291948C;
  //endregion ------------------------------------------------ Constants

  //region ------------------------------------------------ Events
  event Rebalanced(uint loss, uint coveredByRewards);
  event KyberFeesClaimed(uint fee0, uint fee1);
  event KyberRewardsClaimed(uint reward);
  //endregion ------------------------------------------------ Events

  //region ------------------------------------------------ Data types
  struct State {
    IPool pool;

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
    uint pId;
    bool staked;
  }

  struct RebalanceLocal {
    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams[2] fuseAB;
    ITetuConverter converter;
    IPool pool;
    address tokenA;
    address tokenB;
    bool isStablePool;

    bool[2] fuseStatusChangedAB;
    PairBasedStrategyLib.FuseStatus[2] fuseStatusAB;
  }

  struct EnterLocalVariables {
    IPool pool;
    int24 upperTick;
    int24 lowerTick;
    uint tokenId;
    uint pId;
  }

  struct ExitLocalVariables {
    address strategyProfitHolder;
    uint pId;
    address tokenA;
    address tokenB;
  }
  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Helpers

  /// @param controllerPool [controller, pool]
  /// @param fuseThresholdsA Fuse thresholds for token A (stable pool only)
  /// @param fuseThresholdsB Fuse thresholds for token B (stable pool only)
  function initStrategyState(
    State storage state,
    address[2] memory controllerPool,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    bool isStablePool,
    uint[4] calldata fuseThresholdsA,
    uint[4] calldata fuseThresholdsB
  ) external {
    require(controllerPool[1] != address(0), AppErrors.ZERO_ADDRESS);
    state.pool = IPool(controllerPool[1]);

    state.isStablePool = isStablePool;

    state.rebalanceTickRange = rebalanceTickRange;

    _setInitialDepositorValues(
      state,
      IPool(controllerPool[1]),
      tickRange,
      rebalanceTickRange,
      asset_
    );

    address liquidator = IController(controllerPool[0]).liquidator();
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    IERC20(tokenA).approve(liquidator, type(uint).max);
    IERC20(tokenB).approve(liquidator, type(uint).max);
    IERC20(tokenA).approve(address(KYBER_NFT), type(uint).max);
    IERC20(tokenB).approve(address(KYBER_NFT), type(uint).max);
    IERC721(address(KYBER_NFT)).setApprovalForAll(address(FARMING_CENTER), true);

    if (isStablePool) {
      /// for stable pools fuse can be enabled
      PairBasedStrategyLib.setFuseStatus(state.fuseAB[0], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(state.fuseAB[0], fuseThresholdsA);
      PairBasedStrategyLib.setFuseStatus(state.fuseAB[1], PairBasedStrategyLib.FuseStatus.FUSE_OFF_1);
      PairBasedStrategyLib.setFuseThresholds(state.fuseAB[1], fuseThresholdsB);
    }
  }

  function createSpecificName(State storage state) external view returns (string memory) {
    return string(abi.encodePacked("Kyber ", IERC20Metadata(state.tokenA).symbol(), "/", IERC20Metadata(state.tokenB).symbol()));
  }

  function getPoolReserves(State storage state) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , ,) = state.pool.getPoolState();

    (reserves[0], reserves[1]) = KyberLib.getAmountsForLiquidity(
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
    IPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    return KyberDebtLib.getEntryData(pool, lowerTick, upperTick, depositorSwapTokens);
  }
  //endregion ------------------------------------------------ Pool info

  //region ------------------------------------------------ Calculations

  /// @notice Calculate and set the initial values for a QuickSwap V3 pool Depositor.
  /// @param state Depositor storage state struct
  /// @param pool The QuickSwap V3 pool to get the initial values from.
  /// @param tickRange_ The tick range for the pool.
  /// @param rebalanceTickRange_ The rebalance tick range for the pool.
  /// @param asset_ Underlying asset of the depositor.
  function _setInitialDepositorValues(
    State storage state,
    IPool pool,
    int24 tickRange_,
    int24 rebalanceTickRange_,
    address asset_
  ) internal {
    int24 tickSpacing = KyberLib.getTickSpacing(pool);
    if (tickRange_ != 0) {
      require(tickRange_ == tickRange_ / tickSpacing * tickSpacing, KyberStrategyErrors.INCORRECT_TICK_RANGE);
      require(rebalanceTickRange_ == rebalanceTickRange_ / tickSpacing * tickSpacing, KyberStrategyErrors.INCORRECT_REBALANCE_TICK_RANGE);
    }
    state.tickSpacing = tickSpacing;
    (state.lowerTick, state.upperTick) = KyberDebtLib.calcTickRange(pool, tickRange_, tickSpacing);
    address token0 = address(pool.token0());
    address token1 = address(pool.token1());
    require(asset_ == token0 || asset_ == token1, KyberStrategyErrors.INCORRECT_ASSET);
    if (asset_ == token0) {
      state.tokenA = token0;
      state.tokenB = token1;
      state.depositorSwapTokens = false;
    } else {
      state.tokenA = token1;
      state.tokenB = token0;
      state.depositorSwapTokens = true;
    }
  }
  //endregion ------------------------------------------------ Calculations

  //region ------------------------------------------------ Join the pool
  function enter(
    State storage state,
    uint[] memory amountsDesired_
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    EnterLocalVariables memory vars = EnterLocalVariables({
      pool: state.pool,
      lowerTick : state.lowerTick,
      upperTick : state.upperTick,
      tokenId : state.tokenId,
      pId : state.pId
    });
    bool depositorSwapTokens = state.depositorSwapTokens;
    (address token0, address token1) = depositorSwapTokens ? (state.tokenB, state.tokenA) : (state.tokenA, state.tokenB);
    if (depositorSwapTokens) {
      (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
    }
    amountsConsumed = new uint[](2);
    uint128 liquidity;

    if (vars.tokenId > 0) {
      (IBasePositionManager.Position memory pos,) = KYBER_NFT.positions(vars.tokenId);
      if (pos.tickLower != vars.lowerTick || pos.tickUpper != vars.upperTick) {
        KYBER_NFT.burn(vars.tokenId);
        vars.tokenId = 0;
      }
    }

    if (vars.tokenId == 0) {
      (vars.tokenId, liquidity, amountsConsumed[0], amountsConsumed[1]) = KYBER_NFT.mint(IBasePositionManager.MintParams(
        token0,
        token1,
        state.pool.swapFeeUnits(),
        vars.lowerTick,
        vars.upperTick,
        KyberLib.getPreviousTicks(vars.pool, vars.lowerTick, vars.upperTick),
        amountsDesired_[0],
        amountsDesired_[1],
        0,
        0,
        address(this),
        block.timestamp
      ));

      state.tokenId = vars.tokenId;

      {
        if (!isFarmEnded(vars.pId)) {
          uint[] memory nftIds = new uint[](1);
          nftIds[0] = vars.tokenId;
          uint[] memory liqs = new uint[](1);
          liqs[0] = uint(liquidity);
          FARMING_CENTER.deposit(nftIds);
          state.staked = true;
          FARMING_CENTER.join(vars.pId, nftIds, liqs);
        }
      }
    } else {
      (liquidity, amountsConsumed[0], amountsConsumed[1],) = KYBER_NFT.addLiquidity(IBasePositionManager.IncreaseLiquidityParams(
        vars.tokenId,
        KyberLib.getPreviousTicks(vars.pool, vars.lowerTick, vars.upperTick),
        amountsDesired_[0],
        amountsDesired_[1],
        0,
        0,
        block.timestamp
      ));

      if (!isFarmEnded(vars.pId)) {
        uint[] memory nftIds = new uint[](1);
        nftIds[0] = vars.tokenId;
        if (state.totalLiquidity == 0) {
          FARMING_CENTER.deposit(nftIds);
          state.staked = true;
        }

        uint[] memory liqs = new uint[](1);
        liqs[0] = uint(liquidity);
        FARMING_CENTER.join(vars.pId, nftIds, liqs);
      }
    }

    state.totalLiquidity += liquidity;
    liquidityOut = uint(liquidity);
  }
  //endregion ------------------------------------------------ Join the pool

  //region ------------------------------------------------ Exit from the pool

  function exit(
    State storage state,
    uint128 liquidityAmountToExit
  ) external returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);

    ExitLocalVariables memory vars = ExitLocalVariables({
      strategyProfitHolder : state.strategyProfitHolder,
      pId : state.pId,
      tokenA : state.tokenA,
      tokenB : state.tokenB
    });

    uint128 liquidity = state.totalLiquidity;

    require(liquidity >= liquidityAmountToExit, KyberStrategyErrors.WRONG_LIQUIDITY);

    bool staked = state.staked;

    uint[] memory nftIds = new uint[](1);
    nftIds[0] = state.tokenId;
    uint[] memory liqs = new uint[](1);
    uint feeA;
    uint feeB;

    // get rewards
    if (staked) {
      uint reward = _harvest(nftIds[0], vars.pId);
      // send to profit holder
      if (reward > 0) {
        IERC20(KNC).safeTransfer(vars.strategyProfitHolder, reward);
      }

      // get fees
      // when exiting, fees are collected twice so as not to lose anything when rebalancing (the position goes out of range)
      (feeA, feeB) = _claimFees(state);

      liqs[0] = uint(liquidity);

      FARMING_CENTER.exit(vars.pId, nftIds, liqs);

      // withdraw
      FARMING_CENTER.withdraw(nftIds);
      state.staked = false;
    }

    // burn liquidity
    uint rTokensOwed;
    (amountsOut[0], amountsOut[1], rTokensOwed) = KYBER_NFT.removeLiquidity(IBasePositionManager.RemoveLiquidityParams(nftIds[0], liquidityAmountToExit, 0, 0, block.timestamp));

    if (rTokensOwed > 0) {
//      KYBER_NFT.syncFeeGrowth(nftIds[0]);
      (,uint amount0, uint amount1) = KYBER_NFT.burnRTokens(IBasePositionManager.BurnRTokenParams(nftIds[0], 0, 0, block.timestamp));
      if (state.depositorSwapTokens) {
        feeA += amount1;
        feeB += amount0;
        emit KyberFeesClaimed(amount1, amount0);
      } else {
        feeA += amount0;
        feeB += amount1;
        emit KyberFeesClaimed(amount0, amount1);
      }
    }

    // transfer tokens
    KYBER_NFT.transferAllTokens(vars.tokenA, 0, address(this));
    KYBER_NFT.transferAllTokens(vars.tokenB, 0, address(this));

    // send fees to profit holder
    if (feeA > 0) {
      IERC20(vars.tokenA).safeTransfer(vars.strategyProfitHolder, feeA);
    }
    if (feeB > 0) {
      IERC20(vars.tokenB).safeTransfer(vars.strategyProfitHolder, feeB);
    }

    liquidity -= liquidityAmountToExit;
    state.totalLiquidity = liquidity;

    if (liquidity > 0 && !isFarmEnded(vars.pId)) {
      liqs[0] = uint(liquidity);
      FARMING_CENTER.deposit(nftIds);
      state.staked = true;
      FARMING_CENTER.join(vars.pId, nftIds, liqs);
    }
  }

  function quoteExit(
    State storage state,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    (uint160 sqrtRatioX96, , ,) = state.pool.getPoolState();
    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = KyberLib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTick,
      state.upperTick,
      liquidityAmountToExit
    );
    if (state.depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }
  //endregion ------------------------------------------------ Exit from the pool

  //region ------------------------------------------------ Rewards

  function claimRewardsBeforeExitIfRequired(State storage state) external {
    (,bool needUnstake) = needRebalanceStaking(state);
    if (needUnstake) {
      claimRewards(state);
    }
  }

  function claimRewards(State storage state) public returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    address strategyProfitHolder = state.strategyProfitHolder;
    uint tokenId = state.tokenId;
    tokensOut = new address[](3);
    tokensOut[0] = state.tokenA;
    tokensOut[1] = state.tokenB;
    tokensOut[2] = KNC;

    balancesBefore = new uint[](3);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = AppLib.balance(tokensOut[i]);
    }

    amountsOut = new uint[](3);
    if (tokenId > 0 && state.totalLiquidity > 0) {
      (amountsOut[0], amountsOut[1]) = _claimFees(state);
      amountsOut[2] = _harvest(tokenId, state.pId);
    }

    for (uint i; i < tokensOut.length; ++i) {
      uint b = IERC20(tokensOut[i]).balanceOf(strategyProfitHolder);
      if (b > 0) {
        IERC20(tokensOut[i]).transferFrom(strategyProfitHolder, address(this), b);
        amountsOut[i] += b;
      }
    }
  }

  function _claimFees(State storage state) internal returns (uint amountA, uint amountB) {
    uint[] memory nftIds = new uint[](1);
    nftIds[0] = state.tokenId;
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    uint bABefore = AppLib.balance(tokenA);
    uint bBBefore = AppLib.balance(tokenB);

    (uint token0Owed, uint token1Owed) = TICKS_FEES_READER.getTotalFeesOwedToPosition(address(KYBER_NFT), address(state.pool), nftIds[0]);
    if (token0Owed > 0 || token1Owed > 0) {
      FARMING_CENTER.claimFee(nftIds, 0, 0, address(state.pool), false, block.timestamp);

      amountA = AppLib.balance(tokenA) - bABefore;
      amountB = AppLib.balance(tokenB) - bBBefore;
      emit KyberFeesClaimed(amountA, amountB);
    }
  }

  function _harvest(uint tokenId, uint pId) internal returns (uint amount) {
    uint[] memory nftIds = new uint[](1);
    nftIds[0] = tokenId;
    uint[] memory pids = new uint[](1);
    pids[0] = pId;
    IKyberSwapElasticLM.HarvestData memory data = IKyberSwapElasticLM.HarvestData({
      pIds: pids
    });
    bytes[] memory datas = new bytes[](1);
    datas[0] = abi.encode(data);
    uint bBefore = AppLib.balance(KNC);
    FARMING_CENTER.harvestMultiplePools(nftIds, datas);
    amount = AppLib.balance(KNC) - bBefore;
    if (amount > 0) {
      emit KyberRewardsClaimed(amount);
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
  function _needPoolRebalance(IPool pool_, State storage state) internal view returns (bool) {
    (, int24 tick, ,) = pool_.getPoolState();
    return PairBasedStrategyLogicLib._needPoolRebalance(
      tick,
      state.lowerTick,
      state.upperTick,
      state.tickSpacing,
      state.rebalanceTickRange
    );
  }

  function needRebalanceStaking(State storage state) public view returns (bool needStake, bool needUnstake) {
    bool farmEnded = isFarmEnded(state.pId);
    bool haveLiquidity = state.totalLiquidity > 0;
    bool staked = state.staked;
    needStake = haveLiquidity && !farmEnded && !staked;
    needUnstake = haveLiquidity && farmEnded && staked;
  }

  function isFarmEnded(uint pId) public view returns(bool) {
    (,,uint endTime,,,,,) = FARMING_CENTER.getPoolInfo(pId);
    return endTime < block.timestamp;
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

    require(checkNeedRebalance_ || needRebalance, KyberStrategyErrors.NO_REBALANCE_NEEDED);

    // rebalancing debt, setting new tick range
    if (needRebalance) {
      KyberDebtLib.rebalanceNoSwaps(converterLiquidator, state, profitToCover, oldTotalAssets, splitter, liquidityThresholds_);

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
    IPool pool,
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
      coveredByRewards = KyberDebtLib.coverLossFromRewards(loss, profitHolder, tokenA, tokenB, pool);
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
    IPool pool = state.pool;
    bool depositorSwapTokens = state.depositorSwapTokens;
    (int24 newLowerTick, int24 newUpperTick) = KyberDebtLib._calcNewTickRange(pool, state.lowerTick, state.upperTick, state.tickSpacing);
    (uint consumed0, uint consumed1) = KyberDebtLib.getEntryDataProportions(pool, newLowerTick, newUpperTick, depositorSwapTokens);

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
    IPool pool;
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
    v.tokenAmounts = KyberConverterStrategyLogicLib.afterWithdrawStep(
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
      (v.newLowerTick, v.newUpperTick) = KyberDebtLib._calcNewTickRange(v.pool, state.lowerTick, state.upperTick, state.tickSpacing);
      state.lowerTick = v.newLowerTick;
      state.upperTick = v.newUpperTick;
      tokenAmounts = v.tokenAmounts;
    }

    return (completed, tokenAmounts);
  }
  //endregion ------------------------------------------------ WithdrawByAgg
}