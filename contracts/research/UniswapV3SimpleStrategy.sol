// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../integrations/uniswap/IUniswapV3Pool.sol";
import "../integrations/uniswap/TickMath.sol";
import "../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../integrations/uniswap/IUniswapV3SwapCallback.sol";
import "../integrations/uniswap/LiquidityAmounts.sol";

import "hardhat/console.sol";

/// @title Simple Uniswap V3 range moving strategy
/// @author a17
contract UniswapV3SimpleStrategy is IUniswapV3MintCallback, IUniswapV3SwapCallback {
  using SafeERC20 for IERC20;
  using TickMath for int24;

  IUniswapV3Pool public pool;
  int24 public tickRange;
  int24 public rebalanceTickRange;
  int24 private lowerTick;
  int24 private upperTick;
  uint128 private liquidity;
  address private owner;
  uint private constant TWO_96 = 2 ** 96;
  uint160 private constant MIN_SQRT_RATIO = 4295128739 + 1;
  uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342 - 1;

  struct SwapCallbackData {
    address tokenIn;
    uint amount;
  }

  constructor(address pool_, int24 tickRange_, int24 rebalanceTickRange_) {
    pool = IUniswapV3Pool(pool_);
    owner = msg.sender;
    rebalanceTickRange = rebalanceTickRange_;
    tickRange = tickRange_;
    (, int24 tick, , , , ,) = pool.slot0();
    lowerTick = (tick - tickRange_) / 10 * 10;
    upperTick = (tick + tickRange_) / 10 * 10;
  }

  // ***************** VIEW FUNCTION *****************

  function getEstimatedBalance(address token) external view returns(uint) {
    (uint amount0Current, uint amount1Current) = getLiquidityBalances();
    address otherToken = token == pool.token0() ? pool.token1() : pool.token0();
    uint tokenAmountInLiquidity = token == pool.token0() ? amount0Current : amount1Current;
    uint otherTokenAmountInLiquidity = token == pool.token0() ? amount1Current : amount0Current;
    return _balance(token) + tokenAmountInLiquidity + (_balance(otherToken) + otherTokenAmountInLiquidity) * getPrice(otherToken) / 10**IERC20Metadata(otherToken).decimals();
  }

  function getLiquidityBalances() public view returns (uint amount0Current, uint amount1Current) {
    (uint160 sqrtRatioX96, int24 tick, , , , ,) = pool.slot0();
    (, uint256 feeGrowthInside0Last, uint256 feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(_getPositionID());

    // compute current holdings from liquidity
    (amount0Current, amount1Current) = LiquidityAmounts.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      liquidity
    );

    // compute current fees earned
    uint256 fee0 = _computeFeesEarned(true, feeGrowthInside0Last, tick) + uint256(tokensOwed0);
    uint256 fee1 = _computeFeesEarned(false, feeGrowthInside1Last, tick) + uint256(tokensOwed1);

    // add any leftover in contract to current holdings
    amount0Current += fee0;
    amount1Current += fee1;
  }

  function getPrice(address tokenIn) public view returns (uint) {
    address token0 = pool.token0();
    address token1 = pool.token1();

    uint256 tokenInDecimals = tokenIn == token0 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    uint256 tokenOutDecimals = tokenIn == token1 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    (uint160 sqrtPriceX96,,,,,,) = pool.slot0();

    uint divider = _max(10 ** tokenOutDecimals / 10 ** tokenInDecimals, 1);
    uint priceDigits = _countDigits(uint(sqrtPriceX96));
    uint purePrice;
    uint precision;
    if (tokenIn == token0) {
      precision = 10 ** ((priceDigits < 29 ? 29 - priceDigits : 0) + 18);
      uint part = uint(sqrtPriceX96) * precision / TWO_96;
      purePrice = part * part;
    } else {
      precision = 10 ** ((priceDigits > 29 ? priceDigits - 29 : 0) + 18);
      uint part = TWO_96 * precision / uint(sqrtPriceX96);
      purePrice = part * part;
    }
    return purePrice / divider / precision / (precision > 1e18 ? (precision / 1e18) : 1);
  }

  function needRebalance() public view returns (bool) {
    (, int24 tick, , , , ,) = pool.slot0();
    int24 halfRange = (upperTick - lowerTick) / 2;
    int24 oldMedianTick = lowerTick + halfRange;
    if (tick > oldMedianTick) {
      return tick - oldMedianTick > rebalanceTickRange;
    }
    return oldMedianTick - tick > rebalanceTickRange;
  }

  // ***************** ACTIONS *****************

  function deposit(address token, uint amount) external {
    require(owner == msg.sender, "Denied");
    require(amount != 0, "Zero amount");
    require(token == pool.token0() || token == pool.token1(), "Not pool token");
    if(needRebalance()) {
      rebalance();
    }
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    _swapExactIn(token, amount / 2);
    _addLiquidity(_balance(pool.token0()), _balance(pool.token1()));
  }

  function withdraw(address token, uint amount) external {
    require(owner == msg.sender, "Denied");
    require(amount != 0, "Zero amount");
    require(token == pool.token0() || token == pool.token1(), "Not pool token");
    (uint amount0Current, uint amount1Current) = getLiquidityBalances();
    uint partOfLiquidity = amount / 2 * 10**10 / (token == pool.token0() ? amount0Current : amount1Current);
    uint toRemove = partOfLiquidity * liquidity / 10**10;
    (uint amount0Out, uint amount1Out) = _removeLiquidity(uint128(toRemove));
    _swapExactIn(token == pool.token0() ? pool.token1() : pool.token0(), token == pool.token0() ? amount1Out : amount0Out);
    IERC20(token).transfer(msg.sender, _balance(token));
  }

  function withdrawAll(address token) external {
    require(owner == msg.sender, "Denied");
    require(token == pool.token0() || token == pool.token1(), "Not pool token");
    address otherToken = token == pool.token0() ? pool.token1() : pool.token0();
    _removeLiquidity(liquidity);
    _swapExactIn(otherToken, _balance(otherToken));
    IERC20(token).transfer(msg.sender, _balance(token));
  }

  function rebalance() public {
    require(needRebalance(), "No rebalancing needed");

    // console.log('rebalance: start');

    if (liquidity != 0) {
      _removeLiquidity(liquidity);
      // console.log('rebalance amount0Out', amount0Out);
      // console.log('rebalance amount1Out', amount1Out);
      uint balance0 = _balance(pool.token0());
      uint balance1 = _balance(pool.token1());

      uint totalAmount0Estimate = balance0 + balance1 * getPrice(pool.token1()) / 10**IERC20Metadata(pool.token1()).decimals();
      uint totalAmount1Estimate = balance1 + balance0 * getPrice(pool.token0()) / 10**IERC20Metadata(pool.token0()).decimals();
      // console.log('rebalance totalAmount0Estimate', totalAmount0Estimate);
      // console.log('rebalance totalAmount1Estimate', totalAmount1Estimate);

      uint optimalAmount0 = totalAmount0Estimate / 2;
      uint optimalAmount1 = totalAmount1Estimate / 2;
      if (optimalAmount0 < balance0) {
        _swapExactIn(pool.token0(), balance0 - optimalAmount0);
      } else {
        _swapExactIn(pool.token1(), balance1 - optimalAmount1);
      }

      _setNewTickRange();

      _addLiquidity(_balance(pool.token0()), _balance(pool.token1()));
    } else {
      _setNewTickRange();
    }

    // console.log('rebalance: end');
  }

  function changeTickRange(int24 newTickRange_) external {
    require(owner == msg.sender, "Denied");
    require(newTickRange_ != 0, "Zero range");
    tickRange = newTickRange_;
    // range will be changed at next rebalance
  }

  function changeRebalanceTickRange(int24 newRebalanceTickRange_) external {
    require(owner == msg.sender, "Denied");
    require(newRebalanceTickRange_ != 0, "Zero range");
    rebalanceTickRange = newRebalanceTickRange_;
    // range will be changed at next rebalance
  }

  // ***************** UNISWAP V3 callbacks *****************

  function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata /*_data*/) external override {
    require(msg.sender == address(pool), "callback caller");
    // console.log('uniswapV3MintCallback amount0Owed', amount0Owed);
    // console.log('uniswapV3MintCallback amount1Owed', amount1Owed);
    if (amount0Owed > 0) IERC20(pool.token0()).safeTransfer(msg.sender, amount0Owed);
    if (amount1Owed > 0) IERC20(pool.token1()).safeTransfer(msg.sender, amount1Owed);
  }

  function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata _data) external override {
    require(msg.sender == address(pool), "callback caller");
    require(amount0Delta > 0 || amount1Delta > 0, "Wrong callback amount");
    SwapCallbackData memory data = abi.decode(_data, (SwapCallbackData));
    IERC20(data.tokenIn).safeTransfer(msg.sender, data.amount);
  }

  // ***************** INTERNAL LOGIC *****************

  function _addLiquidity(uint amount0Desired_, uint amount1Desired_) internal returns (uint amount0Consumed, uint amount1Consumed, uint128 liquidityOut) {
    require(amount0Desired_ != 0 || amount1Desired_ != 0, "Zero amount");
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();
    liquidityOut = LiquidityAmounts.getLiquidityForAmounts(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      amount0Desired_,
      amount1Desired_
    );
    (amount0Consumed, amount1Consumed) = LiquidityAmounts.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
        liquidityOut
    );
    pool.mint(address(this), lowerTick, upperTick, liquidityOut, "");
    liquidity += liquidityOut;
  }

  function _removeLiquidity(uint128 liquidityAmount) internal returns (uint amount0Out, uint amount1Out) {
    require (liquidityAmount != 0, "Zero amount");
    (amount0Out, amount1Out) = pool.burn(lowerTick, upperTick, liquidityAmount);
    pool.collect(
      address(this),
      lowerTick,
      upperTick,
      type(uint128).max,
      type(uint128).max
    );
    liquidity -= liquidityAmount;
  }

  function _swapExactIn(address tokenIn, uint amount) internal {
    address token0 = pool.token0();
    pool.swap(
      address(this),
      tokenIn == token0,
      int(amount),
      tokenIn == token0 ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
      abi.encode(SwapCallbackData(tokenIn, amount))
    );
  }

  function _setNewTickRange() internal {
    (, int24 tick, , , , ,) = pool.slot0();
    lowerTick = (tick - tickRange) / 10 * 10;
    upperTick = (tick + tickRange) / 10 * 10;
  }

  function _getPositionID() internal view returns (bytes32 positionID) {
    return keccak256(abi.encodePacked(address(this), lowerTick, upperTick));
  }

  function _computeFeesEarned(bool isZero, uint256 feeGrowthInsideLast, int24 tick) internal view returns (uint256 fee) {
    uint256 feeGrowthOutsideLower;
    uint256 feeGrowthOutsideUpper;
    uint256 feeGrowthGlobal;
    if (isZero) {
      feeGrowthGlobal = pool.feeGrowthGlobal0X128();
      (,, feeGrowthOutsideLower,,,,,) = pool.ticks(lowerTick);
      (,, feeGrowthOutsideUpper,,,,,) = pool.ticks(upperTick);
    } else {
      feeGrowthGlobal = pool.feeGrowthGlobal1X128();
      (,,, feeGrowthOutsideLower,,,,) = pool.ticks(lowerTick);
      (,,, feeGrowthOutsideUpper,,,,) = pool.ticks(upperTick);
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

  function _balance(address token) internal view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  function _countDigits(uint n) internal pure returns (uint) {
    if (n == 0) {
      return 0;
    }
    uint count = 0;
    while (n != 0) {
      n = n / 10;
      ++count;
    }
    return count;
  }

  function _min(uint256 a, uint256 b) internal pure returns (uint256) {
    return a < b ? a : b;
  }

  function _max(uint256 a, uint256 b) internal pure returns (uint256) {
    return a > b ? a : b;
  }
}
