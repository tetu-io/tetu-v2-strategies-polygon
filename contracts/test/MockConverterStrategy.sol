// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../strategies/ConverterStrategyBase.sol";
import "./MockDepositor.sol";

/// @title Mock Converter Strategy with MockDepositor
/// @author bogdoslav
contract MockConverterStrategy is ConverterStrategyBase, MockDepositor {

  string public constant override NAME = "mock converter strategy";
  string public constant override PLATFORM = "test";
  string public constant override STRATEGY_VERSION = "1.0.0";

  function init(
    address controller_,
    address splitter_,
    address converter_,
    address[] memory depositorTokens_,
    address[] memory depositorRewardTokens_,
    uint[] memory depositorRewardAmounts_,
    uint[] memory depositorWeights_,
    uint[] memory depositorReserves_
  ) external initializer {

    __MockDepositor_init(
      depositorTokens_,
      depositorRewardTokens_,
      depositorRewardAmounts_,
      depositorWeights_,
      depositorReserves_
    );

    __ConverterStrategyBase_init(
      controller_,
      splitter_,
      converter_
    );
  }

  //////////////////////////////////////////////////////////////////////
  ///    Provide direct access to internal functions for tests
  //////////////////////////////////////////////////////////////////////
  function getExpectedWithdrawnAmountUSDTestAccess(
    uint liquidityAmount_,
    uint totalSupply_,
    address priceOracle_
  ) external view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    return _getExpectedWithdrawnAmountUSD(
      liquidityAmount_,
      totalSupply_,
      IPriceOracle(priceOracle_)
    );
  }

  function convertWithdrawnAmountsToAssetTestAccess() external {
    _convertWithdrawnAmountsToAsset();
  }
}
