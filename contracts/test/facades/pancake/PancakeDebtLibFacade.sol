// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../libs/TokenAmountsLib.sol";
import "../../../integrations/pancake/IPancakeV3Pool.sol";
import "../../../strategies/pancake/PancakeDebtLib.sol";

contract PancakeDebtLibFacade {
  function getEntryDataProportions(
    IPancakeV3Pool pool,
    int24 lowerTick,
    int24 upperTick,
    bool depositorSwapTokens
  ) external view returns (uint prop0, uint prop1) {
    return PancakeDebtLib.getEntryDataProportions(pool, lowerTick, upperTick, depositorSwapTokens);
  }
}