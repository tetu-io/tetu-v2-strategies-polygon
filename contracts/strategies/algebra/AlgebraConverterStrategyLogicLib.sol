// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./AlgebraLib.sol";
import "./AlgebraDebtLib.sol";
import "./AlgebraStrategyErrors.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";

library AlgebraConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  uint internal constant HARD_WORK_USD_FEE_THRESHOLD = 100;
  /// @dev 0.5% by default
  uint internal constant DEFAULT_FUSE_THRESHOLD = 5e15;
  INonfungiblePositionManager internal constant ALGEBRA_NFT = INonfungiblePositionManager(0x8eF88E4c7CfbbaC1C163f7eddd4B578792201de6);
  IFarmingCenter internal constant FARMING_CENTER = IFarmingCenter(0x7F281A8cdF66eF5e9db8434Ec6D97acc1bc01E78);

  //////////////////////////////////////////
  //            EVENTS
  //////////////////////////////////////////

  event FuseTriggered();
  event Rebalanced(uint loss, uint coveredByRewards);
  event DisableFuse();
  event NewFuseThreshold(uint newFuseThreshold);
  event AlgebraFeesClaimed(uint fee0, uint fee1);
  event AlgebraRewardsClaimed(uint reward, uint bonusReward);

  //////////////////////////////////////////
  //            STRUCTURES
  //////////////////////////////////////////

  struct State {
    address strategyProfitHolder;
    address tokenA;
    address tokenB;
    IAlgebraPool pool;
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
    address rewardToken;
    address bonusRewardToken;
    uint256 startTime;
    uint256 endTime;
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
    IAlgebraPool pool;
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
    state.pool = IAlgebraPool(pool);

    state.isStablePool = isStablePool;

    state.rebalanceTickRange = rebalanceTickRange;

    _setInitialDepositorValues(
      state,
      IAlgebraPool(pool),
      tickRange,
      rebalanceTickRange,
      asset_
    );

    address liquidator = IController(controller_).liquidator();
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    IERC20(tokenA).approve(liquidator, type(uint).max);
    IERC20(tokenB).approve(liquidator, type(uint).max);
    IERC20(tokenA).approve(address(ALGEBRA_NFT), type(uint).max);
    IERC20(tokenB).approve(address(ALGEBRA_NFT), type(uint).max);

    if (isStablePool) {
      /// for stable pools fuse can be enabled
      state.fuseThreshold = DEFAULT_FUSE_THRESHOLD;
      emit NewFuseThreshold(DEFAULT_FUSE_THRESHOLD);
      state.lastPrice = ConverterStrategyBaseLib.getOracleAssetsPrice(ITetuConverter(converter), tokenA, tokenB);
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

  //////////////////////////////////////////
  //            Pool info
  //////////////////////////////////////////

  function getEntryData(
    IAlgebraPool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) public view returns (bytes memory entryData) {
    return AlgebraDebtLib.getEntryData(pool, lowerTick, upperTick, depositorSwapTokens);
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

  //////////////////////////////////////////
  //            Joins to the pool
  //////////////////////////////////////////

  function enter(
    State storage state,
    uint[] memory amountsDesired_
  ) external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    bool depositorSwapTokens = state.depositorSwapTokens;
    (address token0, address token1) = depositorSwapTokens ? (state.tokenB, state.tokenA) : (state.tokenA, state.tokenB);
    if (depositorSwapTokens) {
      (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
    }
    amountsConsumed = new uint[](2);
    uint128 liquidity;
    uint tokenId = state.tokenId;
    int24 lowerTick = state.lowerTick;
    int24 upperTick = state.upperTick;

    if (tokenId > 0) {
      (,,,,int24 nftLowerTick, int24 nftUpperTick,,,,,) = ALGEBRA_NFT.positions(tokenId);
      if (nftLowerTick != lowerTick || nftUpperTick != upperTick) {
        ALGEBRA_NFT.burn(tokenId);
        tokenId = 0;
      }
    }

    if (tokenId == 0) {
      (tokenId, liquidity, amountsConsumed[0], amountsConsumed[1]) = ALGEBRA_NFT.mint(INonfungiblePositionManager.MintParams(
        token0,
        token1,
        lowerTick,
        upperTick,
        amountsDesired_[0],
        amountsDesired_[1],
        0,
        0,
        address(this),
        block.timestamp
      ));

      state.tokenId = tokenId;

      ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), tokenId);
      FARMING_CENTER.enterFarming(IncentiveKey(state.rewardToken, state.bonusRewardToken, address(state.pool), state.startTime, state.endTime), tokenId, 0, false);
    } else {
      (liquidity, amountsConsumed[0], amountsConsumed[1]) = ALGEBRA_NFT.increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams(
        tokenId,
        amountsDesired_[0],
        amountsDesired_[1],
        0,
        0,
        block.timestamp
      ));

      if (state.totalLiquidity == 0) {
        ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), tokenId);
        FARMING_CENTER.enterFarming(IncentiveKey(state.rewardToken, state.bonusRewardToken, address(state.pool), state.startTime, state.endTime), tokenId, 0, false);
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
        FARMING_CENTER.claimReward(token, address(this), 0, reward);
        IERC20(token).safeTransfer(strategyProfitHolder, reward);
      }
      if (bonusReward > 0) {
        address token = state.bonusRewardToken;
        FARMING_CENTER.claimReward(token, address(this), 0, bonusReward);
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

  //////////////////////////////////////////
  //            Rewards
  //////////////////////////////////////////

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

    IPriceOracle oracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
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
        FARMING_CENTER.claimReward(tokensOut[2], address(this), 0, amountsOut[2]);
      }

      if (amountsOut[3] > 0) {
        FARMING_CENTER.claimReward(tokensOut[3], address(this), 0, amountsOut[3]);
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

  //////////////////////////////////////////
  //            Rebalance
  //////////////////////////////////////////

  function needRebalance(State storage state) public view returns (bool) {
    if (state.isFuseTriggered) {
      return false;
    }

    (, int24 tick, , , , ,) = state.pool.globalState();
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

  function quoteRebalanceSwap(State storage state, ITetuConverter converter) external returns (bool, uint) {
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    uint debtAmount = AlgebraDebtLib.getDebtTotalDebtAmountOut(converter, tokenA, tokenB);

    if (
      !needRebalance(state)
      || !AlgebraDebtLib.needCloseDebt(debtAmount, converter, tokenB)
    ) {
      return (false, 0);
    }

    uint[] memory amountsOut = quoteExit(state, state.totalLiquidity);
    amountsOut[0] += AppLib.balance(tokenA);
    amountsOut[1] += AppLib.balance(tokenB);

    if (amountsOut[1] < debtAmount) {
      uint tokenBprice = AlgebraLib.getPrice(address(state.pool), tokenB);
      uint needToSellTokenA = tokenBprice * (debtAmount - amountsOut[1]) / 10 ** IERC20Metadata(tokenB).decimals();
      // add 1% gap for price impact
      needToSellTokenA += needToSellTokenA / AlgebraDebtLib.SELL_GAP;
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
      newTotalAssets: 0
    });

    require(needRebalance(state), AlgebraStrategyErrors.NO_REBALANCE_NEEDED);

    vars.newPrice = ConverterStrategyBaseLib.getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

    if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
      /// enabling fuse: close debt and stop providing liquidity
      state.isFuseTriggered = true;
      emit FuseTriggered();

      AlgebraDebtLib.closeDebt(
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
      AlgebraDebtLib.rebalanceDebt(
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
      covered = AlgebraDebtLib.coverLossFromRewards(loss, state.strategyProfitHolder, vars.tokenA, vars.tokenB, address(vars.pool));
      uint notCovered = loss - covered;
      if (notCovered > 0) {
        ISplitter(splitter).coverPossibleStrategyLoss(0, notCovered);
      }
    }

    emit Rebalanced(loss, covered);
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
      newTotalAssets: 0
    });

    require(needRebalance(state), AlgebraStrategyErrors.NO_REBALANCE_NEEDED);

    vars.newPrice = ConverterStrategyBaseLib.getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

    if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
      /// enabling fuse: close debt and stop providing liquidity
      state.isFuseTriggered = true;
      emit FuseTriggered();

      AlgebraDebtLib.closeDebtByAgg(
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
      AlgebraDebtLib.rebalanceDebtSwapByAgg(
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
      covered = AlgebraDebtLib.coverLossFromRewards(loss, state.strategyProfitHolder, vars.tokenA, vars.tokenB, address(vars.pool));
      uint notCovered = loss - covered;
      if (notCovered > 0) {
        ISplitter(splitter).coverPossibleStrategyLoss(0, notCovered);
      }
    }

    emit Rebalanced(loss, covered);
  }
}