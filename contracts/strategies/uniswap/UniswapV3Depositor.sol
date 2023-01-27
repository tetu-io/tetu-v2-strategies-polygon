// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../DepositorBase.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../integrations/uniswap/TickMath.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../../integrations/uniswap/LiquidityAmounts.sol";
import "../../tools/AppErrors.sol";

import "hardhat/console.sol";

abstract contract UniswapV3Depositor is IUniswapV3MintCallback, DepositorBase, Initializable {
    using SafeERC20 for IERC20;
    using TickMath for int24;

    struct SwapCallbackData {
        address tokenIn;
        uint amount;
    }

    /// @dev Version of this contract. Adjust manually on each code modification.
    string public constant UNISWAPV3_DEPOSITOR_VERSION = "1.0.0";

    IUniswapV3Pool public pool;
    int24 public lowerTick;
    int24 public upperTick;
    int24 public rebalanceTickRange;

    // asset - collateral token
    address public tokenA;

    // borrowing (hedging) token
    address public tokenB;

    /// @dev Total fractional shares of Uniswap V3 position
    uint128 public totalLiquidity;

    function __UniswapV3Depositor_init(
        address pool_,
        int24 tickRange_,
        int24 rebalanceTickRange_
    ) internal onlyInitializing {
        require(pool_ != address(0) && tickRange_ != 0 && rebalanceTickRange_ !=0, AppErrors.ZERO_ADDRESS);
        pool = IUniswapV3Pool(pool_);
        rebalanceTickRange = rebalanceTickRange_;
        (, int24 tick, , , , , ) = pool.slot0();
        lowerTick = (tick - tickRange_) / 10 * 10;
        upperTick = (tick + tickRange_) / 10 * 10;
        tokenA = pool.token0();
        tokenB = pool.token1();
    }

    function _setNewTickRange() internal {
        (, int24 tick, , , , , ) = pool.slot0();
        int24 halfRange = (upperTick - lowerTick) / 2;
        lowerTick = (tick - halfRange) / 10 * 10;
        upperTick = (tick + halfRange) / 10 * 10;
    }

    /// @notice Uniswap V3 callback fn, called back on pool.mint
    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata /*_data*/
    ) external override {
        require(msg.sender == address(pool), "callback caller");

        if (amount0Owed > 0) IERC20(tokenA).safeTransfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) IERC20(tokenB).safeTransfer(msg.sender, amount1Owed);
    }

    /////////////////////////////////////////////////////////////////////
    ///             Enter, exit
    /////////////////////////////////////////////////////////////////////

    function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
        uint[] memory amountsConsumed,
        uint liquidityOut
    ) {
        amountsConsumed = new uint[](2);

        if (totalLiquidity == 0) {
            (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
            uint128 newLiquidity =
            LiquidityAmounts.getLiquidityForAmounts(
                sqrtRatioX96,
                lowerTick.getSqrtRatioAtTick(),
                upperTick.getSqrtRatioAtTick(),
                    amountsDesired_[0],
                    amountsDesired_[1]
            );
            liquidityOut = uint(newLiquidity);
            (amountsConsumed[0], amountsConsumed[1]) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtRatioX96,
                lowerTick.getSqrtRatioAtTick(),
                upperTick.getSqrtRatioAtTick(),
                newLiquidity
            );
        } else {
            (amountsConsumed[0], amountsConsumed[1], liquidityOut) = _computeMintAmounts(
                totalLiquidity,
                    amountsDesired_[0],
                    amountsDesired_[1]
            );
        }

        pool.mint(address(this), lowerTick, upperTick, uint128(liquidityOut), "");
        totalLiquidity += uint128(liquidityOut);

        // todo sendbackchange?
    }

    function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
        // compute current fees earned
        // todo maybe error design, also can receive all and extract fees proportional to liquidityAmount
        (, int24 tick, , , , , ) = pool.slot0();
        (, uint256 feeGrowthInside0Last, uint256 feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(_getPositionID());
        uint256 fee0 = _computeFeesEarned(true, feeGrowthInside0Last, tick, uint128(liquidityAmount)) + uint256(tokensOwed0);
        uint256 fee1 = _computeFeesEarned(false, feeGrowthInside1Last, tick, uint128(liquidityAmount)) + uint256(tokensOwed1);

        amountsOut = new uint[](2);
        (amountsOut[0], amountsOut[1]) = pool.burn(lowerTick, upperTick, uint128(liquidityAmount));
        pool.collect(
            address(this),
            lowerTick,
            upperTick,
                uint128(amountsOut[0]) + uint128(fee0),
                uint128(amountsOut[1]) + uint128(fee1)
        );

        totalLiquidity -= uint128(liquidityAmount);
    }

    function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
        amountsOut = new uint[](2);

        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();
        (, uint256 feeGrowthInside0Last, uint256 feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(_getPositionID());

        (amountsOut[0], amountsOut[1]) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtRatioX96,
            lowerTick.getSqrtRatioAtTick(),
            upperTick.getSqrtRatioAtTick(),
                uint128(liquidityAmount)
        );

        // compute current fees earned
        uint256 fee0 = _computeFeesEarned(true, feeGrowthInside0Last, tick, uint128(liquidityAmount)) + uint256(tokensOwed0);
        uint256 fee1 = _computeFeesEarned(false, feeGrowthInside1Last, tick, uint128(liquidityAmount)) + uint256(tokensOwed1);
        amountsOut[0] += fee0;
        amountsOut[1] += fee1;
    }

    /////////////////////////////////////////////////////////////////////
    ///             Claim rewards
    /////////////////////////////////////////////////////////////////////

    /// @dev Claim all possible rewards.
    function _depositorClaimRewards() override internal virtual returns (
        address[] memory tokensOut,
        uint[] memory amountsOut
    ) {

        tokensOut = new address[](0);
        amountsOut = new uint[](0);
    }

    /////////////////////////////////////////////////////////////////////
    ///                       View
    /////////////////////////////////////////////////////////////////////

    function needRebalance() public view returns (bool) {
        (, int24 tick, , , , , ) = pool.slot0();
        int24 halfRange = (upperTick - lowerTick) / 2;
        int24 oldMedianTick = lowerTick + halfRange;
        if (tick > oldMedianTick) {
            return tick - oldMedianTick > rebalanceTickRange;
        }
        return oldMedianTick - tick > rebalanceTickRange;
    }

    /// @notice Returns pool assets
    function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
        poolAssets = new address[](2);
        poolAssets[0] = tokenA;
        poolAssets[1] = tokenB;
    }

    function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
        weights = new uint[](2);
        uint128 liquidity = pool.liquidity();
