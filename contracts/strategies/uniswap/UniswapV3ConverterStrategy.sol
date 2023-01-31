// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";

/// @title Delta-neutral liquidity hedging converter strategy for UniswapV3
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase {
  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = "UniswapV3";
  string public constant override STRATEGY_VERSION = "1.0.0";

  uint public rebalanceEarned;
  uint public rebalanceLost;

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
    IERC20(pool.token0()).approve(IController(controller_).liquidator(), type(uint).max);
    IERC20(pool.token1()).approve(IController(controller_).liquidator(), type(uint).max);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() override internal returns (uint earned, uint lost) {
    console.log('UniswapV3ConverterStrategy _handleRewards');

    if (rebalanceEarned != 0) {
      earned = rebalanceEarned;
      rebalanceEarned = 0;
    }

    if (rebalanceLost != 0) {
      lost = rebalanceLost;
      rebalanceLost = 0;
    }

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

  function rebalance() public {
    require(needRebalance(), "No rebalancing needed");

    console.log('rebalance: start');

    uint balanceOfCollateralBefore = _balance(tokenA);
    console.log('rebalance: balanceOfCollateralBefore', balanceOfCollateralBefore);

    // close univ3 position
    _depositorEmergencyExit();

    // calculate amount and direction for swap
    ITetuConverter _tetuConverter = tetuConverter;
    (uint needToRepay,) = _tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
    console.log('rebalance: tetuConverter.getDebtAmountCurrent needToRepay', needToRepay);

    uint balanceOfCollateral = _balance(tokenA);
    console.log('rebalance: balanceOfCollateral after univ3 position close', balanceOfCollateral);

    uint balanceOfBorrowed = _balance(tokenB);
    console.log('rebalance: balanceOfBorrowed after univ3 position close', balanceOfBorrowed);

    ITetuLiquidator _tetuLiquidator = ITetuLiquidator(IController(controller()).liquidator());

    if (needToRepay > balanceOfBorrowed) {
      // need to swap tokenA to exact tokenB
      console.log('rebalance: need to swap tokenA to exact tokenB');
      uint tokenBDecimals = IERC20Metadata(tokenB).decimals();
      uint needToBuyTokenB = needToRepay - balanceOfBorrowed;
      console.log('rebalance: needToBuyTokenB', needToBuyTokenB);
      uint tokenBPrice = _tetuLiquidator.getPrice(tokenB, tokenA, 10 ** tokenBDecimals);

      console.log('rebalance: tokenBPrice', tokenBPrice);

      // todo add gap
      uint needToSpendTokenA = needToBuyTokenB * tokenBPrice / 10 ** tokenBDecimals;
      console.log('rebalance: needToSpendTokenA', needToSpendTokenA);

      // swap by liquidator
      _tetuLiquidator.liquidate(tokenA, tokenB, needToSpendTokenA, 1000);
      console.log('rebalance: new balanceOfBorrowed', _balance(tokenB));
    } else {
      // need to swap exact tokenB to tokenA
      console.log('rebalance: need to swap exact tokenB to tokenA');

      uint needToSellTokenB = balanceOfBorrowed - needToRepay;
      _tetuLiquidator.liquidate(tokenB, tokenA, needToSellTokenB, 1000);
    }

    // set new ticks
    _setNewTickRange();

    // make deposit
    uint[] memory tokenAmounts = new uint[](2);
    tokenAmounts[0] = _balance(tokenA);
    tokenAmounts[1] = _balance(tokenB);
    /*(uint[] memory amountsConsumed,) = */_depositorEnter(tokenAmounts);
    uint balanceOfCollateralAfter = _balance(tokenA);
    console.log('rebalance: balanceOfCollateralAfter', balanceOfCollateralAfter);

    if (balanceOfCollateralAfter > balanceOfCollateralBefore) {
      rebalanceEarned += balanceOfCollateralAfter - balanceOfCollateralBefore;
      console.log('rebalance: rebalanceEarned', balanceOfCollateralAfter - balanceOfCollateralBefore);
      console.log('rebalance: rebalanceEarned total', rebalanceEarned);
    } else {
      rebalanceLost += balanceOfCollateralBefore - balanceOfCollateralAfter;
      console.log('rebalance: rebalanceLost', balanceOfCollateralBefore - balanceOfCollateralAfter);
      console.log('rebalance: rebalanceLost total', rebalanceLost);
    }
  }
}