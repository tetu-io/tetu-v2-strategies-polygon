// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/uniswap/UniswapV3Lib.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../../strategies/uniswap/UniswapV3AggLib.sol";

/// @notice Provide direct access to UniswapV3Lib functions for unit tests
contract UniswapV3AggLibFacade {
  function quoteWithdrawStep(
    ITetuConverter converter_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    uint[] memory amountsFromPool,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    return UniswapV3AggLib.quoteWithdrawStep(converter_, tokens, liquidationThresholds, amountsFromPool, planKind, propNotUnderlying18);
  }

  function withdrawStep(
    ITetuConverter converter_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    address tokenToSwap_,
    uint amountToSwap_,
    address aggregator_,
    bytes memory swapData_,
    bool useLiquidator_,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    bool completed
  ) {
    return UniswapV3AggLib.withdrawStep(
      converter_,
      tokens,
      liquidationThresholds,
      tokenToSwap_,
      amountToSwap_,
      aggregator_,
      swapData_,
      useLiquidator_,
      planKind,
      propNotUnderlying18
    );
  }

  function _swap(
    ConverterStrategyBaseLib.SwapRepayPlanParams memory p,
    UniswapV3AggLib.SwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) external returns (
    uint spentAmountIn
  ) {
    return UniswapV3AggLib._swap(p, aggParams, indexIn, indexOut, amountIn);
  }
}
