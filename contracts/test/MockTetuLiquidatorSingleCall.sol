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
  BuildRouteParams public buildRouteParams;
  function buildRoute(
    address tokenIn,
    address tokenOut
  ) external view override returns (
    PoolData[] memory route,
    string memory errorMessage
  ) {
    console.log("MockTetuLiquidatorSingleCall.buildRoute");
    if (bytes(buildRouteParams.errorMessage).length != 0) {
      console.log("MockTetuLiquidatorSingleCall.buildRoute.error");
      return (route, buildRouteParams.errorMessage);
    } else {
      if (
        tokenIn == buildRouteParams.tokenIn
      && tokenOut == buildRouteParams.tokenOut
      ) {
        console.log("MockTetuLiquidatorSingleCall.buildRoute.data");
        route = new PoolData[](1);
        route[0].tokenIn = buildRouteParams.tokenIn;
        route[0].tokenOut = buildRouteParams.tokenOut;
        route[0].pool = buildRouteParams.pool;
        route[0].swapper = buildRouteParams.swapper;
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
    buildRouteParams.errorMessage = errorMessage;
    buildRouteParams.tokenIn = tokenIn;
    buildRouteParams.tokenOut = tokenOut;
    buildRouteParams.pool = pool;
    buildRouteParams.swapper = swapper;
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
  GetPriceForRouteParams public getPriceForRouteParams;
  function getPriceForRoute(PoolData[] memory route, uint amount) external view override returns (uint) {
    console.log("MockTetuLiquidatorSingleCall.getPriceForRoute amount route.length", amount, route.length);
    console.log("MockTetuLiquidatorSingleCall.getPriceForRoute tokenIn, tokenOut", route[0].tokenIn, route[0].tokenOut);
    console.log("MockTetuLiquidatorSingleCall.getPriceForRoute pool, swapper", route[0].pool, route[0].swapper);
    if (
      route.length == 1
      && route[0].tokenOut == getPriceForRouteParams.tokenOut
      && route[0].tokenIn == getPriceForRouteParams.tokenIn
      && route[0].swapper == getPriceForRouteParams.swapper
      && route[0].pool == getPriceForRouteParams.pool
      && amount == getPriceForRouteParams.amount
    ) {
      console.log("MockTetuLiquidatorSingleCall.getPriceForRoute.data");
      return getPriceForRouteParams.priceOut;
    } else {
      console.log("MockTetuLiquidatorSingleCall.getPriceForRoute.missed amount", getPriceForRouteParams.amount);
      console.log("MockTetuLiquidatorSingleCall.getPriceForRoute.missed tokenIn, tokenOut", getPriceForRouteParams.tokenIn, getPriceForRouteParams.tokenOut);
      console.log("MockTetuLiquidatorSingleCall.getPriceForRoute.missed pool, swapper", getPriceForRouteParams.pool, getPriceForRouteParams.swapper);
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
    getPriceForRouteParams.tokenIn = tokenIn;
    getPriceForRouteParams.tokenOut = tokenOut;
    getPriceForRouteParams.pool = pool;
    getPriceForRouteParams.swapper = swapper;
    getPriceForRouteParams.amount = amount;
    getPriceForRouteParams.priceOut = priceOut;
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
  LiquidateWithRouteParams public liquidateWithRouteParams;

  function liquidateWithRoute(
    PoolData[] memory route,
    uint amount,
    uint /*slippage*/
  ) external override {
    console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute");
    if (
      route.length == 1
      && route[0].tokenOut == liquidateWithRouteParams.tokenOut
      && route[0].tokenIn == liquidateWithRouteParams.tokenIn
      && route[0].swapper == liquidateWithRouteParams.swapper
      && route[0].pool == liquidateWithRouteParams.pool
      && amount == liquidateWithRouteParams.amount
    ) {
      console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute.data.1");
      IERC20(route[0].tokenIn).transferFrom(msg.sender, address(this), amount);
      console.log("MockTetuLiquidatorSingleCall.liquidateWithRoute.data.2");
      IERC20(route[0].tokenOut).transfer(msg.sender, liquidateWithRouteParams.amountOut);
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
    liquidateWithRouteParams.tokenIn = tokenIn;
    liquidateWithRouteParams.tokenOut = tokenOut;
    liquidateWithRouteParams.pool = pool;
    liquidateWithRouteParams.swapper = swapper;
    liquidateWithRouteParams.amount = amount;
    liquidateWithRouteParams.slippage = 0;
    liquidateWithRouteParams.amountOut = amountOut;
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
