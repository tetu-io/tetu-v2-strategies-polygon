// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract MockUniswapV3Pool {
  Slot0Data internal slot0data;
  struct Slot0Data {
    uint160 sqrtPriceX96;
    int24 tick;
    uint16 observationIndex;
    uint16 observationCardinality;
    uint16 observationCardinalityNext;
    uint8 feeProtocol;
    bool unlocked;
  }
  function setSlot0(
    uint160 sqrtPriceX96,
    int24 tick,
    uint16 observationIndex,
    uint16 observationCardinality,
    uint16 observationCardinalityNext,
    uint8 feeProtocol,
    bool unlocked
  ) external {
    slot0data.sqrtPriceX96 = sqrtPriceX96;
    slot0data.tick = tick;
    slot0data.observationIndex = observationIndex;
    slot0data.observationCardinality = observationCardinality;
    slot0data.observationCardinalityNext = observationCardinalityNext;
    slot0data.feeProtocol = feeProtocol;
    slot0data.unlocked = unlocked;
  }

  function slot0() external view returns (
    uint160 sqrtPriceX96,
    int24 tick,
    uint16 observationIndex,
    uint16 observationCardinality,
    uint16 observationCardinalityNext,
    uint8 feeProtocol,
    bool unlocked
  ) {
    return (
      slot0data.sqrtPriceX96,
      slot0data.tick,
      slot0data.observationIndex,
      slot0data.observationCardinality,
      slot0data.observationCardinalityNext,
      slot0data.feeProtocol,
      slot0data.unlocked
    );
  }
}