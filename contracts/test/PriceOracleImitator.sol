// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";

contract PriceOracleImitator is IPriceOracle {
  address public usdc;
  ITetuLiquidator liquidator;

  constructor(address usdc_, address liquidator_) {
    usdc = usdc_;
    liquidator = ITetuLiquidator(liquidator_);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    if (asset == usdc) {
      return 1e18;
    }
    uint tokenInDecimals = IERC20Metadata(asset).decimals();
    uint lPrice = liquidator.getPrice(asset, usdc, 10 ** tokenInDecimals);
    return lPrice * 1e12;
  }

  function setUsdc(address asset) external {
    usdc = asset;
  }
}
