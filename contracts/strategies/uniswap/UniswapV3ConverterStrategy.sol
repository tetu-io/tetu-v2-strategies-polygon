// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogic.sol";
import "../ConverterStrategyBaseLib.sol";

/// @title Delta-neutral liquidity hedging converter fill-up strategy for UniswapV3
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase {
  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = "UniswapV3";
  string public constant override STRATEGY_VERSION = "1.0.0";

  function init(
    address controller_,
    address splitter_,
    address converter_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) external initializer {
    __UniswapV3Depositor_init(ISplitter(splitter_).asset(), pool_, tickRange_, rebalanceTickRange_);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    address liquidator = IController(controller_).liquidator();
    IERC20(tokenA).approve(liquidator, type(uint).max);
    IERC20(tokenB).approve(liquidator, type(uint).max);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() override internal returns (uint earned, uint lost) {
//    console.log('UniswapV3ConverterStrategy _handleRewards');

    uint assetBalanceBefore = _balance(asset);
    _claim();
    uint assetBalanceAfterClaim = _balance(asset);

    if (assetBalanceAfterClaim > assetBalanceBefore) {
      earned += assetBalanceAfterClaim - assetBalanceBefore;
    } else {
      lost += assetBalanceBefore - assetBalanceAfterClaim;
    }

    return (earned, lost);
  }

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual view returns (bool) {
    // check claimable amounts and compare with thresholds
    (uint fee0, uint fee1) = getFees();
    fee0 += rebalanceEarned0;
    fee1 += rebalanceEarned1;

    if (_depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

//    console.log('isReadyToHardWork fee0', fee0);
//    console.log('isReadyToHardWork fee1', fee1);
    return fee0 > liquidationThresholds[tokenA] || fee1 > liquidationThresholds[tokenB];
  }

  function rebalance() public {
    require(needRebalance(), "No rebalancing needed");

//    console.log('rebalance: start');
    (uint fee0, uint fee1) = getFees();
    rebalanceEarned0 += fee0;
    rebalanceEarned1 += fee1;

    uint balanceOfTokenABefore = _balance(tokenA);
    uint balanceOfTokenBBefore = _balance(tokenB);
//    console.log('rebalance: balanceOfTokenABefore', balanceOfTokenABefore);
//    console.log('rebalance: balanceOfTokenBBefore', balanceOfTokenBBefore);

    // close univ3 base and fillup positions
    _depositorEmergencyExit();

    UniswapV3ConverterStrategyLogic.rebalanceDebt(converter, controller(), pool, tokenA, tokenB);

    _setNewTickRange();

    uint[] memory tokenAmounts = new uint[](2);
    tokenAmounts[0] = _balance(tokenA);
    tokenAmounts[1] = _balance(tokenB);
    _depositorEnter(tokenAmounts);

    // add fillup liquidity
    (lowerTickFillup, upperTickFillup, totalLiquidityFillup) = UniswapV3ConverterStrategyLogic.addFillup(pool, lowerTick, upperTick, tickSpacing);

    // adjust _investedAssets
    _updateInvestedAssets();

    // adjust base-amounts
    uint balanceOfTokenAAfter = _balance(tokenA);
    uint balanceOfTokenBAfter = _balance(tokenB);
    _updateBaseAmountsForAsset(tokenA, balanceOfTokenABefore > balanceOfTokenAAfter ? 0 : balanceOfTokenAAfter - balanceOfTokenABefore, balanceOfTokenABefore > balanceOfTokenAAfter ? balanceOfTokenABefore - balanceOfTokenAAfter : 0);
    _updateBaseAmountsForAsset(tokenB, balanceOfTokenBBefore > balanceOfTokenBAfter ? 0 : balanceOfTokenBAfter - balanceOfTokenBBefore, balanceOfTokenBBefore > balanceOfTokenBAfter ? balanceOfTokenBBefore - balanceOfTokenBAfter : 0);
  }
}