// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;


/// @notice Interface required to implement UniswapV3Reader
interface IUniswapV3Depositor{

  /// @notice Returns the current state of the contract.
  function getState() external view returns (
    address tokenA,
    address tokenB,
    address pool,
    address profitHolder,
    int24 tickSpacing,
    int24 lowerTick,
    int24 upperTick,
    int24 rebalanceTickRange,
    uint128 totalLiquidity,
    bool isFuseTriggered,
    uint fuseThreshold,
    uint[] memory rebalanceResults
  );
}
