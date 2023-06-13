// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./AlgebraDepositor.sol";
import "./AlgebraConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingStrategy.sol";
import "./AlgebraStrategyErrors.sol";


contract AlgebraConverterStrategy is AlgebraDepositor, ConverterStrategyBase, IRebalancingStrategy {

    /////////////////////////////////////////////////////////////////////
    ///                CONSTANTS
    /////////////////////////////////////////////////////////////////////

    string public constant override NAME = "Algebra Converter Strategy";
    string public constant override PLATFORM = AppPlatforms.ALGEBRA;
    string public constant override STRATEGY_VERSION = "1.0.0";

    /////////////////////////////////////////////////////////////////////
    ///                INIT
    /////////////////////////////////////////////////////////////////////

    /// @notice Initialize the strategy with the given parameters.
    /// @param controller_ The address of the controller.
    /// @param splitter_ The address of the splitter.
    /// @param converter_ The address of the converter.
    /// @param pool_ The address of the pool.
    /// @param tickRange_ The tick range for the liquidity position.
    /// @param rebalanceTickRange_ The tick range for rebalancing.
    function init(
        address controller_,
        address splitter_,
        address converter_,
        address pool_,
        int24 tickRange_,
        int24 rebalanceTickRange_,
        bool isStablePool,
        IncentiveKey memory key
    ) external initializer {
        __ConverterStrategyBase_init(controller_, splitter_, converter_);
        AlgebraConverterStrategyLogicLib.initStrategyState(
            state,
            controller_,
            converter_,
            pool_,
            tickRange_,
            rebalanceTickRange_,
            ISplitter(splitter_).asset(),
            isStablePool
        );

        AlgebraConverterStrategyLogicLib.initFarmingState(
            state,
            key
        );

        // setup specific name for UI
        strategySpecificName = AlgebraConverterStrategyLogicLib.createSpecificName(state);
        emit StrategyLib.StrategySpecificNameChanged(strategySpecificName);
    }

    /////////////////////////////////////////////////////////////////////
    ///                OPERATOR ACTIONS
    /////////////////////////////////////////////////////////////////////

    /// @notice Disable fuse for the strategy.
    function disableFuse() external {
        StrategyLib.onlyOperators(controller());
        state.isFuseTriggered = false;
        state.lastPrice = AlgebraConverterStrategyLogicLib.getOracleAssetsPrice(converter, state.tokenA, state.tokenB);

        AlgebraConverterStrategyLogicLib.emitDisableFuse();
    }

    /// @notice Set the fuse threshold for the strategy.
    /// @param newFuseThreshold The new fuse threshold value.
    function setFuseThreshold(uint newFuseThreshold) external {
        StrategyLib.onlyOperators(controller());
        state.fuseThreshold = newFuseThreshold;

        AlgebraConverterStrategyLogicLib.emitNewFuseThreshold(newFuseThreshold);
    }

    function setStrategyProfitHolder(address strategyProfitHolder) external {
        StrategyLib.onlyOperators(controller());
        state.strategyProfitHolder = strategyProfitHolder;
    }

    /////////////////////////////////////////////////////////////////////
    ///                   METRIC VIEWS
    /////////////////////////////////////////////////////////////////////

    /// @notice Check if the strategy is ready for hard work.
    /// @return A boolean indicating if the strategy is ready for hard work.
    function isReadyToHardWork() override external virtual view returns (bool) {
        return AlgebraConverterStrategyLogicLib.isReadyToHardWork(state, converter, controller());
    }

    /// @notice Check if the strategy needs rebalancing.
    /// @return A boolean indicating if the strategy needs rebalancing.
    function needRebalance() public view returns (bool) {
        return AlgebraConverterStrategyLogicLib.needRebalance(state);
    }

    /// @return swapAtoB, swapAmount
    function quoteRebalanceSwap() external returns (bool, uint) {
        return AlgebraConverterStrategyLogicLib.quoteRebalanceSwap(state, converter);
    }

    /////////////////////////////////////////////////////////////////////
    ///                   CALLBACKS
    /////////////////////////////////////////////////////////////////////

    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /////////////////////////////////////////////////////////////////////
    ///                   REBALANCE
    /////////////////////////////////////////////////////////////////////

    /// @dev The rebalancing functionality is the core of this strategy.
    ///      Swap method is used.
    function rebalance() external {
        address _controller = controller();
        StrategyLib.onlyOperators(_controller);

        (, uint profitToCover) = _fixPriceChanges(true);
        uint oldTotalAssets = totalAssets() - profitToCover;

        /// withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
        /// after disableFuse() liquidity is zero
        if (state.totalLiquidity > 0) {
            _depositorEmergencyExit();
        }

        // _depositorEnter(tokenAmounts) if length == 2
        uint[] memory tokenAmounts = AlgebraConverterStrategyLogicLib.rebalance(
            state,
            converter,
            _controller,
            oldTotalAssets,
            profitToCover,
            splitter
        );

        if (tokenAmounts.length == 2) {
            _depositorEnter(tokenAmounts);
        }

        //updating investedAssets based on new baseAmounts
        _updateInvestedAssets();
    }

    function rebalanceSwapByAgg(bool direction, uint amount, address agg, bytes memory swapData) external {
        address _controller = controller();
        StrategyLib.onlyOperators(_controller);

        (, uint profitToCover) = _fixPriceChanges(true);
        uint oldTotalAssets = totalAssets() - profitToCover;

        /// withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
        /// after disableFuse() liquidity is zero
        if (state.totalLiquidity > 0) {
            _depositorEmergencyExit();
        }

        // _depositorEnter(tokenAmounts) if length == 2
        uint[] memory tokenAmounts = AlgebraConverterStrategyLogicLib.rebalanceSwapByAgg(
            state,
            converter,
            oldTotalAssets,
            AlgebraConverterStrategyLogicLib.RebalanceSwapByAggParams(
                direction,
                amount,
                agg,
                swapData
            ),
            profitToCover,
            splitter
        );

        if (tokenAmounts.length == 2) {
            _depositorEnter(tokenAmounts);
        }

        //updating investedAssets based on new baseAmounts
        _updateInvestedAssets();
    }

    /////////////////////////////////////////////////////////////////////
    ///                   INTERNAL LOGIC
    /////////////////////////////////////////////////////////////////////

    function _beforeDeposit(
        ITetuConverter tetuConverter_,
        uint amount_,
        address[] memory /*tokens_*/,
        uint /*indexAsset_*/
    ) override internal virtual returns (
        uint[] memory tokenAmounts
    ) {
        require(!needRebalance(), AlgebraStrategyErrors.NEED_REBALANCE);

        tokenAmounts = new uint[](2);
        uint spentCollateral;

        bytes memory entryData = AlgebraConverterStrategyLogicLib.getEntryData(
            state.pool,
            state.lowerTick,
            state.upperTick,
            state.depositorSwapTokens
        );

        AppLib.approveIfNeeded(state.tokenA, amount_, address(tetuConverter_));
        (spentCollateral, tokenAmounts[1]) = ConverterStrategyBaseLib.openPosition(
            tetuConverter_,
            entryData,
            state.tokenA,
            state.tokenB,
            amount_,
            0
        );

        tokenAmounts[0] = amount_ - spentCollateral;
    }

    /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
    /// @return earned The amount of earned rewards.
    /// @return lost The amount of lost rewards.
    /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
    function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
        (address[] memory rewardTokens, uint[] memory amounts) = _claim();
        earned = AlgebraConverterStrategyLogicLib.calcEarned(state.tokenA, controller(), rewardTokens, amounts);
        _rewardsLiquidation(rewardTokens, amounts);
        return (earned, lost, AppLib.balance(asset));
    }

    /// @notice Deposit given amount to the pool.
    /// @param amount_ The amount to be deposited.
    /// @param updateTotalAssetsBeforeInvest_ A boolean indicating if the total assets should be updated before investing.
    /// @return strategyLoss Loss should be covered from Insurance
    function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
        uint strategyLoss
    ) {
        if (state.isFuseTriggered) {
            uint[] memory tokenAmounts = new uint[](2);
            tokenAmounts[0] = amount_;
            emit OnDepositorEnter(tokenAmounts, tokenAmounts);
            return 0;
        } else {
            return super._depositToPool(amount_, updateTotalAssetsBeforeInvest_);
        }
    }

    function _beforeWithdraw(uint /*amount*/) internal view override {
        require(!needRebalance(), AlgebraStrategyErrors.NEED_REBALANCE);
    }
}
