// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPairBasedStrategyReaderAccess.sol";
import "hardhat/console.sol";

contract PairBasedStrategyReaderAccessMock is IPairBasedStrategyReaderAccess {
  address internal _converter;
  address internal _splitter;
  address internal _tokenA;
  address internal _tokenB;
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

  function setPoolTokens(address tokenA, address tokenB) external {
    _tokenA = tokenA;
    _tokenB = tokenB;
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

  function getPoolTokens() external view returns (address tokenA, address tokenB) {
    return (_tokenA, _tokenB);
  }
}