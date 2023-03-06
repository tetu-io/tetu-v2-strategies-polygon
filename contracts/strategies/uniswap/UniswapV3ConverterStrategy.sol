// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
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
    IERC20(pool.token0()).approve(IController(controller_).liquidator(), type(uint).max);
    IERC20(pool.token1()).approve(IController(controller_).liquidator(), type(uint).max);
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

//    console.log('rebalance: remove all liquidity');
    // close univ3 base and fillup positions
    _depositorEmergencyExit();

//    console.log('rebalance: balanceOfTokenA', _balance(tokenA));
//    console.log('rebalance: balanceOfTokenB', _balance(tokenB));

    ITetuConverter _tetuConverter = tetuConverter;
    (uint debtAmount, uint collateralAmount) = _tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
//    console.log('rebalance: collateralAmount in lending', collateralAmount);
//    console.log('rebalance: debtAmount in lending', debtAmount);

    if (_balance(tokenB) > debtAmount) {
//      console.log('rebalance: need to increase debt by', _balance(tokenB) - debtAmount);
//      console.log('rebalance: rebalancing debt and collateral');

      uint needToBorrow = _balance(tokenB) - debtAmount;
      ConverterStrategyBaseLib.OpenPositionLocal memory vars;
      (vars.converters, vars.collateralsRequired, vars.amountsToBorrow,) = tetuConverter.findBorrowStrategies(
          abi.encode(2),
          tokenA,
          needToBorrow,
          tokenB,
          30 days / 2
      );

      uint len = vars.converters.length;
      if (len > 0) {
        for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
          vars.amountToBorrow = needToBorrow < vars.amountsToBorrow[i]
          ? needToBorrow
          : vars.amountsToBorrow[i];
          vars.collateral = needToBorrow < vars.amountsToBorrow[i]
          ? vars.collateralsRequired[i] * needToBorrow / vars.amountsToBorrow[i]
          : vars.collateralsRequired[i];
          needToBorrow -= vars.amountToBorrow;
          if (needToBorrow == 0) break;
        }
      }
//      console.log('rebalance: need collateral     ', vars.collateral);
//      console.log('rebalance: available collateral', _balance(tokenA));

      if (vars.collateral < _balance(tokenA)) {
//        console.log('rebalance: enough collateral, increasing debt');
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(2),
          tokenA,
          tokenB,
          _balance(tokenB) - debtAmount
        );
      } else {
//        console.log('rebalance: not enough collateral, need swap and full debt rebalance');
//        console.log('rebalance: close all debt');
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount
        );
//        console.log('rebalance: full tokenB liquidation');
        ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller()).liquidator()), tokenB, tokenA, _balance(tokenB), 5_000, 0);
//        console.log('rebalance: open new debt');
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1,1,1),
          tokenA,
          tokenB,
          _balance(tokenA)
        );
      }
    } else {
//      console.log('rebalance: need to decrease debt by', debtAmount - _balance(tokenB));
//      console.log('rebalance: rebalancing debt and collateral');
      if (_balance(tokenB) > debtAmount - _balance(tokenB)) {
//        console.log('rebalance: enough tokenB balance to decrease debt');
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount - _balance(tokenB)
        );
      } else {
//        console.log('rebalance: not enough tokenB, need swap and full debt rebalance');

        uint needToSellTokenA = UniswapV3Library.getPrice(pool, tokenB) * (debtAmount - _balance(tokenB)) / 10**IERC20Metadata(tokenB).decimals();
        // add 1% gap for price impact
        needToSellTokenA += needToSellTokenA / 100;
//        console.log('rebalance: tokenA liquidation amountIn, need to buy tokenB', needToSellTokenA, debtAmount - _balance(tokenB));
        (, uint bought) = ConverterStrategyBaseLib.liquidate(ITetuLiquidator(IController(controller()).liquidator()), tokenA, tokenB, needToSellTokenA, 5_000, 0);
//        console.log('rebalance: bought tokenB', bought);
//        console.log('rebalance: close all debt');
        ConverterStrategyBaseLib.closePosition(
          tetuConverter,
          tokenA,
          tokenB,
          debtAmount < _balance(tokenB) ? debtAmount : _balance(tokenB)
        );
//        console.log('rebalance: open new debt');
        ConverterStrategyBaseLib.openPosition(
          tetuConverter,
          abi.encode(1,1,1),
          tokenA,
          tokenB,
          _balance(tokenA)
        );
      }
    }

//    console.log('rebalance: balanceOfTokenA', _balance(tokenA));
//    console.log('rebalance: balanceOfTokenB', _balance(tokenB));

    // set new ticks
    _setNewTickRange();

    // make deposit
    uint[] memory tokenAmounts = new uint[](2);
    tokenAmounts[0] = _balance(tokenA);
    tokenAmounts[1] = _balance(tokenB);
    /*(uint[] memory amountsConsumed,) = */_depositorEnter(tokenAmounts);

    // add fillup liquidity
    _addFillup();

    // adjust _investedAssets
    _updateInvestedAssets();

    // adjust base-amounts
    _updateBaseAmountsForAsset(tokenA, balanceOfTokenABefore > _balance(tokenA) ? balanceOfTokenABefore - _balance(tokenA) : _balance(tokenA) - balanceOfTokenABefore, balanceOfTokenABefore < _balance(tokenA));
    _updateBaseAmountsForAsset(tokenB, balanceOfTokenBBefore > _balance(tokenB) ? balanceOfTokenBBefore - _balance(tokenB) : _balance(tokenB) - balanceOfTokenBBefore, balanceOfTokenBBefore < _balance(tokenB));
  }
}