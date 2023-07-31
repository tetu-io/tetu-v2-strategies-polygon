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
  event Rebalanced(uint loss, uint profitToCover, uint coveredByRewards);
  event KyberFeesClaimed(uint fee0, uint fee1);
  event KyberRewardsClaimed(uint reward);
  //endregion ------------------------------------------------ Events

  //region ------------------------------------------------ Data types
  struct State {
    PairBasedStrategyLogicLib.PairState pair;
    // additional (specific) state

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
    address token0 = address(IPool(controllerPool[1]).token0());
    address token1 = address(IPool(controllerPool[1]).token1());

    int24[4] memory tickData;
    {
      int24 tickSpacing = KyberLib.getTickSpacing(IPool(controllerPool[1]));
      if (tickRange != 0) {
        require(tickRange == tickRange / tickSpacing * tickSpacing, KyberStrategyErrors.INCORRECT_TICK_RANGE);
        require(rebalanceTickRange == rebalanceTickRange / tickSpacing * tickSpacing, KyberStrategyErrors.INCORRECT_REBALANCE_TICK_RANGE);
      }
      tickData[0] = tickSpacing;
      (tickData[1], tickData[2]) = KyberDebtLib.calcTickRange(IPool(controllerPool[1]), tickRange, tickSpacing);
      tickData[3] = tickRange;
    }

    PairBasedStrategyLogicLib.setInitialDepositorValues(
      state.pair,
      [controllerPool[1], asset_, token0, token1],
      tickData,
      isStablePool,
      fuseThresholdsA,
      fuseThresholdsB
    );

    address liquidator = IController(controllerPool[0]).liquidator();
    IERC20(token0).approve(liquidator, type(uint).max);
    IERC20(token1).approve(liquidator, type(uint).max);
    IERC20(token0).approve(address(KYBER_NFT), type(uint).max);
    IERC20(token1).approve(address(KYBER_NFT), type(uint).max);
    IERC721(address(KYBER_NFT)).setApprovalForAll(address(FARMING_CENTER), true);
  }

  function createSpecificName(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (string memory) {
    return string(abi.encodePacked(
      "Kyber ",
      IERC20Metadata(pairState.tokenA).symbol(),
      "/",
      IERC20Metadata(pairState.tokenB).symbol())
    );
  }

  function getPoolReserves(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , ,) = IPool(pairState.pool).getPoolState();

    (reserves[0], reserves[1]) = KyberLib.getAmountsForLiquidity(
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

  //region ------------------------------------------------ Join the pool
  function enter(
    State storage state,
    uint[] memory amountsDesired_
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    EnterLocalVariables memory vars = EnterLocalVariables({
      pool: IPool(state.pair.pool),
      lowerTick : state.pair.lowerTick,
      upperTick : state.pair.upperTick,
      tokenId : state.tokenId,
      pId : state.pId
    });
    bool depositorSwapTokens = state.pair.depositorSwapTokens;
    (address token0, address token1) = depositorSwapTokens ? (state.pair.tokenB, state.pair.tokenA) : (state.pair.tokenA, state.pair.tokenB);
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
        IPool(state.pair.pool).swapFeeUnits(),
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
        if (state.pair.totalLiquidity == 0) {
          FARMING_CENTER.deposit(nftIds);
          state.staked = true;
        }

        uint[] memory liqs = new uint[](1);
        liqs[0] = uint(liquidity);
        FARMING_CENTER.join(vars.pId, nftIds, liqs);
      }
    }

    state.pair.totalLiquidity += liquidity;
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
      strategyProfitHolder : state.pair.strategyProfitHolder,
      pId : state.pId,
      tokenA : state.pair.tokenA,
      tokenB : state.pair.tokenB
    });

    uint128 liquidity = state.pair.totalLiquidity;

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
      if (state.pair.depositorSwapTokens) {
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
    state.pair.totalLiquidity = liquidity;

    if (liquidity > 0 && !isFarmEnded(vars.pId)) {
      liqs[0] = uint(liquidity);
      FARMING_CENTER.deposit(nftIds);
      state.staked = true;
      FARMING_CENTER.join(vars.pId, nftIds, liqs);
    }
  }

  function quoteExit(
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    (uint160 sqrtRatioX96, , ,) = IPool(pairState.pool).getPoolState();
    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = KyberLib.getAmountsForLiquidity(
      sqrtRatioX96,
      pairState.lowerTick,
      pairState.upperTick,
      liquidityAmountToExit
    );
    if (pairState.depositorSwapTokens) {
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
    address strategyProfitHolder = state.pair.strategyProfitHolder;
    uint tokenId = state.tokenId;
    tokensOut = new address[](3);
    tokensOut[0] = state.pair.tokenA;
    tokensOut[1] = state.pair.tokenB;
    tokensOut[2] = KNC;

    balancesBefore = new uint[](3);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = AppLib.balance(tokensOut[i]);
    }

    amountsOut = new uint[](3);
    if (tokenId > 0 && state.pair.totalLiquidity > 0) {
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
    address tokenA = state.pair.tokenA;
    address tokenB = state.pair.tokenB;
    uint bABefore = AppLib.balance(tokenA);
    uint bBBefore = AppLib.balance(tokenB);

    (uint token0Owed, uint token1Owed) = TICKS_FEES_READER.getTotalFeesOwedToPosition(address(KYBER_NFT), state.pair.pool, nftIds[0]);
    if (token0Owed > 0 || token1Owed > 0) {
      FARMING_CENTER.claimFee(nftIds, 0, 0, state.pair.pool, false, block.timestamp);

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
  function needStrategyRebalance(PairBasedStrategyLogicLib.PairState storage pairState, ITetuConverter converter_) external view returns (
    bool needRebalance
  ) {
    (needRebalance, , ) = PairBasedStrategyLogicLib.needStrategyRebalance(
      pairState,
      converter_,
      KyberDebtLib.getCurrentTick(IPool(pairState.pool))
    );
  }

  function needRebalanceStaking(State storage state) public view returns (bool needStake, bool needUnstake) {
    bool farmEnded = isFarmEnded(state.pId);
    bool haveLiquidity = state.pair.totalLiquidity > 0;
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
  /// @param totalAssets_ Current value of totalAssets()
  /// @return tokenAmounts Token amounts for deposit. If length == 0 - rebalance wasn't made and no deposit is required.
  function rebalanceNoSwaps(
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
    _initLocalVars(v, ITetuConverter(converterLiquidator[0]), pairState);

    bool needRebalance;
    int24 tick = KyberDebtLib.getCurrentTick(IPool(pairState.pool));
    (needRebalance, v.fuseStatusChangedAB, v.fuseStatusAB) = PairBasedStrategyLogicLib.needStrategyRebalance(
      pairState,
      v.converter,
      tick
    );

    // update fuse status if necessary
    if (needRebalance) {
      // we assume here, that needRebalance is true if any fuse has changed state, see needStrategyRebalance impl
      PairBasedStrategyLogicLib.updateFuseStatus(pairState, v.fuseStatusChangedAB, v.fuseStatusAB);
    }

    require(checkNeedRebalance_ || needRebalance, KyberStrategyErrors.NO_REBALANCE_NEEDED);

    // rebalancing debt, setting new tick range
    if (needRebalance) {
      uint coveredByRewards;
      KyberDebtLib.rebalanceNoSwaps(converterLiquidator, pairState, profitToCover, totalAssets_, splitter, liquidityThresholds_, tick);

      uint loss;
      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmounts(v.converter, totalAssets_, v.tokenA, v.tokenB);
      if (loss != 0) {
        coveredByRewards = _coverLoss(splitter, loss, pairState.strategyProfitHolder, v.tokenA, v.tokenB, address(v.pool));
      }
      emit Rebalanced(loss, profitToCover, coveredByRewards);
    }

    return tokenAmounts;
  }

  /// @notice Try to cover loss from rewards then cover remain loss from insurance.
  function _coverLoss(address splitter, uint loss, address profitHolder, address tokenA, address tokenB, address pool) internal returns (
    uint coveredByRewards
  ){
    if (loss != 0) {
      coveredByRewards = KyberDebtLib.coverLossFromRewards(loss, profitHolder, tokenA, tokenB, pool);
      uint notCovered = loss - coveredByRewards;
      if (notCovered != 0) {
        ISplitter(splitter).coverPossibleStrategyLoss(0, notCovered);
      }
    }

    return coveredByRewards;
  }

  /// @notice Initialize {v} by state values
  function _initLocalVars(
    RebalanceLocal memory v,
    ITetuConverter converter_,
    PairBasedStrategyLogicLib.PairState storage pairState
  ) internal view {
    v.pool = IPool(pairState.pool);
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
    IPool pool = IPool(pairState.pool);
    bool depositorSwapTokens = pairState.depositorSwapTokens;
    (int24 newLowerTick, int24 newUpperTick) = KyberDebtLib._calcNewTickRange(pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
    (uint consumed0, uint consumed1) = KyberDebtLib.getEntryDataProportions(pool, newLowerTick, newUpperTick, depositorSwapTokens);

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
    IPool pool = IPool(pairState.pool);

    // Calculate amounts to be deposited to pool, calculate loss, fix profitToCover
    uint[] memory tokenAmounts;
    uint loss;
    (completed, tokenAmounts, loss) = PairBasedStrategyLogicLib.withdrawByAggStep(addr_, values_, swapData, planEntryData, tokens, liquidationThresholds);

    // cover loss
    if (loss != 0) {
      _coverLoss(splitter, loss, pairState.strategyProfitHolder, tokens[0], tokens[1], address(pool));
    }

    if (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED
      || (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
    ) {
      // We are going to enter to the pool: update lowerTick and upperTick, initialize tokenAmountsOut
      (pairState.lowerTick, pairState.upperTick) = KyberDebtLib._calcNewTickRange(pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
      tokenAmountsOut = tokenAmounts;
    }

    return (completed, tokenAmountsOut); // hide warning
  }
  //endregion ------------------------------------------------ WithdrawByAgg
}