// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-liquidator/contracts/interfaces/ISwapper.sol";

/// @notice This is a mock swapper that swaps one token to another using prices a bit different from the prices from the given oracle
/// 1) Put enough amounts of potential tokens-out to balance on this contract
/// 2) For each pair (tokenIn, tokenOut) set up liquidation params
/// By default, price from oracle is used.
/// Pool is not used by this swapper, the swapper makes any swaps using assets from its own balances.
contract MockSwapper is ISwapper {
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

  function setupSwap(address tokenIn, address tokenOut, bool increaseOutput, uint percentToIncrease) external {
    bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenIn));
    _swapParams[key] = SwapParams({
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      increaseOutput: increaseOutput,
      percentToIncrease: percentToIncrease
    });
  }

  function swap(address pool, address tokenIn, address tokenOut, address recipient, uint priceImpactTolerance) external override {
    priceImpactTolerance; //hide warning
    pool; //hide warning

    uint amountIn = IERC20(tokenIn).balanceOf(address(this));

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
      IERC20(tokenOut).transfer(msg.sender, amountOut);
    }
  }

  /// @notice getPrice always return amount calculated by oracle prices
  function getPrice(address pool, address tokenIn, address tokenOut, uint amount) external override view returns (uint) {
    pool; // hide warning

    uint priceIn = priceOracle.getAssetPrice(tokenIn);
    uint priceOut = priceOracle.getAssetPrice(tokenOut);

    uint decimalsIn = IERC20Metadata(tokenIn).decimals();
    uint decimalsOut = IERC20Metadata(tokenOut).decimals();

    uint amountOutByOracle = amount * priceIn * decimalsOut / priceOut / decimalsIn;
    return amountOutByOracle;
  }
}