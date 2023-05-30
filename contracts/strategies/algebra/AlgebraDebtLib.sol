// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBaseLib.sol";
import "./AlgebraLib.sol";
import "./AlgebraStrategyErrors.sol";

library AlgebraDebtLib {
    function calcTickRange(IAlgebraPool pool, int24 tickRange, int24 tickSpacing) public view returns (int24 lowerTick, int24 upperTick) {
        (, int24 tick, , , , ,) = pool.globalState();
        if (tick < 0 && tick / tickSpacing * tickSpacing != tick) {
            lowerTick = ((tick - tickRange) / tickSpacing - 1) * tickSpacing;
        } else {
            lowerTick = (tick - tickRange) / tickSpacing * tickSpacing;
        }
        upperTick = tickRange == 0 ? lowerTick + tickSpacing : lowerTick + tickRange * 2;
    }

    function getEntryData(
        IAlgebraPool pool,
        int24 lowerTick,
        int24 upperTick,
        bool depositorSwapTokens
    ) public view returns (bytes memory entryData) {
        address token1 = pool.token1();
        uint token1Price = AlgebraLib.getPrice(address(pool), token1);

        uint token1Decimals = IERC20Metadata(token1).decimals();

        uint token0Desired = token1Price;
        uint token1Desired = 10 ** token1Decimals;

        // calculate proportions
        (uint consumed0, uint consumed1,) = AlgebraLib.addLiquidityPreview(address(pool), lowerTick, upperTick, token0Desired, token1Desired);

        if (depositorSwapTokens) {
            entryData = abi.encode(1, consumed1 * token1Price / token1Desired, consumed0);
        } else {
            entryData = abi.encode(1, consumed0, consumed1 * token1Price / token1Desired);
        }
    }
}