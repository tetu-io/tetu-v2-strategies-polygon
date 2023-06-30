// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./KyberLib.sol";
import "./KyberDebtLib.sol";
import "./KyberStrategyErrors.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";

library KyberConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  /// @dev 0.5% by default
  uint internal constant DEFAULT_FUSE_THRESHOLD = 5e15;
  IBasePositionManager internal constant KYBER_NFT = IBasePositionManager(0xe222fBE074A436145b255442D919E4E3A6c6a480);
  IKyberSwapElasticLM internal constant FARMING_CENTER = IKyberSwapElasticLM(0x7D5ba536ab244aAA1EA42aB88428847F25E3E676);
  ITicksFeesReader internal constant TICKS_FEES_READER = ITicksFeesReader(0x8Fd8Cb948965d9305999D767A02bf79833EADbB3);
  address public constant KNC = 0x1C954E8fe737F99f68Fa1CCda3e51ebDB291948C;

  //////////////////////////////////////////
  //            EVENTS
  //////////////////////////////////////////

  event FuseTriggered();
  event Rebalanced(uint loss, uint coveredByRewards);
  event DisableFuse();
  event NewFuseThreshold(uint newFuseThreshold);
  event KyberFeesClaimed(uint fee0, uint fee1);
  event KyberRewardsClaimed(uint reward);

  //////////////////////////////////////////
  //            STRUCTURES
  //////////////////////////////////////////

  struct State {
    address strategyProfitHolder;
    address tokenA;
    address tokenB;
    IPool pool;
    int24 tickSpacing;
    bool isStablePool;
    int24 lowerTick;
    int24 upperTick;
    int24 rebalanceTickRange;
    bool depositorSwapTokens;
    uint128 totalLiquidity;
    bool isFuseTriggered;
    uint fuseThreshold;
    uint lastPrice;
    uint tokenId;
    // farming
    uint pId;
    bool staked;
  }

  struct RebalanceSwapByAggParams {
    bool direction;
    uint amount;
    address agg;
    bytes swapData;
  }

  struct RebalanceLocalVariables {
    int24 upperTick;
    int24 lowerTick;
    int24 tickSpacing;
    IPool pool;
    address tokenA;
    address tokenB;
    uint lastPrice;
    uint fuseThreshold;
    bool depositorSwapTokens;
    uint notCoveredLoss;
    int24 newLowerTick;
    int24 newUpperTick;
    bool isStablePool;
    uint newPrice;
    uint newTotalAssets;
    bool needRebalance;
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

  //////////////////////////////////////////
  //            HELPERS
  //////////////////////////////////////////

  function emitDisableFuse() external {
    emit DisableFuse();
  }

  function emitNewFuseThreshold(uint value) external {
    emit NewFuseThreshold(value);
  }

  /// @notice Check if the fuse is enabled based on the price difference and fuse threshold.
  /// @param oldPrice The old price.
  /// @param newPrice The new price.
  /// @param fuseThreshold The fuse threshold.
  /// @return A boolean indicating if the fuse is enabled.
  function isEnableFuse(uint oldPrice, uint newPrice, uint fuseThreshold) internal pure returns (bool) {
    return oldPrice > newPrice ? (oldPrice - newPrice) > fuseThreshold : (newPrice - oldPrice) > fuseThreshold;
  }

  function initStrategyState(
    State storage state,
    address controller_,
    address converter,
    address pool,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    bool isStablePool
  ) external {
    require(pool != address(0), AppErrors.ZERO_ADDRESS);
    state.pool = IPool(pool);

    state.isStablePool = isStablePool;

    state.rebalanceTickRange = rebalanceTickRange;

    _setInitialDepositorValues(
      state,
      IPool(pool),
      tickRange,
      rebalanceTickRange,
      asset_
    );

    address liquidator = IController(controller_).liquidator();
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    IERC20(tokenA).approve(liquidator, type(uint).max);
    IERC20(tokenB).approve(liquidator, type(uint).max);
    IERC20(tokenA).approve(address(KYBER_NFT), type(uint).max);
    IERC20(tokenB).approve(address(KYBER_NFT), type(uint).max);
    IERC721(address(KYBER_NFT)).setApprovalForAll(address(FARMING_CENTER), true);

    if (isStablePool) {
      /// for stable pools fuse can be enabled
      state.fuseThreshold = DEFAULT_FUSE_THRESHOLD;
      emit NewFuseThreshold(DEFAULT_FUSE_THRESHOLD);
      state.lastPrice = ConverterStrategyBaseLib.getOracleAssetsPrice(ITetuConverter(converter), tokenA, tokenB);
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

  //////////////////////////////////////////
  //            Pool info
  //////////////////////////////////////////

  function getEntryData(
    IPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    return KyberDebtLib.getEntryData(pool, lowerTick, upperTick, depositorSwapTokens);
  }

  //////////////////////////////////////////
  //            CALCULATIONS
  //////////////////////////////////////////

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

  //////////////////////////////////////////
  //            Joins to the pool
  //////////////////////////////////////////

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

  //////////////////////////////////////////
  //            Exit from the pool
  //////////////////////////////////////////

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
      KYBER_NFT.syncFeeGrowth(nftIds[0]);
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

  //////////////////////////////////////////
  //            Rewards
  //////////////////////////////////////////

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

  //////////////////////////////////////////
  //            Rebalance
  //////////////////////////////////////////

  function needRebalance(State storage state) public view returns (bool) {
    if (state.isFuseTriggered) {
      return false;
    }

    (, int24 tick, ,) = state.pool.getPoolState();
    int24 upperTick = state.upperTick;
    int24 lowerTick = state.lowerTick;
    if (upperTick - lowerTick == state.tickSpacing) {
      return tick < lowerTick || tick >= upperTick;
    } else {
      int24 halfRange = (upperTick - lowerTick) / 2;
      int24 oldMedianTick = lowerTick + halfRange;
      if (tick > oldMedianTick) {
        return tick - oldMedianTick >= state.rebalanceTickRange;
      }
      return oldMedianTick - tick > state.rebalanceTickRange;
    }
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

  function quoteRebalanceSwap(State storage state, ITetuConverter converter) external returns (bool, uint) {
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    uint debtAmount = KyberDebtLib.getDebtTotalDebtAmountOut(converter, tokenA, tokenB);

    if (
      !needRebalance(state)
      || !KyberDebtLib.needCloseDebt(debtAmount, converter, tokenB)
    ) {
      return (false, 0);
    }

    uint[] memory amountsOut = quoteExit(state, state.totalLiquidity);
    amountsOut[0] += AppLib.balance(tokenA);
    amountsOut[1] += AppLib.balance(tokenB);

    if (amountsOut[1] < debtAmount) {
      uint tokenBprice = KyberLib.getPrice(address(state.pool), tokenB);
      uint needToSellTokenA = tokenBprice * (debtAmount - amountsOut[1]) / 10 ** IERC20Metadata(tokenB).decimals();
      // add 1% gap for price impact
      needToSellTokenA += needToSellTokenA / KyberDebtLib.SELL_GAP;
      if (amountsOut[0] > 0) {
        needToSellTokenA = Math.min(needToSellTokenA, amountsOut[0] - 1);
      } else {
        needToSellTokenA = 0;
      }
      return (true, needToSellTokenA);
    } else {
      return (false, amountsOut[1] - debtAmount);
    }
  }

  function rebalance(
    State storage state,
    ITetuConverter converter,
    address controller,
    uint oldTotalAssets,
    uint profitToCover,
    address splitter
  ) external returns (
    uint[] memory tokenAmounts // _depositorEnter(tokenAmounts) if length == 2
  ) {
    uint loss;
    tokenAmounts = new uint[](0);

    RebalanceLocalVariables memory vars = RebalanceLocalVariables({
      upperTick: state.upperTick,
      lowerTick: state.lowerTick,
      tickSpacing: state.tickSpacing,
      pool: state.pool,
      tokenA: state.tokenA,
      tokenB: state.tokenB,
      lastPrice: state.lastPrice,
      fuseThreshold: state.fuseThreshold,
      depositorSwapTokens: state.depositorSwapTokens,
    // setup initial values
      notCoveredLoss: 0,
      newLowerTick: 0,
      newUpperTick: 0,
      isStablePool: state.isStablePool,
      newPrice: 0,
      newTotalAssets: 0,
      needRebalance : needRebalance(state)
    });

    if (vars.needRebalance) {
      vars.newPrice = ConverterStrategyBaseLib.getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

      if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
        /// enabling fuse: close debt and stop providing liquidity
        state.isFuseTriggered = true;
        emit FuseTriggered();

        KyberDebtLib.closeDebt(
          converter,
          controller,
          vars.pool,
          vars.tokenA,
          vars.tokenB,
          _getLiquidatorSwapSlippage(vars.isStablePool),
          profitToCover,
          oldTotalAssets,
          splitter
        );
      } else {
        /// rebalancing debt
        /// setting new tick range
        KyberDebtLib.rebalanceDebt(
          converter,
          controller,
          state,
          _getLiquidatorSwapSlippage(vars.isStablePool),
          profitToCover,
          oldTotalAssets,
          splitter
        );

        tokenAmounts = new uint[](2);
        tokenAmounts[0] = AppLib.balance(vars.tokenA);
        tokenAmounts[1] = AppLib.balance(vars.tokenB);

        address[] memory tokens = new address[](2);
        tokens[0] = vars.tokenA;
        tokens[1] = vars.tokenB;
        uint[] memory amounts = new uint[](2);
        amounts[0] = tokenAmounts[0];
        vars.newTotalAssets = ConverterStrategyBaseLib.calcInvestedAssets(tokens, amounts, 0, converter);
        if (vars.newTotalAssets < oldTotalAssets) {
          loss = oldTotalAssets - vars.newTotalAssets;
        }
      }

      // need to update last price only for stables coz only stables have fuse mechanic
      if (vars.isStablePool) {
        state.lastPrice = vars.newPrice;
      }

      uint covered;
      if (loss > 0) {
        covered = KyberDebtLib.coverLossFromRewards(loss, state.strategyProfitHolder, vars.tokenA, vars.tokenB, address(vars.pool));
        uint notCovered = loss - covered;
        if (notCovered > 0) {
          ISplitter(splitter).coverPossibleStrategyLoss(0, notCovered);
        }
      }

      emit Rebalanced(loss, covered);
    } else {
      tokenAmounts = new uint[](2);
      tokenAmounts[0] = AppLib.balance(vars.tokenA);
      tokenAmounts[1] = AppLib.balance(vars.tokenB);
    }
  }

  function rebalanceSwapByAgg(
    State storage state,
    ITetuConverter converter,
    uint oldTotalAssets,
    RebalanceSwapByAggParams memory aggParams,
    uint profitToCover,
    address splitter
  ) external returns (
    uint[] memory tokenAmounts // _depositorEnter(tokenAmounts) if length == 2
  ) {
    uint loss;
    tokenAmounts = new uint[](0);

    RebalanceLocalVariables memory vars = RebalanceLocalVariables({
      upperTick: state.upperTick,
      lowerTick: state.lowerTick,
      tickSpacing: state.tickSpacing,
      pool: state.pool,
      tokenA: state.tokenA,
      tokenB: state.tokenB,
      lastPrice: state.lastPrice,
      fuseThreshold: state.fuseThreshold,
      depositorSwapTokens: state.depositorSwapTokens,
    // setup initial values
      notCoveredLoss: 0,
      newLowerTick: 0,
      newUpperTick: 0,
      isStablePool: state.isStablePool,
      newPrice: 0,
      newTotalAssets: 0,
      needRebalance : needRebalance(state)
    });

    if (vars.needRebalance) {
      vars.newPrice = ConverterStrategyBaseLib.getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

      if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
        /// enabling fuse: close debt and stop providing liquidity
        state.isFuseTriggered = true;
        emit FuseTriggered();

        KyberDebtLib.closeDebtByAgg(
          converter,
          vars.tokenA,
          vars.tokenB,
          _getLiquidatorSwapSlippage(vars.isStablePool),
          aggParams,
          profitToCover,
          oldTotalAssets,
          splitter
        );
      } else {
        /// rebalancing debt
        /// setting new tick range
        KyberDebtLib.rebalanceDebtSwapByAgg(
          converter,
          state,
          _getLiquidatorSwapSlippage(vars.isStablePool),
          aggParams,
          profitToCover,
          oldTotalAssets,
          splitter
        );

        if (oldTotalAssets > 0) {
          tokenAmounts = new uint[](2);
          tokenAmounts[0] = AppLib.balance(vars.tokenA);
          tokenAmounts[1] = AppLib.balance(vars.tokenB);

          address[] memory tokens = new address[](2);
          tokens[0] = vars.tokenA;
          tokens[1] = vars.tokenB;
          uint[] memory amounts = new uint[](2);
          amounts[0] = tokenAmounts[0];
          vars.newTotalAssets = ConverterStrategyBaseLib.calcInvestedAssets(tokens, amounts, 0, converter);
          if (vars.newTotalAssets < oldTotalAssets) {
            loss = oldTotalAssets - vars.newTotalAssets;
          }
        }
      }

      // need to update last price only for stables coz only stables have fuse mechanic
      if (vars.isStablePool) {
        state.lastPrice = vars.newPrice;
      }

      uint covered;
      if (loss > 0) {
        covered = KyberDebtLib.coverLossFromRewards(loss, state.strategyProfitHolder, vars.tokenA, vars.tokenB, address(vars.pool));
        uint notCovered = loss - covered;
        if (notCovered > 0) {
          ISplitter(splitter).coverPossibleStrategyLoss(0, notCovered);
        }
      }

      emit Rebalanced(loss, covered);
    } else {
      tokenAmounts = new uint[](2);
      tokenAmounts[0] = AppLib.balance(vars.tokenA);
      tokenAmounts[1] = AppLib.balance(vars.tokenB);
    }
  }
}