// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract MockUniswapV3Pool {
  struct Slot0Data {
    uint160 sqrtPriceX96;
    int24 tick;
    uint16 observationIndex;
    uint16 observationCardinality;
    uint16 observationCardinalityNext;
    uint8 feeProtocol;
    bool unlocked;
  }

  struct MintResult {
    uint256 amount0;
    uint256 amount1;
  }

  Slot0Data internal _slot0data;
  uint128 internal _liquidity;
  mapping(bytes32 => MintResult) internal _mintResults;

  function setSlot0(
    uint160 sqrtPriceX96,
    int24 tick,
    uint16 observationIndex,
    uint16 observationCardinality,
    uint16 observationCardinalityNext,
    uint8 feeProtocol,
    bool unlocked
  ) external {
    _slot0data.sqrtPriceX96 = sqrtPriceX96;
    _slot0data.tick = tick;
    _slot0data.observationIndex = observationIndex;
    _slot0data.observationCardinality = observationCardinality;
    _slot0data.observationCardinalityNext = observationCardinalityNext;
    _slot0data.feeProtocol = feeProtocol;
    _slot0data.unlocked = unlocked;
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
      _slot0data.sqrtPriceX96,
      _slot0data.tick,
      _slot0data.observationIndex,
      _slot0data.observationCardinality,
      _slot0data.observationCardinalityNext,
      _slot0data.feeProtocol,
      _slot0data.unlocked
    );
  }

  function setLiquidity(uint128 liquidity_) external {
    _liquidity = liquidity_;
  }

  function liquidity() external view returns (uint128) {
    return _liquidity;
  }

  function setMint(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount,
    bytes calldata data,
    uint256 amount0,
    uint256 amount1
  ) external {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount, data));
    _mintResults[key] = MintResult({amount0: amount0, amount1: amount1});
  }

  function mint(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount,
    bytes calldata data
  ) external returns (uint256 amount0, uint256 amount1) {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount, data));
    MintResult memory r = _mintResults[key];
    return (r.amount0, r.amount1);
  }

}