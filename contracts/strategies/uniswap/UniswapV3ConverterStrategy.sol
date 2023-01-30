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
        __UniswapV3Depositor_init(ISplitter(splitter_).asset(), pool_, tickRange_, rebalanceTickRange_);
        __ConverterStrategyBase_init(controller_, splitter_, converter_);
        IERC20(pool.token0()).approve(IController(controller_).liquidator(), type(uint).max);
        IERC20(pool.token1()).approve(IController(controller_).liquidator(), type(uint).max);
    }

    function rebalance() public {
        require(needRebalance(), "No rebalancing needed");

        // close univ3 position
        _depositorEmergencyExit();

        // calculate amount and direction for swap
        ITetuConverter _tetuConverter = tetuConverter;
        (uint needToRepay,) = _tetuConverter.getDebtAmountCurrent(address(this), tokenA, tokenB);
        // (uint needToRepay,) = _tetuConverter.getDebtAmountStored(address(this), tokenA, tokenB);
        console.log('tetuConverter.getDebtAmountCurrent needToRepay', needToRepay);

        uint balanceOfCollateral = IERC20(tokenA).balanceOf(address(this));
        console.log('balanceOfCollateral', balanceOfCollateral);

        uint balanceOfBorrowed = IERC20(tokenB).balanceOf(address(this));
        console.log('balanceOfBorrowed', balanceOfBorrowed);

        ITetuLiquidator _tetuLiquidator = ITetuLiquidator(IController(controller()).liquidator());

        if (needToRepay > balanceOfBorrowed) {
            // need to swap tokenA to exact tokenB
            console.log('need to swap tokenA to exact tokenB');
            uint tokenBDecimals = IERC20Metadata(tokenB).decimals();
            uint needToBuyTokenB = needToRepay - balanceOfBorrowed;
            console.log('needToBuyTokenB', needToBuyTokenB);
            uint tokenBPrice = _tetuLiquidator.getPrice(tokenB, tokenA, 10**tokenBDecimals);

            console.log('tokenBPrice', tokenBPrice);

            // todo add gap
            uint needToSpendTokenA = needToBuyTokenB * tokenBPrice / 10**tokenBDecimals;
            console.log('needToSpendTokenA', needToSpendTokenA);

            // swap by liquidator
            _tetuLiquidator.liquidate(tokenA, tokenB, needToSpendTokenA, 1000);
            console.log('new balanceOfBorrowed', IERC20(tokenB).balanceOf(address(this)));

        } else {
            // need to swap exact tokenB to tokenA
            console.log('need to swap exact tokenB to tokenA');

            uint needToSellTokenB = balanceOfBorrowed - needToRepay;
            _tetuLiquidator.liquidate(tokenB, tokenA, needToSellTokenB, 1000);
        }

        // repay all debt
        _convertDepositorPoolAssets();

        // set new ticks
        _setNewTickRange();

        // deposit all again
        _depositToPool(IERC20(asset).balanceOf(address(this)));
    }
}