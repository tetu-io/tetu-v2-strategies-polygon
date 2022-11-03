// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";

contract MockLiquidator is ITetuLiquidator {

  uint price = 100_000 * 1e18;
  string error = "";
  uint routeLength = 1;

  function setPrice(uint value) external {
    price = value;
  }

  function setError(string memory value) external {
    error = value;
  }

  function setRouteLength(uint value) external {
    routeLength = value;
  }

  function getPrice(address, address, uint) external view override returns (uint) {
    return price;
  }

  function getPriceForRoute(PoolData[] memory, uint) external view override returns (uint) {
    return price;
  }

  function isRouteExist(address, address) external pure override returns (bool) {
    return true;
  }

  function buildRoute(
    address tokenIn,
    address tokenOut
  ) external view override returns (PoolData[] memory route, string memory errorMessage) {
    if (routeLength == 1) {
      route = new PoolData[](1);
      route[0].tokenIn = tokenIn;
      route[0].tokenOut = tokenOut;
    } else {
      route = new PoolData[](0);
    }
    return (route, error);
  }

  function liquidate(
    address,
    address tokenOut,
    uint amount,
    uint
  ) external override {
    IERC20(tokenOut).transfer(msg.sender, amount);
  }

  function liquidateWithRoute(
    PoolData[] memory route,
    uint amount,
    uint
  ) external override {
    IERC20(route[0].tokenIn).transferFrom(msg.sender, address(this), amount);
    IERC20(route[route.length - 1].tokenOut).transfer(msg.sender, amount);
  }

}
