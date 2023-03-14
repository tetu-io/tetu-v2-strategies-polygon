// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
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

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual view returns (bool) {
    // check claimable amounts and compare with thresholds
    (uint fee0, uint fee1) = getFees();
    fee0 += rebalanceEarned0;
    fee1 += rebalanceEarned1;

    if (_depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

    return fee0 > liquidationThresholds[tokenA] || fee1 > liquidationThresholds[tokenB];
  }

  /// @dev The rebalancing functionality is the core of this strategy.
  ///      Depending on the size of the range of liquidity provided, the Fill-up or Swap method is used.
  ///      There is also an attempt to cover rebalancing losses with rewards.
  function rebalance() public {
    require(needRebalance(), "No rebalancing needed");

    /// @dev for ultra-wide ranges we use Swap rebalancing strategy and Fill-up for other
    /// @dev upperTick always greater then lowerTick
    bool fillUp = upperTick - lowerTick >= 4 * tickSpacing;

    /// @dev withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
    _depositorEmergencyExit();

    /// @dev rebalacing debt with passing rebalanceEarned0, rebalanceEarned1 that will remain untouched
    UniswapV3ConverterStrategyLogicLib.rebalanceDebt(
      converter,
      controller(),
      pool,
      tokenA,
      tokenB,
      fillUp,
      lowerTick,
      upperTick,
      tickSpacing,
      _depositorSwapTokens,
      rebalanceEarned0,
      rebalanceEarned1
    );

    /// @dev trying to cover rebalance loss (IL + not hedged part of tokenB + swap cost) by pool rewards
    (rebalanceEarned0, rebalanceEarned1) = UniswapV3ConverterStrategyLogicLib.tryToCoverLoss(
      UniswapV3ConverterStrategyLogicLib.TryCoverLossParams(
        converter,
        controller(),
        pool,
        tokenA,
        tokenB,
        _depositorSwapTokens,
        rebalanceEarned0,
        rebalanceEarned1,
        investedAssets(),
        tickSpacing,
        lowerTick,
        upperTick
      )
    );

    /// @dev calculate and set new tick range
    _setNewTickRange();

    /// @dev put liquidity to pool without updated rebalanceEarned0, rebalanceEarned1 amounts
    uint[] memory tokenAmounts = new uint[](2);
    tokenAmounts[0] = _balance(tokenA) - (_depositorSwapTokens ? rebalanceEarned1 : rebalanceEarned0);
    tokenAmounts[1] = _balance(tokenB) - (_depositorSwapTokens ? rebalanceEarned0 : rebalanceEarned1);
    _depositorEnter(tokenAmounts);

    /// @dev add fill-up liquidity part of fill-up is used
    if (fillUp) {
      (lowerTickFillup, upperTickFillup, totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.addFillup(pool, lowerTick, upperTick, tickSpacing, rebalanceEarned0, rebalanceEarned1);
    }

    /// @dev updating baseAmounts (token amounts on strategy balance which are not rewards)
    uint balanceOfTokenABefore = baseAmounts[tokenA];
    uint balanceOfTokenBBefore = baseAmounts[tokenB];
    uint balanceOfTokenAAfter = _balance(tokenA) - (_depositorSwapTokens ? rebalanceEarned1 : rebalanceEarned0);
    uint balanceOfTokenBAfter = _balance(tokenB) - (_depositorSwapTokens ? rebalanceEarned0 : rebalanceEarned1);
    _updateBaseAmountsForAsset(
      tokenA,
      balanceOfTokenABefore > balanceOfTokenAAfter ? 0 : balanceOfTokenAAfter - balanceOfTokenABefore,
      balanceOfTokenABefore > balanceOfTokenAAfter ? balanceOfTokenABefore - balanceOfTokenAAfter : 0
    );
    _updateBaseAmountsForAsset(
      tokenB,
      balanceOfTokenBBefore > balanceOfTokenBAfter ? 0 : balanceOfTokenBAfter - balanceOfTokenBBefore,
      balanceOfTokenBBefore > balanceOfTokenBAfter ? balanceOfTokenBBefore - balanceOfTokenBAfter : 0
    );

    /// @dev updaing investedAssets based on new baseAmounts
    _updateInvestedAssets();
  }

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory /*tokens_*/,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts,
    uint[] memory borrowedAmounts,
    uint spentCollateral
  ) {
    tokenAmounts = new uint[](2);
    borrowedAmounts = new uint[](2);

    bytes memory entryData = UniswapV3ConverterStrategyLogicLib.getEntryData(pool, lowerTick, upperTick, tickSpacing, _depositorSwapTokens);

    AppLib.approveIfNeeded(tokenA, amount_, address(tetuConverter_));
    (spentCollateral, borrowedAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      tokenA,
      tokenB,
      amount_,
      0
    );

    tokenAmounts[0] = amount_ - spentCollateral;
    tokenAmounts[1] = borrowedAmounts[1];

    return (tokenAmounts, borrowedAmounts, spentCollateral);
  }
}