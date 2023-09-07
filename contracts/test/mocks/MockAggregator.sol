// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";

/// @notice This is a mock pool that swaps one token to another using prices a bit different from the prices from the given oracle
/// 1) Put enough amounts of potential tokens-out to balance on this contract
/// 2) For each pair (tokenIn, tokenOut) set up liquidation params
contract MockAggregator {
  uint internal constant DENOMINATOR = 100_000;
  IPriceOracle internal priceOracle;

  struct SwapParams {
    address tokenIn;
    address tokenOut;
    /// @notice true - increase output amount on {percentToIncrease}
    bool increaseOutput;
    /// @notice Percent of changing output amount, DENOMINATOR = 100_000, so 1000 = 1%
    uint percentToIncrease;
  }
  mapping(bytes32 => SwapParams) internal _swapParams;

  constructor(address priceOracle_) {
    priceOracle = IPriceOracle(priceOracle_);
  }

  function setupLiquidate(address tokenIn, address tokenOut, bool increaseOutput, uint percentToIncrease) external {
    bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenIn));
    _swapParams[key] = SwapParams({
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      increaseOutput: increaseOutput,
      percentToIncrease: percentToIncrease
    });
  }

  /// @dev The function has same declaration as TetuLiquidator.liquidate
  function liquidate(address tokenIn, address tokenOut, uint amountIn, uint slippage) external {
    slippage; //hide warning

    SwapParams memory swapParams;
    {
      bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenIn));
      swapParams = _swapParams[key];
    }

    uint amountOut;
    {
      uint priceIn = priceOracle.getAssetPrice(tokenIn);
      uint priceOut = priceOracle.getAssetPrice(tokenOut);

      uint decimalsIn = IERC20Metadata(tokenIn).decimals();
      uint decimalsOut = IERC20Metadata(tokenOut).decimals();

      uint amountOutByOracle = amountIn * priceIn * decimalsOut / priceOut / decimalsIn;
      uint delta = amountOutByOracle * (DENOMINATOR + swapParams.percentToIncrease) / DENOMINATOR;
      if (swapParams.increaseOutput) {
        amountOut += delta;
      } else {
        amountOut = amountOut > delta
          ? amountOut - delta
          : 0;
      }
    }

    {
      uint balanceOut = IERC20(tokenIn).balanceOf(address(this));
      require(balanceOut >= amountOut, "MockAggregator has not enough balance");
    }

    if (amountOut != 0) {
      IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
      IERC20(tokenOut).transfer(msg.sender, amountOut);
    }
  }

}