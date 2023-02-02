// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "hardhat/console.sol";

/// @notice Mock of ITetuLiquidator, each function saves input params and has customizable output value
///         Some functions can be not implemented
/// @dev We assume, that in each test only single function is called, so we can setup behavior before the call
///      and check results after the call on the side of the script
contract MockTetuLiquidatorSingleCall is ITetuLiquidator {


  ///////////////////////////////////////////////////
  ///               build route
  ///////////////////////////////////////////////////
  struct BuildRouteParams {
    address tokenIn;
    address tokenOut;
    address pool;
    address swapper;
    string errorMessage;
  }
  /// @notice keccak256(tokenIn, tokenOut) => results
  mapping(bytes32 => BuildRouteParams) public buildRouteParams;
  function buildRoute(
    address tokenIn,
    address tokenOut
  ) external view override returns (
    PoolData[] memory route,
    string memory errorMessage
  ) {
    console.log("MockTetuLiquidatorSingleCall.buildRoute");
    bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenOut));
    BuildRouteParams memory p = buildRouteParams[key];

    if (bytes(p.errorMessage).length != 0) {
      console.log("MockTetuLiquidatorSingleCall.buildRoute.error");
      return (route, p.errorMessage);
    } else {
      if (tokenIn == p.tokenIn && tokenOut == p.tokenOut) {
        console.log("MockTetuLiquidatorSingleCall.buildRoute.data");
        route = new PoolData[](1);
        route[0].tokenIn = p.tokenIn;
        route[0].tokenOut = p.tokenOut;
        route[0].pool = p.pool;
        route[0].swapper = p.swapper;
        return (route, errorMessage);
      } else {
        console.log("MockTetuLiquidatorSingleCall.buildRoute.error.not.found");
        return (route, "route not found");
      }
    }
  }
  function setBuildRoute(
    address tokenIn,
    address tokenOut,
    address pool,
    address swapper,
    string memory errorMessage
  ) external {
    bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenOut));
    buildRouteParams[key] = BuildRouteParams({
      errorMessage: errorMessage,
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      pool: pool,
      swapper: swapper
    });
  }

  ///////////////////////////////////////////////////
  ///               Get price for route
  ///////////////////////////////////////////////////
  struct GetPriceForRouteParams {
    address tokenIn;
    address tokenOut;
    address pool;
    address swapper;
    uint amount;
    uint priceOut;
  }
  /// @notice keccak256(tokenIn, tokenOut, pool, swapper, amount) => results
  mapping(bytes32 => GetPriceForRouteParams) public getPriceForRouteParams;

  function getPriceForRoute(PoolData[] memory route, uint amount) external view override returns (uint) {
    console.log("MockTetuLiquidatorSingleCall.getPriceForRoute amount route.length", amount, route.length);
    console.log("MockTetuLiquidatorSingleCall.getPriceForRoute tokenIn, tokenOut", route[0].tokenIn, route[0].tokenOut);
    console.log("MockTetuLiquidatorSingleCall.getPriceForRoute pool, swapper", route[0].pool, route[0].swapper);

    bytes32 key = keccak256(abi.encodePacked(route[0].tokenIn, route[0].tokenOut, route[0].pool, route[0].swapper, amount));
    GetPriceForRouteParams memory p = getPriceForRouteParams[key];

    if (route.length == 1 && route[0].tokenOut == p.tokenOut) {
      console.log("MockTetuLiquidatorSingleCall.getPriceForRoute.data");
      return p.priceOut;
    } else {
      console.log("MockTetuLiquidatorSingleCall.getPriceForRoute.missed amount", amount);
      return 0;
    }
  }
  function setGetPriceForRoute(
    address tokenIn,
    address tokenOut,
    address pool,
    address swapper,
    uint amount,
    uint priceOut
  ) external {
    bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenOut, pool, swapper, amount));
    getPriceForRouteParams[key] = GetPriceForRouteParams({
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      pool: pool,
      swapper: swapper,
      amount: amount,
      priceOut: priceOut
    });
  }

  ///////////////////////////////////////////////////
  ///               liquidateWithRoute
  ///////////////////////////////////////////////////
  struct LiquidateWithRouteParams {
    address tokenIn;
    address tokenOut;
    address pool;
    address swapper;
    uint amount;
    uint slippage;
    uint amountOut;
  }
  /// @notice keccak256(tokenIn, tokenOut, pool, swapper, amount) => results
  mapping(bytes32 => LiquidateWithRouteParams) public liquidateWithRouteParams;

  function liquidateWithRoute(
    PoolData[] memory route,
    uint amount,
    uint /*slippage*/
  ) external override {
    console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute");

    bytes32 key = keccak256(abi.encodePacked(route[0].tokenIn, route[0].tokenOut, route[0].pool, route[0].swapper, amount));
    LiquidateWithRouteParams memory p = liquidateWithRouteParams[key];

    if (route.length == 1 && route[0].tokenOut == p.tokenOut) {
      console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute.data.1 balanceIn amount", IERC20(route[0].tokenIn).balanceOf(msg.sender), amount);
      IERC20(route[0].tokenIn).transferFrom(msg.sender, address(this), amount);

      console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute.data.2 balanceOut amount", IERC20(route[0].tokenOut).balanceOf(address(this)), p.amountOut);
      IERC20(route[0].tokenOut).transfer(msg.sender, p.amountOut);

    } else {
      console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute.missed");
    }
  }
  function setLiquidateWithRoute(
    address tokenIn,
    address tokenOut,
    address pool,
    address swapper,
    uint amount,
    uint amountOut
  ) external {
    bytes32 key = keccak256(abi.encodePacked(tokenIn, tokenOut, pool, swapper, amount));
    liquidateWithRouteParams[key] = LiquidateWithRouteParams({
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      pool: pool,
      swapper: swapper,
      amount: amount,
      slippage: 0,
      amountOut: amountOut
    });
  }

  ///////////////////////////////////////////////////
  ///               Get price
  ///////////////////////////////////////////////////
  function getPrice(address tokenIn, address tokenOut, uint amount) external pure override returns (uint) {
    tokenIn;
    tokenOut;
    amount;
    revert("not implemented");
  }

  ///////////////////////////////////////////////////
  ///               liquidate
  ///////////////////////////////////////////////////
  function liquidate(
    address tokenIn,
    address tokenOut,
    uint amount,
    uint slippage
  ) external override {
    tokenIn;
    tokenOut;
    slippage;
    IERC20(tokenOut).transfer(msg.sender, amount);
    revert("not implemented");
  }

  ///////////////////////////////////////////////////
  ///               Is route exists
  ///////////////////////////////////////////////////
  function isRouteExist(address tokenIn, address tokenOut) external pure override returns (bool) {
    tokenIn;
    tokenOut;
    revert("not implemented");
  }

  ///////////////////////////////////////////////////
  ///               addLargestPools
  ///////////////////////////////////////////////////
  function addLargestPools(PoolData[] memory /*_pools*/, bool /*rewrite*/) external pure {
    // noop
    revert("not implemented");
  }

  ///////////////////////////////////////////////////
  ///               addBlueChipsPools
  ///////////////////////////////////////////////////
  function addBlueChipsPools(PoolData[] memory /*_pools*/, bool /*rewrite*/) external pure {
    // noop
    revert("not implemented");
  }

}
