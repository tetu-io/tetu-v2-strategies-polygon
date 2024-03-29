// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPairBasedStrategyReaderAccess.sol";
import "hardhat/console.sol";
import "../../strategies/pair/PairBasedStrategyLib.sol";

contract PairBasedStrategyReaderAccessMock is IPairBasedStrategyReaderAccess {
  address internal _converter;
  address internal _splitter;
  address internal _tokenA;
  address internal _tokenB;
  address internal _asset;
  uint internal _totalAssets;
  uint[] internal _nums;

  function setConverter(address converter_) external {
    _converter = converter_;
  }

  function setSplitter(address splitter_) external {
    _splitter = splitter_;
  }

  function setTotalAssets(uint totalAssets_) external {
    _totalAssets = totalAssets_;
  }

  function setPoolTokens(address tokenA, address tokenB) external {
    _tokenA = tokenA;
    _tokenB = tokenB;
  }

  function setDefaultStateNums(uint[] memory nums_) external {
    require(nums_.length == 13, "setDefaultStateNums nums length != 13, see getDefaultState impl");
    _nums = nums_;
  }

  function setAsset(address asset_) external {
    _asset = asset_;
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

  function asset() external view returns (address) {
    return _asset;
  }

  /// @notice Returns the current state of the contract
  /// @return addr [tokenA, tokenB, pool, profitHolder]
  /// @return tickData [tickSpacing, lowerTick, upperTick, rebalanceTickRange]
  /// @return nums [totalLiquidity, fuse-status-tokenA, fuse-status-tokenB, withdrawDone]
  function getDefaultState() external view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  ) {
    addr = new address[](4);
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_A] = _tokenA;
    addr[PairBasedStrategyLib.IDX_ADDR_DEFAULT_STATE_TOKEN_B] = _tokenB;

    tickData = new int24[](4);
    nums = _nums;
    boolValues = new bool[](2);

    return (addr, tickData, nums, boolValues);
  }
}