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
    uint propNotUnderlying18,
    uint[] memory amountsFromPool,
    bool singleIteration
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    return UniswapV3AggLib.quoteWithdrawStep(converter_, tokens, liquidationThresholds, propNotUnderlying18, amountsFromPool, singleIteration);
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
    uint propNotUnderlying18,
    bool singleIteration
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
      propNotUnderlying18,
      singleIteration
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