//        console.log("_depositorPoolWeights() liquidity", liquidity);
        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();
        uint amount0Current = LiquidityAmounts.getAmount0ForLiquidity(sqrtRatioX96, upperTick.getSqrtRatioAtTick(), liquidity);
//        console.log("_depositorPoolWeights() amount0Current", amount0Current);
        uint amount0Total = LiquidityAmounts.getAmount0ForLiquidity(lowerTick.getSqrtRatioAtTick(), upperTick.getSqrtRatioAtTick(), liquidity);
//        console.log("_depositorPoolWeights() amount0Total", amount0Total);

        weights[0] = amount0Current;
        weights[1] = amount0Total - amount0Current;
        totalWeight = amount0Total;
    }

    function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
        reserves = new uint[](2);
        (reserves[0], reserves[1]) = getUnderlyingBalances();
    }

    function _depositorLiquidity() override internal virtual view returns (uint) {
        return uint(totalLiquidity);
    }

    function _depositorTotalSupply() override internal view virtual returns (uint) {
        return uint(totalLiquidity);
    }

    function _computeMintAmounts(
        uint256 totalSupply,
        uint256 amount0Max,
        uint256 amount1Max
    ) private view returns (
        uint256 amount0,
        uint256 amount1,
        uint256 mintAmount
    ) {
        (uint256 amount0Current, uint256 amount1Current) = getUnderlyingBalances();

        // compute proportional amount of tokens to mint
        if (amount0Current == 0 && amount1Current > 0) {
            mintAmount = FullMath.mulDiv(
                amount1Max,
                totalSupply,
                amount1Current
            );
        } else if (amount1Current == 0 && amount0Current > 0) {
            mintAmount = FullMath.mulDiv(
                amount0Max,
                totalSupply,
                amount0Current
            );
        } else if (amount0Current == 0 && amount1Current == 0) {
            revert("");
        } else {
            // only if both are non-zero
            uint256 amount0Mint =
            FullMath.mulDiv(amount0Max, totalSupply, amount0Current);
            uint256 amount1Mint =
            FullMath.mulDiv(amount1Max, totalSupply, amount1Current);
            require(amount0Mint > 0 && amount1Mint > 0, "mint 0");

            mintAmount = amount0Mint < amount1Mint ? amount0Mint : amount1Mint;
        }

        // compute amounts owed to contract
        amount0 = FullMath.mulDivRoundingUp(
            mintAmount,
            amount0Current,
            totalSupply
        );
        amount1 = FullMath.mulDivRoundingUp(
            mintAmount,
            amount1Current,
            totalSupply
        );
    }

    function getUnderlyingBalances() public view returns (uint256 amount0Current, uint256 amount1Current) {
        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();
        return _getUnderlyingBalances(sqrtRatioX96, tick);
    }

    function _getUnderlyingBalances(uint160 sqrtRatioX96, int24 tick) internal view returns (uint256 amount0Current, uint256 amount1Current) {
        (uint128 liquidity, uint256 feeGrowthInside0Last, uint256 feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(_getPositionID());

        // compute current holdings from liquidity
        (amount0Current, amount1Current) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtRatioX96,
            lowerTick.getSqrtRatioAtTick(),
            upperTick.getSqrtRatioAtTick(),
            liquidity
        );

        // compute current fees earned
        uint256 fee0 = _computeFeesEarned(true, feeGrowthInside0Last, tick, liquidity) + uint256(tokensOwed0);
        uint256 fee1 = _computeFeesEarned(false, feeGrowthInside1Last, tick, liquidity) + uint256(tokensOwed1);

        // add any leftover in contract to current holdings
        amount0Current += fee0 + IERC20(tokenA).balanceOf(address(this));
        amount1Current += fee1 + IERC20(tokenB).balanceOf(address(this));
    }

    function _getPositionID() internal view returns (bytes32 positionID) {
        return keccak256(abi.encodePacked(address(this), lowerTick, upperTick));
    }

    function _computeFeesEarned(
        bool isZero,
        uint256 feeGrowthInsideLast,
        int24 tick,
        uint128 liquidity
    ) private view returns (uint256 fee) {
        uint256 feeGrowthOutsideLower;
        uint256 feeGrowthOutsideUpper;
        uint256 feeGrowthGlobal;
        if (isZero) {
            feeGrowthGlobal = pool.feeGrowthGlobal0X128();
            (, , feeGrowthOutsideLower, , , , , ) = pool.ticks(lowerTick);
            (, , feeGrowthOutsideUpper, , , , , ) = pool.ticks(upperTick);
        } else {
            feeGrowthGlobal = pool.feeGrowthGlobal1X128();
            (, , , feeGrowthOutsideLower, , , , ) = pool.ticks(lowerTick);
            (, , , feeGrowthOutsideUpper, , , , ) = pool.ticks(upperTick);
        }

    unchecked {
        // calculate fee growth below
        uint256 feeGrowthBelow;
        if (tick >= lowerTick) {
            feeGrowthBelow = feeGrowthOutsideLower;
        } else {
            feeGrowthBelow = feeGrowthGlobal - feeGrowthOutsideLower;
        }

        // calculate fee growth above
        uint256 feeGrowthAbove;
        if (tick < upperTick) {
            feeGrowthAbove = feeGrowthOutsideUpper;
        } else {
            feeGrowthAbove = feeGrowthGlobal - feeGrowthOutsideUpper;
        }

        uint256 feeGrowthInside =
        feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove;
        fee = FullMath.mulDiv(
            liquidity,
            feeGrowthInside - feeGrowthInsideLast,
            0x100000000000000000000000000000000
        );
    }
    }
}