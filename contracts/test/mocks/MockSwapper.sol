// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-liquidator/contracts/interfaces/ISwapper.sol";
import "hardhat/console.sol";

/// @notice This is a mock swapper that swaps one token to another using prices a bit different from the prices from the given oracle
/// 1) Put enough amounts of potential tokens-out to balance on this contract
/// 2) For each pair (tokenIn, tokenOut) set up liquidation params
/// By default, price from oracle is used.
/// Pool is not used by this swapper, the swapper makes any swaps using assets from its own balances.
contract MockSwapper is ISwapper {
  uint internal constant DENOMINATOR = 100_000;
  IPriceOracle internal priceOracle;
  address internal token0;
  address internal token1;
  uint internal reserves0;
  uint internal reserves1;


  struct SwapParams {
    address tokenIn;
    address tokenOut;
    /// @notice true - increase output amount on {percentToIncrease}
    bool increaseOutput;
    /// @notice Percent of changing output amount, DENOMINATOR = 100_000, so 1000 = 1%
    uint percentToIncrease;
  }
  mapping(bytes32 => SwapParams) internal _swapParams;

  constructor(address priceOracle_, address token0_, address token1_) {
    priceOracle = IPriceOracle(priceOracle_);
    token0 = token0_;
    token1 = token1_;
  }

  function setupReserves() external {
    reserves0 = IERC20(token0).balanceOf(address(this));
    reserves1 = IERC20(token1).balanceOf(address(this));
    console.log("setupReserves.reserves0", reserves0);
    console.log("setupReserves.reserves1", reserves1);
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

    uint reserves = (tokenIn == token0 ? reserves0 : reserves1);
    console.log("MockSwapper.swap.reserves", reserves);
    console.log("MockSwapper.swap.reserves0", reserves0);
    console.log("MockSwapper.swap.reserves1", reserves1);
    console.log("MockSwapper.swap.balance", IERC20(tokenIn).balanceOf(address(this)));
    uint amountIn = IERC20(tokenIn).balanceOf(address(this)) - reserves;
    console.log("MockSwapper.swap.amountIn", amountIn);

    SwapParams memory swapParams;
    {
      bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenIn));
      swapParams = _swapParams[key];
    }

    if (tokenOut == address(0)) {
      tokenOut = tokenIn == token0 ? token1 : token0;
    }

    uint amountOut;
    {
      uint priceIn = priceOracle.getAssetPrice(tokenIn);
      uint priceOut = priceOracle.getAssetPrice(tokenOut);

      uint decimalsIn = IERC20Metadata(tokenIn).decimals();
      uint decimalsOut = IERC20Metadata(tokenOut).decimals();

      uint amountOutByOracle = amountIn * priceIn * decimalsOut / priceOut / decimalsIn;
      if (swapParams.increaseOutput) {
        amountOut += amountOutByOracle * (DENOMINATOR + swapParams.percentToIncrease) / DENOMINATOR;
      } else {
        amountOut = amountOutByOracle * (DENOMINATOR - swapParams.percentToIncrease) / DENOMINATOR;
      }
    }

    {
      uint balanceOut = IERC20(tokenIn).balanceOf(address(this));
      require(balanceOut >= amountOut, "MockSwapper has not enough balance");
    }

    if (amountOut != 0) {
      IERC20(tokenOut).transfer(recipient, amountOut);
      console.log("MockSwapper.transfer amountOut to recipient", amountOut, recipient);
    }

    reserves0 = IERC20(token0).balanceOf(address(this));
    reserves1 = IERC20(token1).balanceOf(address(this));
    console.log("MockSwapper.swap.final.reserves0", reserves0);
    console.log("MockSwapper.swap.final.reserves1", reserves1);
  }

  /// @notice getPrice always return amount calculated by oracle prices
  function getPrice(address pool, address tokenIn, address tokenOut, uint amount) external override view returns (uint) {
    console.log("getPrice.pool", pool);
    console.log("getPrice.tokenIn", tokenIn);
    console.log("getPrice.tokenOut", tokenOut);
    console.log("getPrice.amount", amount);
    pool; // hide warning

    if (tokenOut == address(0)) {
      tokenOut = tokenIn == token0 ? token1 : token0;
    }

    uint priceIn = priceOracle.getAssetPrice(tokenIn);
    uint priceOut = priceOracle.getAssetPrice(tokenOut);
    console.log("getPrice.priceIn", priceIn);
    console.log("getPrice.priceOut", priceOut);

    uint decimalsIn = IERC20Metadata(tokenIn).decimals();
    uint decimalsOut = IERC20Metadata(tokenOut).decimals();

    if (amount == 0) {
      return priceOut;
    } else {
      uint amountOutByOracle = amount * priceIn * decimalsOut / priceOut / decimalsIn;
      console.log("getPrice.amountOutByOracle", amountOutByOracle);
      return amountOutByOracle;
    }
  }
}