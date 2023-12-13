// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../strategies/pancake/PancakeConverterStrategyLogicLib.sol";

contract PancakeConverterStrategyLogicLibFacade {
    PancakeConverterStrategyLogicLib.State public state;

    function setState(
        PairBasedStrategyLogicLib.PairState memory pair,
        uint tokenId,
        IPancakeMasterChefV3 chef
    ) external {
        state.tokenId = tokenId;
        state.chef = chef;
        state.pair = pair;
    }

    function enter(
        uint[] memory amountsDesired_
    ) external returns (
        uint[] memory amountsConsumed,
        uint liquidityOut
    ) {
        return PancakeConverterStrategyLogicLib.enter(state, amountsDesired_);
    }

    function initStrategyState(
        address controller_,
        address pool,
        int24 tickRange,
        int24 rebalanceTickRange,
        address asset_,
        uint[4] calldata fuseThresholds
    ) external {
        PancakeConverterStrategyLogicLib.initStrategyState(state, controller_, pool, tickRange, rebalanceTickRange, asset_, fuseThresholds);
    }
}
