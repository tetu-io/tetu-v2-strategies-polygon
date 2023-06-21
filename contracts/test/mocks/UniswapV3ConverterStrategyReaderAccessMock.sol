// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IUniswapV3ConverterStrategyReaderAccess.sol";

contract UniswapV3ConverterStrategyReaderAccessMock is IUniswapV3ConverterStrategyReaderAccess {
  address internal _converter;
  address internal _splitter;
  uint internal _totalAssets;

  function setConverter(address converter_) external {
    _converter = converter_;
  }

  function setSplitter(address splitter_) external {
    _splitter = splitter_;
  }

  function setTotalAssets(uint totalAssets_) external {
    _totalAssets = totalAssets_;
  }

  function converter() external view returns (address) {
    return _converter;
  }

  function splitter() external view returns (address) {
    return _splitter;
  }

  function totalAssets() external view returns (uint) {
    return _totalAssets;
  }

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
  ) {
    return (tokenA, tokenB, pool, profitHolder, tickSpacing, lowerTick, upperTick, rebalanceTickRange, totalLiquidity, isFuseTriggered, fuseThreshold, rebalanceResults);
  }
}