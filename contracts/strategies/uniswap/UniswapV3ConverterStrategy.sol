// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";

/// @title Converter Strategy with UniswapV3
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase {
    string public constant override NAME = "UniswapV3 Converter Strategy";
    string public constant override PLATFORM = "UniswapV3";
    string public constant override STRATEGY_VERSION = "1.0.0";

    function init(
        address controller_,
        address splitter_,
        address converter_,
        address pool_,
        int24 tickRange_,
        int24 rebalanceTickRange_
    ) external initializer {
        __UniswapV3Depositor_init(pool_, tickRange_, rebalanceTickRange_);
        __ConverterStrategyBase_init(controller_, splitter_, converter_);
    }
}