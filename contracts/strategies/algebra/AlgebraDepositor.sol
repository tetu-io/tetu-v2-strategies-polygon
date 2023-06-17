// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "../DepositorBase.sol";
import "./AlgebraStrategyErrors.sol";
import "./AlgebraConverterStrategyLogicLib.sol";


abstract contract AlgebraDepositor is DepositorBase, Initializable {
    using SafeERC20 for IERC20;

    /////////////////////////////////////////////////////////////////////
    ///                CONSTANTS
    /////////////////////////////////////////////////////////////////////

    /// @dev Version of this contract. Adjust manually on each code modification.
    string public constant Algebra_DEPOSITOR_VERSION = "1.0.0";

    /////////////////////////////////////////////////////////////////////
    ///                VARIABLES
    /////////////////////////////////////////////////////////////////////

    /// @dev State variable to store the current state of the whole strategy
    AlgebraConverterStrategyLogicLib.State internal state;

    /////////////////////////////////////////////////////////////////////
    ///                       View
    /////////////////////////////////////////////////////////////////////

    /// @notice Returns the current state of the contract.
    function getState() external view returns (
        address tokenA,
        address tokenB,
        IAlgebraPool pool,
        int24 tickSpacing,
        int24 lowerTick,
        int24 upperTick,
        int24 rebalanceTickRange,
        uint128 totalLiquidity,
        bool isFuseTriggered,
        uint fuseThreshold,
        address profitHolder,
        uint[] memory profitHolderBalances
    ) {
        tokenA = state.tokenA;
        tokenB = state.tokenB;
        pool = state.pool;
        tickSpacing = state.tickSpacing;
        lowerTick = state.lowerTick;
        upperTick = state.upperTick;
        rebalanceTickRange = state.rebalanceTickRange;
        totalLiquidity = state.totalLiquidity;
        isFuseTriggered = state.isFuseTriggered;
        fuseThreshold = state.fuseThreshold;
        profitHolder = state.strategyProfitHolder;
        profitHolderBalances = new uint[](4);
        profitHolderBalances[0] = IERC20(tokenA).balanceOf(profitHolder);
        profitHolderBalances[1] = IERC20(tokenB).balanceOf(profitHolder);
        profitHolderBalances[2] = IERC20(state.rewardToken).balanceOf(profitHolder);
        profitHolderBalances[3] = IERC20(state.bonusRewardToken).balanceOf(profitHolder);
    }

    /// @notice Returns the fees for the current state.
    /// @return fee0 and fee1.
    function getFees() public view returns (uint fee0, uint fee1) {
        return AlgebraConverterStrategyLogicLib.getFees(state);
    }

    /// @notice Returns the pool assets.
    /// @return poolAssets An array containing the addresses of the pool assets.
    function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
        poolAssets = new address[](2);
        poolAssets[0] = state.tokenA;
        poolAssets[1] = state.tokenB;
    }

    /// @notice Returns the pool weights and the total weight.
    /// @return weights An array containing the weights of the pool assets, and totalWeight the sum of the weights.
    function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
        weights = new uint[](2);
        weights[0] = 1;
        weights[1] = 1;
        totalWeight = 2;
    }

    /// @notice Returns the pool reserves.
    /// @return reserves An array containing the reserves of the pool assets.
    function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
        return AlgebraConverterStrategyLogicLib.getPoolReserves(state);
    }

    /// @notice Returns the current liquidity of the depositor.
    /// @return The current liquidity of the depositor.
    function _depositorLiquidity() override internal virtual view returns (uint) {
        return uint(state.totalLiquidity);
    }

    /// @notice Returns the total supply of the depositor.
    /// @return In UniV3 we can not calculate the total supply of the wgole pool. Return only ourself value.
    function _depositorTotalSupply() override internal view virtual returns (uint) {
        return uint(state.totalLiquidity);
    }

    /////////////////////////////////////////////////////////////////////
    ///             Enter, exit
    /////////////////////////////////////////////////////////////////////

    /// @notice Handles the deposit operation.
    function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (uint[] memory amountsConsumed, uint liquidityOut) {
        (amountsConsumed, liquidityOut) = AlgebraConverterStrategyLogicLib.enter(state, amountsDesired_);
    }

    /// @notice Handles the withdrawal operation.
    /// @param liquidityAmount The amount of liquidity to be withdrawn.
    /// @return amountsOut The amounts of the tokens withdrawn.
    function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
        amountsOut = AlgebraConverterStrategyLogicLib.exit(state, uint128(liquidityAmount));
    }

    /// @notice Returns the amount of tokens that would be withdrawn based on the provided liquidity amount.
    /// @param liquidityAmount The amount of liquidity to quote the withdrawal for.
    /// @return amountsOut The amounts of the tokens that would be withdrawn.
    function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
        amountsOut = AlgebraConverterStrategyLogicLib.quoteExit(state, uint128(liquidityAmount));
    }

    /////////////////////////////////////////////////////////////////////
    ///             Claim rewards
    /////////////////////////////////////////////////////////////////////

    /// @notice Claims all possible rewards.
    /// @return tokensOut An array containing the addresses of the reward tokens,
    /// @return amountsOut An array containing the amounts of the reward tokens.
    function _depositorClaimRewards() override internal virtual returns (
        address[] memory tokensOut,
        uint[] memory amountsOut,
        uint[] memory balancesBefore
    ) {
        return AlgebraConverterStrategyLogicLib.claimRewards(state);
    }

    /// @dev This empty reserved space is put in place to allow future versions to add new
    /// variables without shifting down storage in the inheritance chain.
    /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
    uint[50-1] private __gap; // 50 - count of variables

}