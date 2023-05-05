// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

//import "hardhat/console.sol";
import "./compound-core/PriceOracle.sol";
import "./compound-core/CErc20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";

contract CompPriceOracleImitator is PriceOracle {
  address public usdc;
  ITetuLiquidator liquidator;

  constructor(address usdc_, address liquidator_) {
    usdc = usdc_;
    liquidator = ITetuLiquidator(liquidator_);
  }

  function _getUnderlyingAddress(CToken cToken) private view returns (address) {
    return address(CErc20(address(cToken)).underlying());
  }

  function getUnderlyingPrice(CToken cToken) public override view returns (uint) {
    address asset = _getUnderlyingAddress(cToken);
    if (asset == usdc) {
      return 1e18;
    }
    uint tokenInDecimals = IERC20Metadata(asset).decimals();
    uint tokenOutDecimals = IERC20Metadata(usdc).decimals();
    uint price = liquidator.getPrice(asset, usdc, 10 ** tokenInDecimals);

    if (tokenOutDecimals > 18) {
      price = price / 10 ** (tokenOutDecimals - 18);
    } else if (tokenOutDecimals < 18) {
      price = price * 10 ** (18 - tokenOutDecimals);
    }

    return price;
  }
}
