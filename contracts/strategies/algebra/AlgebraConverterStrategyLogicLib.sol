// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";
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
    event Rebalanced();
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

    //////////////////////////////////////////
    //            HELPERS
    //////////////////////////////////////////

    function emitDisableFuse() external {
        emit DisableFuse();
    }

    function emitNewFuseThreshold(uint value) external {
        emit NewFuseThreshold(value);
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
            state.lastPrice = getOracleAssetsPrice(ITetuConverter(converter), tokenA, tokenB);
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

    function getIncentiveKey(State storage state) internal view returns(IncentiveKey memory) {
        return IncentiveKey(state.rewardToken, state.bonusRewardToken, address(state.pool), state.startTime, state.endTime);
    }

    function getFees(State storage state) public view returns (uint fee0, uint fee1) {
        // todo
    }

    function getPoolReserves(State storage state) external view returns (uint[] memory reserves) {
        // todo
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
        if (tokenId == 0) {
            (tokenId, liquidity, amountsConsumed[0], amountsConsumed[1]) = ALGEBRA_NFT.mint(INonfungiblePositionManager.MintParams(
                    token0,
                    token1,
                    state.lowerTick,
                    state.upperTick,
                    amountsDesired_[0],
                    amountsDesired_[1],
                    0,
                    0,
                    address(this),
                    block.timestamp
                ));

            // console.log('Algebra NFT tokenId', tokenId);
            // console.log('liquidity', uint(liquidity));

            state.tokenId = tokenId;

            ALGEBRA_NFT.safeTransferFrom(address(this), address(FARMING_CENTER), tokenId);
            FARMING_CENTER.deposits(tokenId);
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
        // todo
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
        address tokenB = state.tokenB;
        uint rewardInTermOfTokenA;
        uint bonusRewardInTermOfTokenA;

        {
            IAlgebraEternalFarming farming = FARMING_CENTER.eternalFarming();
            IncentiveKey memory key = getIncentiveKey(state);
            (uint reward, uint bonusReward) = farming.getRewardInfo(key, state.tokenId);
            //console.log('isReadyToHardWork reward', reward);
            //console.log('isReadyToHardWork bonusReward', bonusReward);
            ITetuLiquidator liquidator = ITetuLiquidator(IController(controller).liquidator());
            if (reward > 0) {
                rewardInTermOfTokenA = liquidator.getPrice(state.rewardToken, tokenA, reward);
            }
            if (bonusRewardInTermOfTokenA > 0) {
                bonusRewardInTermOfTokenA = liquidator.getPrice(state.bonusRewardToken, tokenA, bonusReward);
            }
            //console.log('isReadyToHardWork rewardInTermOfTokenA', rewardInTermOfTokenA);
            //console.log('isReadyToHardWork bonusRewardInTermOfTokenA', bonusRewardInTermOfTokenA);
        }

        // check claimable amounts and compare with thresholds
        (uint fee0, uint fee1) = getFees(state);

        if (state.depositorSwapTokens) {
            (fee0, fee1) = (fee1, fee0);
        }

        address h = state.strategyProfitHolder;

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
        IAlgebraPool pool = state.pool;
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
        (amountsOut[0], amountsOut[1]) = FARMING_CENTER.collect(INonfungiblePositionManager.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max));

        emit AlgebraFeesClaimed(amountsOut[0], amountsOut[1]);

        if (state.depositorSwapTokens) {
            (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
        }
        //console.log('claimRewards amountsOut[0]', amountsOut[0]);
        //console.log('claimRewards amountsOut[1]', amountsOut[1]);

        (amountsOut[2], amountsOut[3]) = FARMING_CENTER.collectRewards(getIncentiveKey(state), tokenId);
        //console.log('claimRewards amountsOut[2]', amountsOut[2]);
        //console.log('claimRewards amountsOut[3]', amountsOut[3]);

        if (amountsOut[2] > 0) {
            FARMING_CENTER.claimReward(tokensOut[2], address(this), 0, amountsOut[2]);
        }

        if (amountsOut[3] > 0) {
            FARMING_CENTER.claimReward(tokensOut[3], address(this), 0, amountsOut[3]);
        }

        emit AlgebraRewardsClaimed(amountsOut[2], amountsOut[3]);

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

    function sendFeeToProfitHolder(State storage state, uint fee0, uint fee1) external {
        address strategyProfitHolder = state.strategyProfitHolder;
        require(strategyProfitHolder != address (0), AlgebraStrategyErrors.ZERO_PROFIT_HOLDER);
        if (state.depositorSwapTokens) {
            IERC20(state.tokenA).safeTransfer(strategyProfitHolder, fee1);
            IERC20(state.tokenB).safeTransfer(strategyProfitHolder, fee0);
        } else {
            IERC20(state.tokenA).safeTransfer(strategyProfitHolder, fee0);
            IERC20(state.tokenB).safeTransfer(strategyProfitHolder, fee1);
        }
        emit AlgebraFeesClaimed(fee0, fee1);
    }

    // todo sendRewardsToProfitHolder

    //////////////////////////////////////////
    //            Rebalance
    //////////////////////////////////////////

    function needRebalance(State storage state) public view returns (bool) {
        // todo
        return false;
    }

    function quoteRebalanceSwap(State storage state, ITetuConverter converter) external returns (bool, uint) {
        // todo
        return (false, 0);
    }

    function rebalance(
        State storage state,
        ITetuConverter converter,
        address controller,
        uint oldInvestedAssets
    ) external returns (
        uint[] memory tokenAmounts // _depositorEnter(tokenAmounts) if length == 2
    ) {
        // todo
    }

    function rebalanceSwapByAgg(
        State storage state,
        ITetuConverter converter,
        uint oldInvestedAssets,
        RebalanceSwapByAggParams memory aggParams
    ) external returns (
        uint[] memory tokenAmounts // _depositorEnter(tokenAmounts) if length == 2
    ) {
        // todo
    }
}