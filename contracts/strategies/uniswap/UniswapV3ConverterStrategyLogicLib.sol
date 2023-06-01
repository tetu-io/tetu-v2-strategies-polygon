// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./UniswapV3Lib.sol";
import "./UniswapV3DebtLib.sol";
import "./Uni3StrategyErrors.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";

library UniswapV3ConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //////////////////////////////////////////
  //            CONSTANTS
  //////////////////////////////////////////

  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  uint internal constant HARD_WORK_USD_FEE_THRESHOLD = 100;
  /// @dev 0.5% by default
  uint public constant DEFAULT_FUSE_THRESHOLD = 5e15;

  //////////////////////////////////////////
  //            EVENTS
  //////////////////////////////////////////

  event FuseTriggered();
  event Rebalanced(uint loss);
  event DisableFuse();
  event NewFuseThreshold(uint newFuseThreshold);
  event UniV3FeesClaimed(uint fee0, uint fee1);

  //////////////////////////////////////////
  //            STRUCTURES
  //////////////////////////////////////////

  struct State {
    address tokenA;
    address tokenB;
    IUniswapV3Pool pool;
    int24 tickSpacing;
    bool fillUp;
    bool isStablePool;
    int24 lowerTick;
    int24 upperTick;
    int24 lowerTickFillup;
    int24 upperTickFillup;
    int24 rebalanceTickRange;
    bool depositorSwapTokens;
    uint128 totalLiquidity;
    uint128 totalLiquidityFillup;
    uint deprecated0;
    uint deprecated1;
    uint deprecated2;
    bool isFuseTriggered;
    uint fuseThreshold;
    uint lastPrice;
    address strategyProfitHolder;
  }

  struct TryCoverLossParams {
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    bool depositorSwapTokens;
    uint oldInvestedAssets;
  }

  struct RebalanceLocalVariables {
    int24 upperTick;
    int24 lowerTick;
    int24 tickSpacing;
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    uint lastPrice;
    uint fuseThreshold;
    bool depositorSwapTokens;
    uint notCoveredLoss;
    int24 newLowerTick;
    int24 newUpperTick;
    bool fillUp;
    bool isStablePool;
    uint newPrice;
    uint newTotalAssets;
  }

  struct RebalanceSwapByAggParams {
    bool direction;
    uint amount;
    address agg;
    bytes swapData;
  }

  //////////////////////////////////////////
  //            HELPERS
  //////////////////////////////////////////

  function disableFuse(State storage state, ITetuConverter converter) external {
    state.isFuseTriggered = false;
    state.lastPrice = getOracleAssetsPrice(converter, state.tokenA, state.tokenB);
    emit DisableFuse();
  }

  function newFuseThreshold(State storage state, uint value) external {
    state.fuseThreshold = value;
    emit NewFuseThreshold(value);
  }

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
    amountA = AppLib.balance(state.tokenA);
    amountB = AppLib.balance(state.tokenB);
  }

  /// @notice Get the price ratio of the two given tokens from the oracle.
  /// @param converter The Tetu converter.
  /// @param tokenA The first token address.
  /// @param tokenB The second token address.
  /// @return The price ratio of the two tokens.
  function getOracleAssetsPrice(ITetuConverter converter, address tokenA, address tokenB) public view returns (uint) {
    IPriceOracle oracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);
    return priceB * 1e18 / priceA;
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
    address asset_
  ) external {
    require(pool != address(0), AppErrors.ZERO_ADDRESS);
    state.pool = IUniswapV3Pool(pool);

    state.rebalanceTickRange = rebalanceTickRange;

    _setInitialDepositorValues(
      state,
      IUniswapV3Pool(pool),
      tickRange,
      rebalanceTickRange,
      asset_
    );

    address liquidator = IController(controller_).liquidator();
    IERC20(state.tokenA).approve(liquidator, type(uint).max);
    IERC20(state.tokenB).approve(liquidator, type(uint).max);

    /// for ultra-wide ranges we use Swap rebalancing strategy and Fill-up for other
    /// upperTick always greater then lowerTick
    state.fillUp = state.upperTick - state.lowerTick >= 4 * state.tickSpacing;

    if (isStablePool(state.pool)) {
      /// for stable pools fuse can be enabled
      state.isStablePool = true;
      state.fuseThreshold = DEFAULT_FUSE_THRESHOLD;
      emit NewFuseThreshold(DEFAULT_FUSE_THRESHOLD);
      state.lastPrice = getOracleAssetsPrice(ITetuConverter(converter), state.tokenA, state.tokenB);
    }
  }

  function createSpecificName(State storage state) external view returns (string memory) {
    return string(abi.encodePacked("UniV3 ", IERC20Metadata(state.tokenA).symbol(), "/", IERC20Metadata(state.tokenB).symbol(), "-", StringLib._toString(state.pool.fee())));
  }

  //////////////////////////////////////////
  //            CALCULATIONS
  //////////////////////////////////////////

  /// @notice Calculate and set the initial values for a Uniswap V3 pool Depositor.
  /// @param state Depositor storage state struct
  /// @param pool The Uniswap V3 pool to get the initial values from.
  /// @param tickRange_ The tick range for the pool.
  /// @param rebalanceTickRange_ The rebalance tick range for the pool.
  /// @param asset_ Underlying asset of the depositor.
  function _setInitialDepositorValues(
    State storage state,
    IUniswapV3Pool pool,
    int24 tickRange_,
    int24 rebalanceTickRange_,
    address asset_
  ) internal {
    int24 tickSpacing = UniswapV3Lib.getTickSpacing(pool.fee());
    if (tickRange_ != 0) {
      require(tickRange_ == tickRange_ / tickSpacing * tickSpacing, Uni3StrategyErrors.INCORRECT_TICK_RANGE);
      require(rebalanceTickRange_ == rebalanceTickRange_ / tickSpacing * tickSpacing, Uni3StrategyErrors.INCORRECT_REBALANCE_TICK_RANGE);
    }
    state.tickSpacing = tickSpacing;
    (state.lowerTick, state.upperTick) = UniswapV3DebtLib.calcTickRange(pool, tickRange_, tickSpacing);
    require(asset_ == pool.token0() || asset_ == pool.token1(), Uni3StrategyErrors.INCORRECT_ASSET);
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
  //            Pool info
  //////////////////////////////////////////

  /// @notice Retrieve the reserves of a Uniswap V3 pool managed by this contract.
  /// @param state The State storage containing the pool's information.
  /// @return reserves An array containing the reserve amounts of the contract owned liquidity.
  function getPoolReserves(State storage state) external view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = state.pool.slot0();

    (reserves[0], reserves[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTick,
      state.upperTick,
      state.totalLiquidity
    );

    (uint amount0CurrentFillup, uint amount1CurrentFillup) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTickFillup,
      state.upperTickFillup,
      state.totalLiquidityFillup
    );

    reserves[0] += amount0CurrentFillup;
    reserves[1] += amount1CurrentFillup;

    if (state.depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  /// @notice Retrieve the fees generated by a Uniswap V3 pool managed by this contract.
  /// @param state The State storage containing the pool's information.
  /// @return fee0 The fees generated for the first token in the pool.
  /// @return fee1 The fees generated for the second token in the pool.
  function getFees(State storage state) public view returns (uint fee0, uint fee1) {
    UniswapV3Lib.PoolPosition memory position = UniswapV3Lib.PoolPosition(address(state.pool), state.lowerTick, state.upperTick, state.totalLiquidity, address(this));
    (fee0, fee1) = UniswapV3Lib.getFees(position);
    UniswapV3Lib.PoolPosition memory positionFillup = UniswapV3Lib.PoolPosition(address(state.pool), state.lowerTickFillup, state.upperTickFillup, state.totalLiquidityFillup, address(this));
    (uint fee0Fillup, uint fee1Fillup) = UniswapV3Lib.getFees(positionFillup);
    fee0 += fee0Fillup;
    fee1 += fee1Fillup;
  }

  /// @notice Estimate the exit amounts for a given liquidity amount in a Uniswap V3 pool.
  /// @param pool The Uniswap V3 pool to quote the exit amounts for.
  /// @param lowerTick The lower tick value for the pool.
  /// @param upperTick The upper tick value for the pool.
  /// @param lowerTickFillup The lower tick value for the fillup range in the pool.
  /// @param upperTickFillup The upper tick value for the fillup range in the pool.
  /// @param liquidity The current liquidity in the pool.
  /// @param liquidityFillup The current liquidity in the fillup range.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsOut An array containing the estimated exit amounts for each token in the pool.
  function quoteExit(
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 lowerTickFillup,
    int24 upperTickFillup,
    uint128 liquidity,
    uint128 liquidityFillup,
    uint128 liquidityAmountToExit,
    bool _depositorSwapTokens
  ) public view returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();

    (amountsOut[0], amountsOut[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick,
      upperTick,
      liquidityAmountToExit
    );

    if (liquidity > 0 && liquidityFillup > 0) {
      (uint amountOut0Fillup, uint amountOut1Fillup) = UniswapV3Lib.getAmountsForLiquidity(
        sqrtRatioX96,
        lowerTickFillup,
        upperTickFillup,
        uint128(uint(liquidityFillup) * uint(liquidityAmountToExit) / uint(liquidity))
      );

      amountsOut[0] += amountOut0Fillup;
      amountsOut[1] += amountOut1Fillup;
    }

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  /// @notice Determine if the pool needs to be rebalanced.
  /// @return A boolean indicating if the pool needs to be rebalanced.
  function needRebalance(
    bool isFuseTriggered,
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 tickSpacing,
    int24 rebalanceTickRange
  ) public view returns (bool) {
    if (isFuseTriggered) {
      return false;
    }
    (, int24 tick, , , , ,) = pool.slot0();
    if (upperTick - lowerTick == tickSpacing) {
      return tick < lowerTick || tick >= upperTick;
    } else {
      int24 halfRange = (upperTick - lowerTick) / 2;
      int24 oldMedianTick = lowerTick + halfRange;
      if (tick > oldMedianTick) {
        return tick - oldMedianTick >= rebalanceTickRange;
      }
      return oldMedianTick - tick > rebalanceTickRange;
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

  function quoteRebalanceSwap(State storage state, ITetuConverter converter) external returns (bool, uint) {
    uint debtAmount = UniswapV3DebtLib.getDebtTotalDebtAmountOut(converter, state.tokenA, state.tokenB);

    if (
      state.fillUp
      || !needRebalance(state.isFuseTriggered, state.pool, state.lowerTick, state.upperTick, state.tickSpacing, state.rebalanceTickRange)
      || !UniswapV3DebtLib.needCloseDebt(debtAmount, converter, state.tokenB)
    ) {
      return (false, 0);
    }

    uint[] memory amountsOut = quoteExit(state.pool, state.lowerTick, state.upperTick, state.lowerTickFillup, state.upperTickFillup, state.totalLiquidity, state.totalLiquidityFillup, state.totalLiquidity, state.depositorSwapTokens);

    if (state.depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }

    if (amountsOut[1] < debtAmount) {
      uint tokenBprice = UniswapV3Lib.getPrice(address(state.pool), state.tokenB);
      uint needToSellTokenA = tokenBprice * (debtAmount - amountsOut[1]) / 10 ** IERC20Metadata(state.tokenB).decimals();
      // add 1% gap for price impact
      needToSellTokenA += needToSellTokenA / UniswapV3DebtLib.SELL_GAP;
      return (true, needToSellTokenA);
    } else {
      return (false, amountsOut[1] - debtAmount);
    }
  }

  //////////////////////////////////////////
  //            Joins to the pool
  //////////////////////////////////////////

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

  /// @notice Add liquidity to a Uniswap V3 pool in a specified tick range according fill up rules.
  function addFillup(State storage state) external {
    int24 lowerTickFillup;
    int24 upperTickFillup;
    uint128 liquidityOutFillup;
    IUniswapV3Pool pool = state.pool;
    int24 lowerTick = state.lowerTick;
    int24 upperTick = state.upperTick;
    int24 tickSpacing = state.tickSpacing;
    uint balance0 = AppLib.balance(pool.token0());
    uint balance1 = AppLib.balance(pool.token1());

    if (balance0 > 0 || balance1 > 0) {
      (, int24 tick, , , , ,) = pool.slot0();
      if (balance0 > balance1 * UniswapV3Lib.getPrice(address(pool), pool.token1()) / 10 ** IERC20Metadata(pool.token1()).decimals()) {
        // add token0 to half range
        lowerTickFillup = tick / tickSpacing * tickSpacing + tickSpacing;
        upperTickFillup = upperTick;
        (,, liquidityOutFillup) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTickFillup, upperTickFillup, balance0, 0);
        pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOutFillup, "");
      } else {
        lowerTickFillup = lowerTick;
        upperTickFillup = tick / tickSpacing * tickSpacing - tickSpacing;
        (,, liquidityOutFillup) = UniswapV3Lib.addLiquidityPreview(address(pool), lowerTickFillup, upperTickFillup, 0, balance1);
        pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOutFillup, "");
      }
      state.lowerTickFillup = lowerTickFillup;
      state.upperTickFillup = upperTickFillup;
      state.totalLiquidityFillup = liquidityOutFillup;
    }
  }

  //////////////////////////////////////////
  //            Exit from the pool
  //////////////////////////////////////////


  /// @notice Exit the pool and collect tokens proportional to the liquidity amount to exit.
  /// @param state The State storage object.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @return amountsOut An array containing the collected amounts for each token in the pool.
  function exit(
    State storage state,
    uint128 liquidityAmountToExit
  ) external returns (uint[] memory amountsOut) {
    uint128 totalLiquidityFillup = 0;
    IUniswapV3Pool pool = state.pool;
    int24 lowerTick = state.lowerTick;
    int24 upperTick = state.upperTick;
    int24 lowerTickFillup = state.lowerTickFillup;
    int24 upperTickFillup = state.upperTickFillup;
    uint128 liquidity = state.totalLiquidity;
    uint128 liquidityFillup = state.totalLiquidityFillup;
    bool _depositorSwapTokens = state.depositorSwapTokens;

    require(liquidity >= liquidityAmountToExit, Uni3StrategyErrors.WRONG_LIQUIDITY);

    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = pool.burn(lowerTick, upperTick, liquidityAmountToExit);
    // all fees will be collected but not returned in amountsOut
    pool.collect(
      address(this),
      lowerTick,
      upperTick,
      type(uint128).max,
      type(uint128).max
    );

    // remove proportional part of fillup liquidity
    if (liquidityFillup != 0) {
      uint128 toRemoveFillUpAmount = uint128(uint(liquidityFillup) * uint(liquidityAmountToExit) / uint(liquidity));
      (uint amountsOutFillup0, uint amountsOutFillup1) = pool.burn(lowerTickFillup, upperTickFillup, toRemoveFillUpAmount);
      pool.collect(
        address(this),
        lowerTickFillup,
        upperTickFillup,
        type(uint128).max,
        type(uint128).max
      );
      amountsOut[0] += amountsOutFillup0;
      amountsOut[1] += amountsOutFillup1;

      require(liquidityFillup >= toRemoveFillUpAmount, Uni3StrategyErrors.WRONG_FILLUP);
      totalLiquidityFillup = liquidityFillup - toRemoveFillUpAmount;
    }

    state.totalLiquidity = liquidity - liquidityAmountToExit;
    state.totalLiquidityFillup = totalLiquidityFillup;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  //////////////////////////////////////////
  //            Claim
  //////////////////////////////////////////

  /// @notice Claim rewards from the Uniswap V3 pool.
  /// @param pool The Uniswap V3 pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param lowerTickFillup The lower tick of the pool's fill-up range.
  /// @param upperTickFillup The upper tick of the pool's fill-up range.
  /// @param _depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return amountsOut An array containing the amounts of token0 and token1 claimed as rewards.
  function claimRewards(
    address strategyProfitHolder,
    IUniswapV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    int24 lowerTickFillup,
    int24 upperTickFillup,
    bool _depositorSwapTokens,
    address[] memory tokensOut,
    uint128 liquidity,
    uint128 liquidityFillup
  ) external returns (uint[] memory amountsOut, uint[] memory balancesBefore) {

    balancesBefore = new uint[](2);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = IERC20(tokensOut[i]).balanceOf(address(this));
    }

    amountsOut = new uint[](2);
    if (liquidity > 0) {
      pool.burn(lowerTick, upperTick, 0);
      (amountsOut[0], amountsOut[1]) = pool.collect(
        address(this),
        lowerTick,
        upperTick,
        type(uint128).max,
        type(uint128).max
      );
    }
    if (liquidityFillup > 0) {
      pool.burn(lowerTickFillup, upperTickFillup, 0);
      (uint fillup0, uint fillup1) = pool.collect(
        address(this),
        lowerTickFillup,
        upperTickFillup,
        type(uint128).max,
        type(uint128).max
      );
      amountsOut[0] += fillup0;
      amountsOut[1] += fillup1;
    }

    emit UniV3FeesClaimed(amountsOut[0], amountsOut[1]);

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }

    for (uint i; i < tokensOut.length; i++) {
      uint b = IERC20(tokensOut[i]).balanceOf(strategyProfitHolder);
      if (b > 0) {
        IERC20(tokensOut[i]).transferFrom(strategyProfitHolder, address(this), b);
        amountsOut[i] += b;
      }
    }
  }

  function isReadyToHardWork(State storage state, ITetuConverter converter) external view returns (bool isReady) {
    // check claimable amounts and compare with thresholds
    (uint fee0, uint fee1) = getFees(state);

    if (state.depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    address h = state.strategyProfitHolder;

    fee0 += IERC20(tokenA).balanceOf(h);
    fee1 += IERC20(tokenB).balanceOf(h);

    IPriceOracle oracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
    uint priceA = oracle.getAssetPrice(tokenA);
    uint priceB = oracle.getAssetPrice(tokenB);

    uint fee0USD = fee0 * priceA / 1e18;
    uint fee1USD = fee1 * priceB / 1e18;

    return fee0USD > HARD_WORK_USD_FEE_THRESHOLD || fee1USD > HARD_WORK_USD_FEE_THRESHOLD;
  }

  function sendFeeToProfitHolder(State storage state, uint fee0, uint fee1) external {
    address strategyProfitHolder = state.strategyProfitHolder;
    require(strategyProfitHolder != address (0), Uni3StrategyErrors.ZERO_PROFIT_HOLDER);
    if (state.depositorSwapTokens) {
      IERC20(state.tokenA).safeTransfer(strategyProfitHolder, fee1);
      IERC20(state.tokenB).safeTransfer(strategyProfitHolder, fee0);
    } else {
      IERC20(state.tokenA).safeTransfer(strategyProfitHolder, fee0);
      IERC20(state.tokenB).safeTransfer(strategyProfitHolder, fee1);
    }
  }

  //////////////////////////////////////////
  //            Rebalance
  //////////////////////////////////////////

  /// @dev Rebalances the current position, adjusts the tick range, and attempts to cover loss with pool rewards.
  /// @param state The State storage object.
  /// @param converter The TetuConverter contract.
  /// @param controller The Tetu controller address.
  /// @param oldTotalAssets The amount of total assets before rebalancing.
  /// @return tokenAmounts The token amounts for deposit (if length != 2 then do nothing).
  /// @return isNeedFillup Indicates if fill-up is required after rebalancing.
  /// @return loss Rebalance loss
  function rebalance(
    State storage state,
    ITetuConverter converter,
    address controller,
    uint oldTotalAssets,
    uint profitToCover
  ) external returns (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    bool isNeedFillup,
    uint loss
  ) {
    tokenAmounts = new uint[](0);
    isNeedFillup = false;

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
      fillUp: state.fillUp,
      isStablePool: state.isStablePool,
      newPrice: 0,
      newTotalAssets: 0
    });

    require(needRebalance(
      state.isFuseTriggered,
      vars.pool,
      vars.lowerTick,
      vars.upperTick,
      vars.tickSpacing,
      state.rebalanceTickRange
    ), Uni3StrategyErrors.NO_REBALANCE_NEEDED);

    vars.newPrice = getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

    if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
      /// enabling fuse: close debt and stop providing liquidity
      state.isFuseTriggered = true;
      emit FuseTriggered();

      UniswapV3DebtLib.closeDebt(
        converter,
        controller,
        vars.pool,
        vars.tokenA,
        vars.tokenB,
        _getLiquidatorSwapSlippage(vars.pool),
        profitToCover
      );
    } else {
      /// rebalancing debt
      /// setting new tick range
      UniswapV3DebtLib.rebalanceDebt(
        converter,
        controller,
        state,
        _getLiquidatorSwapSlippage(vars.pool),
        profitToCover
      );

      tokenAmounts = new uint[](2);
      tokenAmounts[0] = AppLib.balance(vars.tokenA);
      tokenAmounts[1] = AppLib.balance(vars.tokenB);

      if (vars.fillUp) {
        isNeedFillup = true;
      }

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

    emit Rebalanced(loss);
  }

  function rebalanceSwapByAgg(
    State storage state,
    ITetuConverter converter,
    uint oldTotalAssets,
    RebalanceSwapByAggParams memory aggParams,
    uint profitToCover
  ) external returns (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    uint loss
  ) {
    tokenAmounts = new uint[](0);

    if (state.fillUp) {
      revert('Only for swap strategy.');
    }

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
      fillUp: state.fillUp,
      isStablePool: state.isStablePool,
      newPrice: 0,
      newTotalAssets: 0
    });

    require(needRebalance(
      state.isFuseTriggered,
      vars.pool,
      vars.lowerTick,
      vars.upperTick,
      vars.tickSpacing,
      state.rebalanceTickRange
    ), Uni3StrategyErrors.NO_REBALANCE_NEEDED);

    vars.newPrice = getOracleAssetsPrice(converter, vars.tokenA, vars.tokenB);

    if (vars.isStablePool && isEnableFuse(vars.lastPrice, vars.newPrice, vars.fuseThreshold)) {
      /// enabling fuse: close debt and stop providing liquidity
      state.isFuseTriggered = true;
      emit FuseTriggered();

      UniswapV3DebtLib.closeDebtByAgg(
        converter,
        vars.tokenA,
        vars.tokenB,
        _getLiquidatorSwapSlippage(vars.pool),
        aggParams,
        profitToCover
      );
    } else {
      /// rebalancing debt
      /// setting new tick range
      UniswapV3DebtLib.rebalanceDebtSwapByAgg(
        converter,
        state,
        _getLiquidatorSwapSlippage(vars.pool),
        aggParams,
        profitToCover
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

    emit Rebalanced(loss);
  }

  function calcEarned(State storage state) external view returns (uint) {
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    address h = state.strategyProfitHolder;

    (uint fee0, uint fee1) = getFees(state);

    if (state.depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

    fee0 += IERC20(tokenA).balanceOf(h);
    fee1 += IERC20(tokenB).balanceOf(h);

    uint feeBinTermOfA = UniswapV3Lib.getPrice(address(state.pool), tokenB) * fee1 / 10 ** IERC20Metadata(tokenB).decimals();

    return fee0 + feeBinTermOfA;
  }
}
