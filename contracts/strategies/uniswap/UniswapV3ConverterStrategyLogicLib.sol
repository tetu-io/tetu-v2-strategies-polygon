// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./UniswapV3Lib.sol";
import "./UniswapV3DebtLib.sol";
import "./Uni3StrategyErrors.sol";
import "../../libs/AppLib.sol";
import "../../libs/AppErrors.sol";
import "../ConverterStrategyBaseLib.sol";
import "../ConverterStrategyBaseLib2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../../test/Typechain.sol";

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
  event Rebalanced(uint loss, uint coveredByRewards);
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

  struct RebalanceLocalVariables {
    IUniswapV3Pool pool;
    address tokenA;
    address tokenB;
    uint lastPrice;
    uint fuseThreshold;
    bool fillUp;
    bool isStablePool;
    uint newPrice;
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
    state.lastPrice = ConverterStrategyBaseLib2.getOracleAssetsPrice(converter, state.tokenA, state.tokenB);
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
      state.lastPrice = ConverterStrategyBaseLib2.getOracleAssetsPrice(ITetuConverter(converter), state.tokenA, state.tokenB);
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
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @return amountsOut An array containing the estimated exit amounts for each token in the pool.
  function quoteExit(
    State storage state,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    uint128 liquidity = state.totalLiquidity;
    uint128 liquidityFillup = state.totalLiquidityFillup;

    amountsOut = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = state.pool.slot0();

    (amountsOut[0], amountsOut[1]) = UniswapV3Lib.getAmountsForLiquidity(
      sqrtRatioX96,
      state.lowerTick,
      state.upperTick,
      liquidityAmountToExit
    );

    if (liquidity > 0 && liquidityFillup > 0) {
      (uint amountOut0Fillup, uint amountOut1Fillup) = UniswapV3Lib.getAmountsForLiquidity(
        sqrtRatioX96,
        state.lowerTickFillup,
        state.upperTickFillup,
        uint128(uint(liquidityFillup) * uint(liquidityAmountToExit) / uint(liquidity))
      );

      amountsOut[0] += amountOut0Fillup;
      amountsOut[1] += amountOut1Fillup;
    }

    if (state.depositorSwapTokens) {
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
    address tokenA = state.tokenA;
    address tokenB = state.tokenB;
    IUniswapV3Pool pool = state.pool;
    uint debtAmount = UniswapV3DebtLib.getDebtTotalDebtAmountOut(converter, tokenA, tokenB);

    if (
      state.fillUp
      || !needRebalance(state.isFuseTriggered, pool, state.lowerTick, state.upperTick, state.tickSpacing, state.rebalanceTickRange)
      || !UniswapV3DebtLib.needCloseDebt(debtAmount, converter, tokenB)
    ) {
      return (false, 0);
    }

    uint[] memory amountsOut = quoteExit(state, state.totalLiquidity);
    amountsOut[0] += AppLib.balance(tokenA);
    amountsOut[1] += AppLib.balance(tokenB);

    if (amountsOut[1] < debtAmount) {
      uint tokenBprice = UniswapV3Lib.getPrice(address(pool), tokenB);
      uint needToSellTokenA = tokenBprice * (debtAmount - amountsOut[1]) / 10 ** IERC20Metadata(tokenB).decimals();
      // add 1% gap for price impact
      needToSellTokenA += needToSellTokenA / UniswapV3DebtLib.SELL_GAP;
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
  /// @return tokensOut An array containing tokenA and tokenB.
  /// @return amountsOut An array containing the amounts of token0 and token1 claimed as rewards.
  function claimRewards(State storage state) external returns (address[] memory tokensOut, uint[] memory amountsOut, uint[] memory balancesBefore) {
    address strategyProfitHolder = state.strategyProfitHolder;
    IUniswapV3Pool pool = state.pool;
    int24 lowerTick = state.lowerTick;
    int24 upperTick = state.upperTick;
    int24 lowerTickFillup = state.lowerTickFillup;
    int24 upperTickFillup = state.upperTickFillup;
    tokensOut = new address[](2);
    tokensOut[0] = state.tokenA;
    tokensOut[1] = state.tokenB;

    balancesBefore = new uint[](2);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = IERC20(tokensOut[i]).balanceOf(address(this));
    }

    amountsOut = new uint[](2);
    if (state.totalLiquidity > 0) {
      pool.burn(lowerTick, upperTick, 0);
      (amountsOut[0], amountsOut[1]) = pool.collect(
        address(this),
        lowerTick,
        upperTick,
        type(uint128).max,
        type(uint128).max
      );
    }
    if (state.totalLiquidityFillup > 0) {
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

    if (state.depositorSwapTokens) {
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

    IPriceOracle oracle = AppLib._getPriceOracle(converter);
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
    emit UniV3FeesClaimed(fee0, fee1);
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
  function rebalance(
    State storage state,
    ITetuConverter converter,
    address controller,
    uint oldTotalAssets,
    uint profitToCover,
    address splitter
  ) external returns (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    bool isNeedFillup
  ) {
    uint loss;
    tokenAmounts = new uint[](0);
    isNeedFillup = false;

    RebalanceLocalVariables memory vars;
    _initLocalVars(vars, converter, state, false, true);

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
        profitToCover,
        oldTotalAssets,
        splitter
      );
    } else {
      /// rebalancing debt
      /// setting new tick range
      UniswapV3DebtLib.rebalanceDebt(
        converter,
        controller,
        state,
        _getLiquidatorSwapSlippage(vars.pool),
        profitToCover,
        oldTotalAssets,
        splitter
      );

      if (vars.fillUp) {
        isNeedFillup = true;
      }

      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmounts(converter, oldTotalAssets, vars.tokenA, vars.tokenB);
    }

    // need to update last price only for stables coz only stables have fuse mechanic
    if (vars.isStablePool) {
      state.lastPrice = vars.newPrice;
    }

    _coverLoss(splitter, loss, state.strategyProfitHolder, vars.tokenA, vars.tokenB, address(vars.pool));
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

    RebalanceLocalVariables memory vars;
    _initLocalVars(vars, converter, state, true, true);

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
        profitToCover,
        oldTotalAssets,
        splitter
      );
    } else {
      /// rebalancing debt
      /// setting new tick range
      UniswapV3DebtLib.rebalanceDebtSwapByAgg(
        converter,
        state,
        _getLiquidatorSwapSlippage(vars.pool),
        aggParams,
        profitToCover,
        oldTotalAssets,
        splitter
      );

      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmounts(converter, oldTotalAssets, vars.tokenA, vars.tokenB);
    }

    // need to update last price only for stables coz only stables have fuse mechanic
    if (vars.isStablePool) {
      state.lastPrice = vars.newPrice;
    }

    _coverLoss(splitter, loss, state.strategyProfitHolder, vars.tokenA, vars.tokenB, address(vars.pool));
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

  /// @notice Make rebalance without swaps (using borrowing only).
  /// @param checkNeedRebalance_ True if the function should ensure that the rebalance is required
  /// @param oldTotalAssets Current value of totalAssets()
  /// @return tokenAmounts Token amounts for deposit
  /// @return fuseEnabledOut true if fuse is detected - we need to close all debts asap
  function rebalanceNoSwaps(
    State storage state,
    ITetuConverter converter,
    uint oldTotalAssets,
    uint profitToCover,
    address splitter,
    bool checkNeedRebalance_
  ) external returns (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    bool fuseEnabledOut
  ) {
    RebalanceLocalVariables memory v;
    _initLocalVars(v, converter, state, true, checkNeedRebalance_);

    if (v.isStablePool && isEnableFuse(v.lastPrice, v.newPrice, v.fuseThreshold)) {
      /// enabling fuse: close debt and stop providing liquidity
      state.isFuseTriggered = true;
      emit FuseTriggered();
      fuseEnabledOut = true;
    } else {
      // rebalancing debt, setting new tick range
      UniswapV3DebtLib.rebalanceNoSwaps(converter, state, profitToCover, oldTotalAssets, splitter);

      // need to update last price only for stables coz only stables have fuse mechanic
      if (v.isStablePool) {
        state.lastPrice = v.newPrice;
      }

      uint loss;
      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmounts(converter, oldTotalAssets, v.tokenA, v.tokenB);
      if (loss != 0) {
        _coverLoss(splitter, loss, state.strategyProfitHolder, v.tokenA, v.tokenB, address(v.pool));
      }

      fuseEnabledOut = false;
    }

    return (tokenAmounts, fuseEnabledOut);
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
  ) external returns (uint[] memory tokenAmounts) {
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
    RebalanceLocalVariables memory v,
    ITetuConverter converter,
    State storage state,
    bool checkFillUp,
    bool checkNeedRebalance_
  ) internal view {
    v.pool = state.pool;
    if (checkNeedRebalance_) {
      require(needRebalance(
        state.isFuseTriggered,
        v.pool,
        state.lowerTick,
        state.upperTick,
        state.tickSpacing,
        state.rebalanceTickRange
      ), Uni3StrategyErrors.NO_REBALANCE_NEEDED);
    }

    v.fillUp = state.fillUp;
    if (checkFillUp && v.fillUp) {
      revert('Only for swap strategy.');
    }

    v.tokenA = state.tokenA;
    v.tokenB = state.tokenB;
    v.lastPrice = state.lastPrice;
    v.fuseThreshold = state.fuseThreshold;
    v.isStablePool = state.isStablePool;
    v.newPrice = ConverterStrategyBaseLib2.getOracleAssetsPrice(converter, v.tokenA, v.tokenB);
  }

  /// @notice Get proportion of not-underlying in the pool, [0...1e18]
  ///         prop.underlying : prop.not.underlying = 1e18 - PropNotUnderlying18 : propNotUnderlying18
  function getPropNotUnderlying18(State storage state) view external returns (uint) {
    // pool proportions
    (uint consumed0, uint consumed1) = UniswapV3DebtLib.getEntryDataProportions(
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.depositorSwapTokens
    );
    require(consumed0 + consumed1 > 0, AppErrors.ZERO_VALUE);
    return consumed1 * 1e18 / (consumed0 + consumed1);
  }
}
