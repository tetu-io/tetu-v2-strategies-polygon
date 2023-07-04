// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IPriceOracle.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../interfaces/IUniswapV3ConverterStrategyReaderAccess.sol";
import "../../libs/AppLib.sol";
import "../ConverterStrategyBaseLib.sol";

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
  /// @dev We cannot call strategy.getState() because of stack too deep problem
  /// @param strategy_ Instance of UniswapV3ConverterStrategy
  /// @return estimatedUnderlyingAmount Total locked amount recalculated to the underlying
  /// @return totalAssets strategy.totalAssets() - in terms of underlying
  function getLockedUnderlyingAmount(address strategy_) external view returns (
    uint estimatedUnderlyingAmount,
    uint totalAssets
  ) {
    GetLockedUnderlyingAmountLocal memory v;
    IUniswapV3ConverterStrategyReaderAccess strategy = IUniswapV3ConverterStrategyReaderAccess(strategy_);

    (address tokenA, address tokenB) = strategy.getPoolTokens();
    v.converter = ITetuConverter(strategy.converter());

    v.tokens = new address[](2);
    v.tokens[0] = ISplitter(strategy.splitter()).asset(); // underlying
    v.tokens[1] = tokenA == v.tokens[0] ? tokenB : tokenA; // not underlying

    IPriceOracle priceOracle = AppLib._getPriceOracle(v.converter);
    (v.prices, v.decs) =  AppLib._getPricesAndDecs(priceOracle, v.tokens, 2);

    // direct borrow: underlying is collateral
    (v.directDebt, v.directCollateral) = v.converter.getDebtAmountStored(strategy_, v.tokens[0], v.tokens[1], true);

    // reverse borrow: underlying is borrowed asset
    (v.reverseDebt, v.reverseCollateral) = v.converter.getDebtAmountStored(strategy_, v.tokens[1], v.tokens[0], true);

    v.directDebtCost = v.directDebt * v.prices[1] * v.decs[0] / v.decs[1] / v.prices[0];
    v.reverseCollateralCost = v.reverseCollateral * v.prices[1] * v.decs[0] / v.decs[1] / v.prices[0];

    return (
      v.directCollateral + v.reverseCollateralCost - v.directDebtCost - v.reverseDebt,
      strategy.totalAssets()
    );
  }
}