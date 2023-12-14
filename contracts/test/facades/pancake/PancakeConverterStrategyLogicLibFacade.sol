// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../strategies/pancake/PancakeConverterStrategyLogicLib.sol";
import "@tetu_io/tetu-liquidator/contracts/dex/uniswap3/interfaces/IUniswapV3Pool.sol";
import "hardhat/console.sol";

contract PancakeConverterStrategyLogicLibFacade {
  PancakeConverterStrategyLogicLib.State public state;

  function setState(uint tokenId, IPancakeMasterChefV3 chef) external {
    state.tokenId = tokenId;
    state.chef = chef;
    // use initStrategyState to initialize state.pair
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    state.pair.strategyProfitHolder = strategyProfitHolder;
  }

  function enter(uint[] memory amountsDesired_) external returns (uint[] memory amountsConsumed, uint liquidityOut) {
    return PancakeConverterStrategyLogicLib.enter(state, amountsDesired_);
  }

  function exit(uint128 liquidityAmountToExit, bool emergency) external returns (uint[] memory amountsOut) {
    return PancakeConverterStrategyLogicLib.exit(state, liquidityAmountToExit, emergency);
  }

  function initStrategyState(
    address controller_,
    address pool,
    int24 tickRange,
    int24 rebalanceTickRange,
    address asset_,
    uint[4] calldata fuseThresholds,
    address chef_
  ) external {
    PancakeConverterStrategyLogicLib.initStrategyState(state, [controller_, pool, chef_], tickRange, rebalanceTickRange, asset_, fuseThresholds);
  }

  function claimRewards() external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory balancesBefore
  ) {
    return PancakeConverterStrategyLogicLib.claimRewards(state);
  }

  function getDefaultState() external view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  ) {
    return PairBasedStrategyLogicLib.getDefaultState(state.pair);
  }

  function getPoolReserves() external view returns (
    uint[] memory reserves
  ) {
    return PancakeConverterStrategyLogicLib.getPoolReserves(state.pair);
  }

  function quoteExit(uint128 liquidityAmountToExit) public view returns (uint[] memory amountsOut) {
    return PancakeConverterStrategyLogicLib.quoteExit(state.pair, liquidityAmountToExit);
  }

//  function onERC721Received(
//    address,
//    address,
//    uint256,
//    bytes memory
//  ) external pure returns (bytes4) {
//    return this.onERC721Received.selector;
//  }
}
