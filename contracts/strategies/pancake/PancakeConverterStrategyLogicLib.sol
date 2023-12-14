// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "./PancakeLib.sol";
import "./PancakeDebtLib.sol";
import "./PancakeStrategyErrors.sol";
import "../ConverterStrategyBaseLib2.sol";
import "../../libs/AppLib.sol";
import "../../libs/AppErrors.sol";
import "../pair/PairBasedStrategyLib.sol";
import "../pair/PairBasedStrategyLogicLib.sol";
import "../../integrations/pancake/IPancakeNonfungiblePositionManager.sol";
import "../../integrations/pancake/IPancakeMasterChefV3.sol";
import "hardhat/console.sol";

library PancakeConverterStrategyLogicLib {
  using SafeERC20 for IERC20;

  //region ------------------------------------------------ Constants
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_STABLE = 300;
  uint internal constant LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE = 500;
  uint internal constant HARD_WORK_USD_FEE_THRESHOLD = 100;
  //endregion ------------------------------------------------ Constants

  //region ------------------------------------------------ Events
  event Rebalanced(uint loss, uint profitToCover, uint coveredByRewards);
  event RebalancedDebt(uint loss, uint profitToCover, uint coveredByRewards);
  event PancakeFeesClaimed(uint fee0, uint fee1);
  event PancakeRewardsClaimed(uint amount);
  //endregion ------------------------------------------------ Events

  //region ------------------------------------------------ Data types

  struct State {
    PairBasedStrategyLogicLib.PairState pair;

    // additional (specific) state

    /// @notice The ID of the token that represents the minted position
    uint tokenId;
    IPancakeMasterChefV3 chef;

    /// @dev reserve space for future needs
    uint[10] __gap;
  }

  struct RebalanceLocal {
    /// @notice Fuse for token A and token B
    PairBasedStrategyLib.FuseStateParams fuseAB;
    ITetuConverter converter;
    IPancakeV3Pool pool;
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
    IPancakeV3Pool pool;
    /// @notice A boolean indicating if need to use token B instead of token A.
    bool depositorSwapTokens;
    /// @notice The current total liquidity in the pool.
    uint128 liquidity;
    uint tokenId;
    /// @notice The lower tick value for the pool.
    int24 lowerTick;
    /// @notice The upper tick value for the pool.
    int24 upperTick;

    IPancakeMasterChefV3 chef;
  }

  struct ExitLocal {
    address strategyProfitHolder;
    uint128 liquidity;
    uint reward;
    IPancakeMasterChefV3 chef;
    uint tokenId;
  }

  //endregion ------------------------------------------------ Data types

  //region ------------------------------------------------ Helpers

  /// @notice Check if the given pool is a stable pool.
  /// @param pool The Uniswap V3 pool.
  /// @return A boolean indicating if the pool is stable.
  function isStablePool(IPancakeV3Pool pool) public view returns (bool) {
    return pool.fee() == 100;
  }

  /// @param controllerPoolChef [controller, pool, master chef v3]
  /// @param fuseThresholds Fuse thresholds for tokens (stable pool only)
  function initStrategyState(
    State storage state,
    address[3] memory controllerPoolChef,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    uint[4] calldata fuseThresholds
  ) external {
    require(controllerPoolChef[1] != address(0), AppErrors.ZERO_ADDRESS);
    address token0 = IPancakeV3Pool(controllerPoolChef[1]).token0();
    address token1 = IPancakeV3Pool(controllerPoolChef[1]).token1();

    int24[4] memory tickData;
    {
      int24 tickSpacing = PancakeLib.getTickSpacing(IPancakeV3Pool(controllerPoolChef[1]));
      if (tickRange != 0) {
        require(tickRange == tickRange / tickSpacing * tickSpacing, PairBasedStrategyLib.INCORRECT_TICK_RANGE);
        require(rebalanceTickRange == rebalanceTickRange / tickSpacing * tickSpacing, PairBasedStrategyLib.INCORRECT_REBALANCE_TICK_RANGE);
      }
      tickData[0] = tickSpacing;
      (tickData[1], tickData[2]) = PancakeDebtLib.calcTickRange(controllerPoolChef[1], tickRange, tickSpacing);
      tickData[3] = rebalanceTickRange;
    }

    IPancakeMasterChefV3 chef = IPancakeMasterChefV3(payable(controllerPoolChef[2]));
    IPancakeNonfungiblePositionManager nft = IPancakeNonfungiblePositionManager(payable(chef.nonfungiblePositionManager()));
    state.chef = chef;

    PairBasedStrategyLogicLib.setInitialDepositorValues(
      state.pair,
      [controllerPoolChef[1], asset_, token0, token1],
      tickData,
      isStablePool(IPancakeV3Pool(controllerPoolChef[1])),
      fuseThresholds
    );

    address liquidator = IController(controllerPoolChef[0]).liquidator();

    IERC20(token0).approve(liquidator, type(uint).max);
    IERC20(token1).approve(liquidator, type(uint).max);
    IERC20(token0).approve(address(nft), type(uint).max);
    IERC20(token1).approve(address(nft), type(uint).max);
    IERC20(token0).approve(address(chef), type(uint).max); // todo check
    IERC20(token1).approve(address(chef), type(uint).max); // todo check
  }

  function createSpecificName(PairBasedStrategyLogicLib.PairState storage pairState) external view returns (string memory) {
    return string(abi.encodePacked(
      "Pancake ",
      IERC20Metadata(pairState.tokenA).symbol(),
      "/",
      IERC20Metadata(pairState.tokenB).symbol(),
      "-",
      StringLib._toString(IPancakeV3Pool(pairState.pool).fee()))
    );
  }

  /// @dev Gets the liquidator swap slippage based on the pool type (stable or volatile).
  /// @param pool The IPancakeV3Pool instance.
  /// @return The liquidator swap slippage percentage.
  function _getLiquidatorSwapSlippage(IPancakeV3Pool pool) internal view returns (uint) {
    return isStablePool(pool) ? LIQUIDATOR_SWAP_SLIPPAGE_STABLE : LIQUIDATOR_SWAP_SLIPPAGE_VOLATILE;
  }

  /// @notice Calculate proportions of the tokens for entry kind 1
  /// @param pool Pool instance.
  /// @param lowerTick The lower tick of the pool's main range.
  /// @param upperTick The upper tick of the pool's main range.
  /// @param depositorSwapTokens A boolean indicating if need to use token B instead of token A.
  /// @return prop0 Proportion onf token A. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  /// @return prop1 Proportion onf token B. Any decimals are allowed, prop[0 or 1]/(prop0 + prop1) are important only
  function getEntryDataProportions(IPancakeV3Pool pool, int24 lowerTick, int24 upperTick, bool depositorSwapTokens) external view returns (uint, uint) {
    return PancakeDebtLib.getEntryDataProportions(pool, lowerTick, upperTick, depositorSwapTokens);
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
    (uint160 sqrtRatioX96, , , , , ,) = IPancakeV3Pool(pairState.pool).slot0();

    (reserves[0], reserves[1]) = PancakeLib.getAmountsForLiquidity(
      sqrtRatioX96,
      pairState.lowerTick,
      pairState.upperTick,
      pairState.totalLiquidity
    );

    if (pairState.depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }
  //endregion ------------------------------------------------ Pool info

  //region ------------------------------------------------ Join the pool
  /// @notice Enter the pool and provide liquidity with desired token amounts.
  /// @param amountsDesired_ An array containing the desired amounts of tokens to provide liquidity.
  /// @return amountsConsumed An array containing the consumed amounts for each token in the pool.
  /// @return liquidityOut The amount of liquidity added to the pool.
  function enter(State storage state, uint[] memory amountsDesired_) external returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    console.log("enter");
    EnterLocalVariables memory vars = EnterLocalVariables({
      pool: IPancakeV3Pool(state.pair.pool),
      depositorSwapTokens: state.pair.depositorSwapTokens,
      liquidity: 0,
      tokenId: state.tokenId,
      lowerTick: state.pair.lowerTick,
      upperTick: state.pair.upperTick,
      chef: state.chef
    });
    console.log("enter.1");
    IPancakeNonfungiblePositionManager nft = IPancakeNonfungiblePositionManager(payable(vars.chef.nonfungiblePositionManager()));

    amountsConsumed = new uint[](2);

    if (amountsDesired_[1] != 0) {
      console.log("enter.2");
      (address token0, address token1) = vars.depositorSwapTokens
        ? (state.pair.tokenB, state.pair.tokenA)
        : (state.pair.tokenA, state.pair.tokenB);

      console.log("enter.3.token0, token1", token0, token1);
      if (vars.depositorSwapTokens) {
        (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
        console.log("enter.4");
      }

      uint24 fee = vars.pool.fee();
      console.log("enter.5.fee", fee);

      if (vars.tokenId != 0) {
        console.log("enter.6.tokenId", vars.tokenId);
        (,,,,uint24 nftFee, int24 nftLowerTick, int24 nftUpperTick,,,,,) = nft.positions(vars.tokenId);
        if (nftLowerTick != vars.lowerTick || nftUpperTick != vars.upperTick || nftFee != fee) {
          vars.chef.burn(vars.tokenId); // todo
          vars.tokenId = 0;
        }
      }

      if (vars.tokenId == 0) {
        console.log("enter.7");
        (vars.tokenId, vars.liquidity, amountsConsumed[0], amountsConsumed[1]) = nft.mint(IPancakeNonfungiblePositionManager.MintParams(
          token0,
          token1,
          fee,
          vars.lowerTick,
          vars.upperTick,
          amountsDesired_[0],
          amountsDesired_[1],
          0,
          0,
          address(this),
          block.timestamp
        ));
        console.log("enter.8.nft balance", nft.balanceOf(address(this)));
        state.tokenId = vars.tokenId;
        nft.safeTransferFrom(address(this), address(vars.chef), vars.tokenId);
        console.log("enter.9");
      } else {
        console.log("enter.10.amountsDesired_[0]", amountsDesired_[0]);
        console.log("enter.10.amountsDesired_[1]", amountsDesired_[1]);
        (vars.liquidity, amountsConsumed[0], amountsConsumed[1]) = vars.chef.increaseLiquidity(INonfungiblePositionManagerStruct.IncreaseLiquidityParams(
          vars.tokenId,
          amountsDesired_[0],
          amountsDesired_[1],
          0,
          0,
          block.timestamp
        ));
      }
      console.log("enter.11");

      state.pair.totalLiquidity += vars.liquidity;
      liquidityOut = uint(vars.liquidity);

      if (vars.depositorSwapTokens) { // todo do we need it?
        console.log("enter.12");
        (amountsConsumed[0], amountsConsumed[1]) = (amountsConsumed[1], amountsConsumed[0]);
      }
    }
    console.log("enter.13");

    return (amountsConsumed, liquidityOut);
  }

  //endregion ------------------------------------------------ Join the pool

  //region ------------------------------------------------ Exit from the pool
  /// @notice Exit the pool and collect tokens proportional to the liquidity amount to exit.
  /// @param state The State storage object.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @param emergency Emergency exit (only withdraw, don't claim any rewards or make any other additional actions)
  /// @return amountsOut An array containing the collected amounts for each token in the pool.
  function exit(
    State storage state,
    uint128 liquidityAmountToExit,
    bool emergency
  ) external returns (uint[] memory amountsOut) {
    console.log("exit.liquidityAmountToExit", liquidityAmountToExit);
    amountsOut = new uint[](2);

    ExitLocal memory v;
    v.chef = state.chef;
    v.strategyProfitHolder = state.pair.strategyProfitHolder;

    v.liquidity = state.pair.totalLiquidity;
    require(v.liquidity >= liquidityAmountToExit, PancakeStrategyErrors.WRONG_LIQUIDITY);
    console.log("exit.v.liquidity", v.liquidity);

    v.tokenId = state.tokenId;

    // get reward amounts
    if (! emergency) {
      console.log("exit.1");
      // claim rewards and temporary move them to strategyProfitHolder; we will get them back inside claimRewards
      v.reward = _harvest(v.chef, v.tokenId, v.strategyProfitHolder);
      console.log("exit.1.v.reward", v.reward);
    }

    // burn liquidity
    (amountsOut[0], amountsOut[1]) = v.chef.decreaseLiquidity(INonfungiblePositionManagerStruct.DecreaseLiquidityParams(v.tokenId, liquidityAmountToExit, 0, 0, block.timestamp));

    // collect tokens and fee
    console.log("exit.2");
    (uint collected0, uint collected1) = v.chef.collect(INonfungiblePositionManagerStruct.CollectParams(v.tokenId, address(this), type(uint128).max, type(uint128).max));
    console.log("exit.3.collected0, collected1", collected0, collected1);

    uint fee0 = AppLib.sub0(collected0, amountsOut[0]);
    uint fee1 = AppLib.sub0(collected1, amountsOut[1]);
    console.log("exit.3.fee0, fee1", fee0, fee1);

    emit PancakeFeesClaimed(fee0, fee1);

    if (state.pair.depositorSwapTokens) {
      console.log("exit.4");
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
      (fee0, fee1) = (fee1, fee0);
    }

    // send fees to profit holder
    if (fee0 > 0) {
      console.log("exit.5.fee0", fee0);
      IERC20(state.pair.tokenA).safeTransfer(v.strategyProfitHolder, fee0);
    }
    if (fee1 > 0) {
      console.log("exit.6.fee1", fee1);
      IERC20(state.pair.tokenB).safeTransfer(v.strategyProfitHolder, fee1);
    }


    v.liquidity -= liquidityAmountToExit;
    state.pair.totalLiquidity = v.liquidity;

    console.log("exit.7.state.pair.totalLiquidity", state.pair.totalLiquidity);
  }

  /// @notice Estimate the exit amounts for a given liquidity amount in a Uniswap V3 pool.
  /// @param liquidityAmountToExit The amount of liquidity to exit.
  /// @return amountsOut An array containing the estimated exit amounts for each token in the pool.
  function quoteExit(
    PairBasedStrategyLogicLib.PairState storage pairState,
    uint128 liquidityAmountToExit
  ) public view returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    (uint160 sqrtRatioX96, , , , , ,) = IPancakeV3Pool(pairState.pool).slot0();

    (amountsOut[0], amountsOut[1]) = PancakeLib.getAmountsForLiquidity(
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

  //region ------------------------------------------------ Claims
  /// @notice Claim rewards from the Pancake V3 pool.
  /// @return tokensOut An array containing tokenA and tokenB.
  /// @return amountsOut An array containing the amounts of token0 and token1 claimed as rewards.
  function claimRewards(State storage state) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    console.log("claimRewards.1");
    address strategyProfitHolder = state.pair.strategyProfitHolder;
    console.log("claimRewards.2.strategyProfitHolder", strategyProfitHolder);
    IPancakeMasterChefV3 chef = state.chef;
    uint tokenId = state.tokenId;
    console.log("claimRewards.3.tokenId", tokenId);

    tokensOut = new address[](3);
    tokensOut[0] = state.pair.tokenA;
    tokensOut[1] = state.pair.tokenB;
    tokensOut[2] = chef.CAKE();
    console.log("claimRewards.3.CAKE", tokensOut[2]);

    balancesBefore = new uint[](3);
    for (uint i; i < tokensOut.length; i++) {
      balancesBefore[i] = IERC20(tokensOut[i]).balanceOf(address(this));
      console.log("claimRewards.4.balancesBefore[i]", balancesBefore[i]);
    }

    amountsOut = new uint[](3);
    if (tokenId != 0 && state.pair.totalLiquidity != 0) {
      console.log("claimRewards.5.collect");
      // get fees
      (amountsOut[0], amountsOut[1]) = chef.collect(INonfungiblePositionManagerStruct.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max));
      emit PancakeFeesClaimed(amountsOut[0], amountsOut[1]);
      console.log("claimRewards.6.amounts", amountsOut[0], amountsOut[1], amountsOut[2]);

      if (state.pair.depositorSwapTokens) {
        (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
      }

      console.log("claimRewards.7");

      // claim rewards, don't transfer them to strategyProfitHolder
      _harvest(chef, tokenId, address(0));


      amountsOut[2] = AppLib.sub0(IERC20(tokensOut[2]).balanceOf(address(this)), balancesBefore[2]);
      if (amountsOut[2] != 0) {
        emit PancakeRewardsClaimed(amountsOut[2]);
      }
      console.log("claimRewards.8.amounts", amountsOut[0], amountsOut[1], amountsOut[2]);
    }

    // move tokens from strategyProfitHolder on balance
    // the rewards will be recycled outside
    for (uint i; i < tokensOut.length; ++i) {
      uint b = IERC20(tokensOut[i]).balanceOf(strategyProfitHolder);
      if (b != 0) {
        IERC20(tokensOut[i]).transferFrom(strategyProfitHolder, address(this), b);
        amountsOut[i] += b;
        console.log("claimRewards.9.amountsOut[i]", amountsOut[i]);
      }
    }

  }

  /// @notice Collect rewards, hide exceptions
  /// @param to Transfer rewards to {to}, skip transfer if 0

  function _harvest(IPancakeMasterChefV3 chef, uint tokenId, address to) internal returns (uint rewardOut) {
    try chef.harvest(tokenId, address(this)) returns (uint rewardAmount) {
      address token = chef.CAKE();
      rewardOut = Math.min(rewardAmount, IERC20(token).balanceOf(address(this)));
      if (to != address(0) && rewardOut != 0) {
        IERC20(token).safeTransfer(to, rewardOut);
      }
    } catch {
      // an exception in reward-claiming shouldn't stop hardwork / withdraw
    }

    return rewardOut;
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
  function needStrategyRebalance(PairBasedStrategyLogicLib.PairState storage pairState, ITetuConverter converter_) external view returns (
    bool needRebalance
  ) {
    address pool = pairState.pool;
    // poolPrice should have same decimals as a price from oracle == 18
    uint poolPriceAdjustment = PairBasedStrategyLib.getPoolPriceAdjustment(IERC20Metadata(pairState.tokenA).decimals());
    uint poolPrice = PancakeLib.getPrice(pool, pairState.tokenB) * poolPriceAdjustment;
    (needRebalance, , ) = PairBasedStrategyLogicLib.needStrategyRebalance(
      pairState,
      converter_,
      PancakeDebtLib.getCurrentTick(IPancakeV3Pool(pool)),
      poolPrice
    );
  }

  /// @notice Make rebalance without swaps (using borrowing only).
  /// @param converterLiquidator [TetuConverter, TetuLiquidator]
  /// @param totalAssets_ Current value of totalAssets()
  /// @param checkNeedRebalance_ True if the function should ensure that the rebalance is required
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
    v.poolPrice = PancakeLib.getPrice(address(v.pool), pairState.tokenB) * v.poolPriceAdjustment;
    bool needRebalance;
    int24 tick = PancakeDebtLib.getCurrentTick(v.pool);
    (needRebalance,v.fuseStatusChangedAB, v.fuseStatusAB) = PairBasedStrategyLogicLib.needStrategyRebalance(pairState, v.converter, tick, v.poolPrice);

    // update fuse status if necessary
    if (needRebalance) {
      // we assume here, that needRebalance is true if any fuse has changed state, see needStrategyRebalance impl
      PairBasedStrategyLogicLib.updateFuseStatus(pairState, v.fuseStatusChangedAB, v.fuseStatusAB);
    }

    require(!checkNeedRebalance_ || needRebalance, PancakeStrategyErrors.NO_REBALANCE_NEEDED);

    // rebalancing debt, setting new tick range
    if (needRebalance) {
      PancakeDebtLib.rebalanceNoSwaps(converterLiquidator, pairState, profitToCover, totalAssets_, splitter, v.liquidationThresholdsAB, tick);

      uint loss;
      (loss, tokenAmounts) = ConverterStrategyBaseLib2.getTokenAmountsPair(v.converter, totalAssets_, v.tokenA, v.tokenB, v.liquidationThresholdsAB);
      if (loss != 0) {
        ConverterStrategyBaseLib2.coverLossAndCheckResults(csbs, splitter, loss);
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
    v.pool = IPancakeV3Pool(pairState.pool);
    v.fuseAB = pairState.fuseAB;
    v.converter = converter_;
    v.tokenA = pairState.tokenA;
    v.tokenB = pairState.tokenB;
    v.isStablePool = pairState.isStablePool;
    v.liquidationThresholdsAB[0] = AppLib._getLiquidationThreshold(liquidityThresholds_[v.tokenA]);
    v.liquidationThresholdsAB[1] = AppLib._getLiquidationThreshold(liquidityThresholds_[v.tokenB]);
    uint poolPriceDecimals = IERC20Metadata(v.tokenA).decimals();
    v.poolPriceAdjustment = poolPriceDecimals < 18 ? 10 ** (18 - poolPriceDecimals) : 1;
  }

  /// @notice Get proportion of not-underlying in the pool, [0...1e18]
  ///         prop.underlying : prop.not.underlying = 1e18 - PropNotUnderlying18 : propNotUnderlying18
  function getPropNotUnderlying18(PairBasedStrategyLogicLib.PairState storage pairState) view external returns (uint) {
    // get pool proportions
    IPancakeV3Pool pool = IPancakeV3Pool(pairState.pool);
    bool depositorSwapTokens = pairState.depositorSwapTokens;
    (int24 newLowerTick, int24 newUpperTick) = PancakeDebtLib._calcNewTickRange(pool, pairState.lowerTick, pairState.upperTick, pairState.tickSpacing);
    (uint consumed0, uint consumed1) = PancakeDebtLib.getEntryDataProportions(pool, newLowerTick, newUpperTick, depositorSwapTokens);

    require(consumed0 + consumed1 > 0, AppErrors.ZERO_VALUE);
    return consumed1 * 1e18 / (consumed0 + consumed1);
  }
  //endregion ------------------------------------------------ Rebalance

  //region ------------------------------------------------ WithdrawByAgg
  /// @notice Calculate amounts to be deposited to pool, update pairState.lower/upperTick, fix loss / profitToCover
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
    uint entryToPool = values_[3];
    address[2] memory tokens = [pairState.tokenA, pairState.tokenB];

    // Calculate amounts to be deposited to pool, calculate loss, fix profitToCover
    uint[] memory tokenAmounts;
    uint loss;
    (completed, tokenAmounts, loss) = PairBasedStrategyLogicLib.withdrawByAggStep(
      addr_,
      values_,
      swapData,
      planEntryData,
      tokens,
      liquidationThresholds
    );

    // cover loss
    if (loss != 0) {
      ConverterStrategyBaseLib2.coverLossAndCheckResults(
        csbs,
        addr_[4],
        loss
      );
    }
    emit RebalancedDebt(loss, values_[1], 0);

    if (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED
      || (entryToPool == PairBasedStrategyLib.ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED && completed)
    ) {
      // We are going to enter to the pool: update lowerTick and upperTick, initialize tokenAmountsOut
      (pairState.lowerTick, pairState.upperTick) = PancakeDebtLib._calcNewTickRange(
        IPancakeV3Pool(pairState.pool),
        pairState.lowerTick,
        pairState.upperTick,
        pairState.tickSpacing
      );
      tokenAmountsOut = tokenAmounts;
    }
    return (completed, tokenAmountsOut); // hide warning
  }
  //endregion ------------------------------------------------ WithdrawByAgg

}
