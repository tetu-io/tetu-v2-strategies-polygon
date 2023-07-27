// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../strategies/uniswap/UniswapV3DebtLib.sol";

contract UniswapV3DebtLibFacade {

  function getCurrentTick(IUniswapV3Pool pool) internal view returns (int24 tick) {
    return UniswapV3DebtLib.getCurrentTick(pool);
  }

}
