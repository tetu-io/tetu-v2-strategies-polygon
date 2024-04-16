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

  struct ActionResult {
    bool isCalled;
    uint256 amount0;
    uint256 amount1;
  }

  Slot0Data internal _slot0data;
  uint128 internal _liquidity;
  mapping(bytes32 => ActionResult) internal _mintResults;
  mapping(bytes32 => ActionResult) internal _burnResults;
  mapping(bytes32 => ActionResult) internal _collectResults;

  //region --------------------------------- Slot0

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
  //endregion --------------------------------- Slot0

  //region --------------------------------- Liquidity
  function setLiquidity(uint128 liquidity_) external {
    _liquidity = liquidity_;
  }

  function liquidity() external view returns (uint128) {
    return _liquidity;
  }
  //endregion --------------------------------- Liquidity

  //region --------------------------------- Mint
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
    _mintResults[key] = ActionResult({amount0: amount0, amount1: amount1, isCalled: false});
  }

  function mint(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount,
    bytes calldata data
  ) external view returns (uint256 amount0, uint256 amount1) {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount, data));
    ActionResult memory r = _mintResults[key];
    r.isCalled = true;
    return (r.amount0, r.amount1);
  }

  function isMintCalled(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external view returns (bool) {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount, data));
    ActionResult memory r = _mintResults[key];
    return r.isCalled;
  }
  //endregion --------------------------------- Mint

  //region --------------------------------- Burn
  function setBurn(
    int24 tickLower,
    int24 tickUpper,
    uint128 amount,
    uint256 amount0,
    uint256 amount1
  ) external {
    bytes32 key = keccak256(abi.encodePacked(tickLower, tickUpper, amount));
    _mintResults[key] = ActionResult({amount0: amount0, amount1: amount1, isCalled: false});
  }

  function burn(int24 tickLower, int24 tickUpper, uint128 amount) external view returns (uint256 amount0, uint256 amount1) {
    bytes32 key = keccak256(abi.encodePacked(tickLower, tickUpper, amount));
    ActionResult memory r = _burnResults[key];
    r.isCalled = true;
    return (r.amount0, r.amount1);
  }

  function isBurnCalled(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external view returns (bool) {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount, data));
    ActionResult memory r = _burnResults[key];
    return r.isCalled;
  }
  //endregion --------------------------------- Burn

  //region --------------------------------- Collect
  function collect(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount0Requested,
    uint128 amount1Requested
  ) external view returns (uint128 amount0, uint128 amount1) {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount0Requested, amount1Requested));
    ActionResult memory r = _collectResults[key];
    r.isCalled = true;
    return (uint128(r.amount0), uint128(r.amount1));
  }

  function setCollect(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount0Requested,
    uint128 amount1Requested,
    uint128 amount0,
    uint128 amount1
  ) external {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount0Requested, amount1Requested));
    _collectResults[key] = ActionResult({amount0: amount0, amount1: amount1, isCalled: false});
  }

  function isCollectCalled(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount0Requested,
    uint128 amount1Requested
  ) external view returns (bool) {
    bytes32 key = keccak256(abi.encodePacked(recipient, tickLower, tickUpper, amount0Requested, amount1Requested));
    ActionResult memory r = _collectResults[key];
    return r.isCalled;
  }
  //endregion --------------------------------- Collect
}