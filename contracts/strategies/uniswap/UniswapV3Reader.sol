// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
// import "../ConverterStrategyBaseLib.sol";
import "../../interfaces/IUniswapV3Depositor.sol";
import "../../interfaces/IUniswapV3ConverterStrategyReaderAccess.sol";
import "../../libs/AppLib.sol";

/// @notice Read raw values and calculate complex values related to UniswapV3ConverterStrategy
contract UniswapV3Reader {

  struct GetLockedUnderlyingAmountLocal {
    ITetuConverter converter;
    address[] tokens;
    uint[] prices;
    uint[] decs;
    uint directDebt;
    uint directCollateral;
    uint reverseDebt;
    uint reverseCollateral;
    uint directDebtCost;
    uint reverseCollateralCost;
  }

  /// @notice Estimate amount of underlying locked in the strategy by TetuConverter
  /// @param strategy_ Instance of UniswapV3ConverterStrategy
  /// @return estimatedUnderlyingAmount Total locked amount recalculated to the underlying
  /// return totalAssets strategy.totalAssets() - in terms of underlying
  function getLockedUnderlyingAmount(
    address strategy_
  ) external view returns (uint estimatedUnderlyingAmount) {
    GetLockedUnderlyingAmountLocal memory v;
    IUniswapV3ConverterStrategyReaderAccess strategy = IUniswapV3ConverterStrategyReaderAccess(strategy_);

    v.converter = ITetuConverter(strategy.converter());

    v.tokens = new address[](2);
    v.tokens[0] = ISplitter(strategy.splitter()).asset(); // underlying
    v.tokens[1] = getSecondAsset(strategy, v.tokens[0]); // not underlying
    (v.prices, v.decs) = getPricesAndDecs(v.converter, v.tokens);

    // direct borrow: underlying is collateral
    (v.directDebt, v.directCollateral) = v.converter.getDebtAmountStored(address(this), v.tokens[0], v.tokens[1], true);

    // reverse borrow: underlying is borrowed asset
    (v.reverseDebt, v.reverseCollateral) = v.converter.getDebtAmountStored(address(this), v.tokens[1], v.tokens[0], true);

    v.directDebtCost = v.directDebt * v.prices[0] * v.decs[1] / v.decs[0] / v.prices[1];
    v.reverseCollateralCost = v.reverseCollateral * v.prices[0] * v.decs[1] / v.decs[0] / v.prices[1];

    return v.directCollateral + v.reverseCollateralCost - v.directDebtCost - v.reverseDebt;
      // strategy.totalAssets()
  }

  function getPricesAndDecs(ITetuConverter converter, address[] memory tokens) internal view returns (
    uint[] memory prices,
    uint[] memory decs
  ) {
    IPriceOracle priceOracle = IPriceOracle(IConverterController(converter.controller()).priceOracle());
    // return ConverterStrategyBaseLib._getPricesAndDecs(priceOracle, tokens, 2);
    return _getPricesAndDecs(priceOracle, tokens, 2);
  }

  function _getPricesAndDecs(IPriceOracle priceOracle, address[] memory tokens_, uint len) internal view returns (
    uint[] memory prices,
    uint[] memory decs
  ) {
    prices = new uint[](len);
    decs = new uint[](len);
    {
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        decs[i] = 10 ** IERC20Metadata(tokens_[i]).decimals();
        prices[i] = priceOracle.getAssetPrice(tokens_[i]);
      }
    }
  }


  function getSecondAsset(
    IUniswapV3ConverterStrategyReaderAccess strategy,
    address underlying
  ) internal view returns (address) {
    (address tokenA, address tokenB, ,,,,,,,,,) = strategy.getState();
    return tokenA == underlying
      ? tokenB
      : tokenA;
  }
}