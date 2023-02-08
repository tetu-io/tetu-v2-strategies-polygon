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


/// @title Uniswap V3 range moving research strategy for tracking IL, rebalance cost and earns.
/// @dev Experimental development. High gas consumption.
/// @author a17
contract UniswapV3ResearchStrategy is IUniswapV3MintCallback, IUniswapV3SwapCallback {
  using SafeERC20 for IERC20;
  using TickMath for int24;

  IUniswapV3Pool public pool;
  string private constant VERSION = "1.2";
  address private _trackingToken;
  uint private _trackingStart;
  uint private _earned;
  uint private _rebalanceCost;
  uint private _il;
  uint private _lastAmount0;
  uint private _lastAmount1;
  uint private _rebalances;
  int24 private _tickRange;
  int24 private _rebalanceTickRange;
  int24 private lowerTick;
  int24 private upperTick;
  uint128 private liquidity;
  address private owner;
  uint private constant TWO_96 = 2 ** 96;
  uint160 private constant MIN_SQRT_RATIO = 4295128739 + 1;
  uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342 - 1;
  bytes16 private constant _SYMBOLS = "0123456789abcdef";

  struct SwapCallbackData {
    address tokenIn;
    uint amount;
  }

  constructor(address pool_, int24 tickRange_, int24 rebalanceTickRange_, address trackingToken_) {
    pool = IUniswapV3Pool(pool_);
    require (trackingToken_ == pool.token0() || trackingToken_ == pool.token1(), "Incorrect trackingToken");
    owner = msg.sender;
    _rebalanceTickRange = rebalanceTickRange_;
    _tickRange = tickRange_;
    (, int24 tick, , , , ,) = pool.slot0();
    lowerTick = (tick - tickRange_) / 10 * 10;
    upperTick = (tick + tickRange_) / 10 * 10;
    _trackingToken = trackingToken_;
  }

  // ***************** VIEW FUNCTION *****************

  function getEstimatedBalance(address token) public view returns(uint) {
    (uint amount0Current, uint amount1Current) = _getLiquidityBalances();
    address otherToken = token == pool.token0() ? pool.token1() : pool.token0();
    uint tokenAmountInLiquidity = token == pool.token0() ? amount0Current : amount1Current;
    uint otherTokenAmountInLiquidity = token == pool.token0() ? amount1Current : amount0Current;
    return _balance(token) + tokenAmountInLiquidity + (_balance(otherToken) + otherTokenAmountInLiquidity) * getPrice(otherToken) / 10**IERC20Metadata(otherToken).decimals();
  }

  function getPrice(address tokenIn) public view returns (uint) {
    address token0 = pool.token0();
    address token1 = pool.token1();

    uint tokenInDecimals = tokenIn == token0 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    uint tokenOutDecimals = tokenIn == token1 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
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
      return tick - oldMedianTick > _rebalanceTickRange;
    }
    return oldMedianTick - tick > _rebalanceTickRange;
  }

  function name() external view returns (string memory n) {
    n = string.concat("RESEARCH_", VERSION, "_", IERC20Metadata(pool.token0()).symbol(), "-", IERC20Metadata(pool.token1()).symbol(), "-", _feeString(pool.fee()), "_", _toString(int(_tickRange)), "-", _toString(int(_rebalanceTickRange)));
  }

  function tracking() external view returns (
    int apr,
    uint earned,
    uint rebalanceCost,
    uint il,
    uint period,
    uint rebalances,
    address trackingToken
  ) {
    earned = _earned;

    (uint fee0, uint fee1) = _getFees();
    if (_trackingToken == pool.token0()) {
      earned += fee0 + fee1 * getPrice(pool.token1()) / 10**IERC20Metadata(pool.token1()).decimals();
    } else {
      earned += fee1 + fee0 * getPrice(pool.token0()) / 10**IERC20Metadata(pool.token0()).decimals();
    }

    rebalanceCost = _rebalanceCost;
    il = _il;
    rebalances = _rebalances;
    trackingToken = _trackingToken;
    int totalEarned = int(earned) - int(_rebalanceCost) - int(_il);
    if (_trackingStart != 0) {
      period = block.timestamp - _trackingStart;
    }
    if (period != 0 && liquidity != 0) {
      int earnedPerSecondWithPrecision = totalEarned * 10**10 / int(period);
      int earnedPerDay = earnedPerSecondWithPrecision * 86400 / 10**10;
      apr = earnedPerDay * 365 * 10**7 / int(getEstimatedBalance(_trackingToken)) / 10**3;
    }
  }

  // ***************** ACTIONS *****************

  function deposit(address token, uint amount) external {
    require(owner == msg.sender, "Denied");
    require(amount != 0, "Zero amount");
    require(token == pool.token0() || token == pool.token1(), "Not pool token");
    if(needRebalance()) {
      rebalanceWithTracking();
    }
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    _swapExactIn(token, amount / 2);
    _addLiquidity(_balance(pool.token0()), _balance(pool.token1()));

    _resetTracking();
  }

  function withdraw(address token, uint amount) external {
    require(owner == msg.sender, "Denied");
    require(amount != 0, "Zero amount");
    require(token == pool.token0() || token == pool.token1(), "Not pool token");
    (uint amount0Current, uint amount1Current) = _getLiquidityBalances();
    uint partOfLiquidity = amount / 2 * 10**10 / (token == pool.token0() ? amount0Current : amount1Current);
    uint toRemove = partOfLiquidity * liquidity / 10**10;
    (uint amount0Out, uint amount1Out) = _removeLiquidity(uint128(toRemove));
    _swapExactIn(token == pool.token0() ? pool.token1() : pool.token0(), token == pool.token0() ? amount1Out : amount0Out);
    IERC20(token).transfer(msg.sender, _balance(token));

    _resetTracking();
  }

  function withdrawAll(address token) external {
    require(owner == msg.sender, "Denied");
    require(token == pool.token0() || token == pool.token1(), "Not pool token");
    address otherToken = token == pool.token0() ? pool.token1() : pool.token0();
    _removeLiquidity(liquidity);
    _swapExactIn(otherToken, _balance(otherToken));
    IERC20(token).transfer(msg.sender, _balance(token));

    _resetTracking();
  }

  /*function rebalance() public {
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
  }*/

  function rebalanceWithTracking() public {
    require(needRebalance(), "No rebalancing needed");

    // console.log('rebalanceWithTracking: start');

    if (liquidity != 0) {
      uint price1 = getPrice(pool.token1());
      uint price0 = getPrice(pool.token0());

      (uint pureAmount0, uint pureAmount1) = _getPureLiquidityBalances();
      uint balance0Before = _balance(pool.token0());
      uint balance1Before = _balance(pool.token1());

      _removeLiquidity(liquidity);

      // console.log('rebalance amount0Out', amount0Out);
      // console.log('rebalance amount1Out', amount1Out);
      uint balance0 = _balance(pool.token0());
      uint balance1 = _balance(pool.token1());

      if (_trackingToken == pool.token0()) {
        _earned += balance0 - pureAmount0 - balance0Before + (balance1 - pureAmount1 - balance1Before) * price1 / 10**IERC20Metadata(pool.token1()).decimals();
      } else {
        _earned += balance1 - pureAmount1 - balance1Before + (balance0 - pureAmount0 - balance0Before) * price0 / 10**IERC20Metadata(pool.token0()).decimals();
      }

      uint totalAmount0Estimate = balance0 + balance1 * price1 / 10**IERC20Metadata(pool.token1()).decimals();
      uint totalAmount1Estimate = balance1 + balance0 * price0 / 10**IERC20Metadata(pool.token0()).decimals();
      // console.log('rebalance totalAmount0Estimate', totalAmount0Estimate);
      // console.log('rebalance totalAmount1Estimate', totalAmount1Estimate);

//      uint optimalAmount0 = totalAmount0Estimate / 2;
//      uint optimalAmount1 = totalAmount1Estimate / 2;
      if (totalAmount0Estimate / 2 < balance0) {
        // console.log('swap token0 amount', balance0 - optimalAmount0);
        _swapExactIn(pool.token0(), balance0 - totalAmount0Estimate / 2);
      } else {
         // console.log('swap token1 amount', balance1 - optimalAmount1);
        _swapExactIn(pool.token1(), balance1 - totalAmount1Estimate / 2);
      }

      _setNewTickRange();

      _addLiquidity(_balance(pool.token0()), _balance(pool.token1()));

      (uint pureAmount0New, uint pureAmount1new) = _getPureLiquidityBalances();
      uint totalAmount0 = pureAmount0New + _balance(pool.token0());
      uint totalAmount1 = pureAmount1new + _balance(pool.token1());

      if (_trackingToken == pool.token0()) {
        _rebalanceCost += totalAmount0Estimate - totalAmount0 - totalAmount1 * price1 / 10**IERC20Metadata(pool.token1()).decimals();
        _il += _lastAmount0 + _lastAmount1 * price1 / 10**IERC20Metadata(pool.token1()).decimals();
        _il -= (pureAmount0 + balance0Before) + (pureAmount1 + balance1Before) * price1 / 10**IERC20Metadata(pool.token1()).decimals();
      } else {
        _rebalanceCost += totalAmount1Estimate - totalAmount1 - totalAmount0 * price0 / 10**IERC20Metadata(pool.token0()).decimals();
        _il += _lastAmount1 + _lastAmount0 * price0 / 10**IERC20Metadata(pool.token0()).decimals();
        _il -= (pureAmount1 + balance1Before) + (pureAmount0 + balance0Before) * price0 / 10**IERC20Metadata(pool.token0()).decimals();
      }

      _lastAmount0 = totalAmount0;
      _lastAmount1 = totalAmount1;

      _rebalances++;
    } else {
      _setNewTickRange();
    }

    // console.log('rebalanceWithTracking: end');
  }

  function changeTickRange(int24 newTickRange_) external {
    require(owner == msg.sender, "Denied");
    require(newTickRange_ != 0, "Zero range");
    _tickRange = newTickRange_;
    // range will be changed at next rebalance
    _earned = 0;
    _rebalanceCost = 0;
    _il = 0;
    (_lastAmount0, _lastAmount1) = _getPureLiquidityBalances();
    _lastAmount0 += _balance(pool.token0());
    _lastAmount1 += _balance(pool.token1());
  }

  function changeRebalanceTickRange(int24 newRebalanceTickRange_) external {
    require(owner == msg.sender, "Denied");
    require(newRebalanceTickRange_ != 0, "Zero range");
    _rebalanceTickRange = newRebalanceTickRange_;
    // range will be changed at next rebalance
    _earned = 0;
    _rebalanceCost = 0;
    _il = 0;
    (_lastAmount0, _lastAmount1) = _getPureLiquidityBalances();
    _lastAmount0 += _balance(pool.token0());
    _lastAmount1 += _balance(pool.token1());
  }

  // ***************** UNISWAP V3 callbacks *****************

  function uniswapV3MintCallback(uint amount0Owed, uint amount1Owed, bytes calldata /*_data*/) external override {
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

  function _getFees() internal view returns (uint fee0, uint fee1) {
    (, int24 tick, , , , ,) = pool.slot0();
    (, uint feeGrowthInside0Last, uint feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(_getPositionID());
    fee0 = _computeFeesEarned(true, feeGrowthInside0Last, tick) + uint(tokensOwed0);
    fee1 = _computeFeesEarned(false, feeGrowthInside1Last, tick) + uint(tokensOwed1);
  }

  function _resetTracking() internal {
    if (liquidity != 0) {
      (_lastAmount0, _lastAmount1) = _getPureLiquidityBalances();
    } else {
      _lastAmount0 = 0;
      _lastAmount1 = 0;
    }
    _lastAmount0 += _balance(pool.token0());
    _lastAmount1 += _balance(pool.token1());
    _rebalances = 0;
    _trackingStart = block.timestamp;
  }

  function _getLiquidityBalances() internal view returns (uint amount0Current, uint amount1Current) {
    (uint160 sqrtRatioX96, int24 tick, , , , ,) = pool.slot0();
    (, uint feeGrowthInside0Last, uint feeGrowthInside1Last, uint128 tokensOwed0, uint128 tokensOwed1) = pool.positions(_getPositionID());

    // compute current holdings from liquidity
    (amount0Current, amount1Current) = LiquidityAmounts.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      liquidity
    );

    // compute current fees earned
    uint fee0 = _computeFeesEarned(true, feeGrowthInside0Last, tick) + uint(tokensOwed0);
    uint fee1 = _computeFeesEarned(false, feeGrowthInside1Last, tick) + uint(tokensOwed1);

    // add any leftover in contract to current holdings
    amount0Current += fee0;
    amount1Current += fee1;
  }

  function _getPureLiquidityBalances() internal view returns (uint amount0Current, uint amount1Current) {
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();
    (amount0Current, amount1Current) = LiquidityAmounts.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      liquidity
    );
  }

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
    lowerTick = (tick - _tickRange) / 10 * 10;
    upperTick = (tick + _tickRange) / 10 * 10;
  }

  function _getPositionID() internal view returns (bytes32 positionID) {
    return keccak256(abi.encodePacked(address(this), lowerTick, upperTick));
  }

  function _computeFeesEarned(bool isZero, uint feeGrowthInsideLast, int24 tick) internal view returns (uint fee) {
    uint feeGrowthOutsideLower;
    uint feeGrowthOutsideUpper;
    uint feeGrowthGlobal;
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
    uint feeGrowthBelow;
    if (tick >= lowerTick) {
      feeGrowthBelow = feeGrowthOutsideLower;
    } else {
      feeGrowthBelow = feeGrowthGlobal - feeGrowthOutsideLower;
    }

    // calculate fee growth above
    uint feeGrowthAbove;
    if (tick < upperTick) {
      feeGrowthAbove = feeGrowthOutsideUpper;
    } else {
      feeGrowthAbove = feeGrowthGlobal - feeGrowthOutsideUpper;
    }

    uint feeGrowthInside =
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

  function _feeString(uint24 fee_) internal pure returns (string memory) {
    if (fee_ == 500) {
      return "0.05%";
    }
    if (fee_ == 3000) {
      return "0.3%";
    }
    if (fee_ == 10000) {
      return "1%";
    }
    return _toString(uint(fee_));
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

  function _min(uint a, uint b) internal pure returns (uint) {
    return a < b ? a : b;
  }

  function _max(uint a, uint b) internal pure returns (uint) {
    return a > b ? a : b;
  }

  function _toString(uint value) internal pure returns (string memory) {
  unchecked {
    uint length = _log10(value) + 1;
    string memory buffer = new string(length);
    uint ptr;
    /// @solidity memory-safe-assembly
    assembly {
      ptr := add(buffer, add(32, length))
    }
    while (true) {
      ptr--;
      /// @solidity memory-safe-assembly
      assembly {
        mstore8(ptr, byte(mod(value, 10), _SYMBOLS))
      }
      value /= 10;
      if (value == 0) break;
    }
    return buffer;
  }
  }

  function _toString(int256 value) internal pure returns (string memory) {
    return string(abi.encodePacked(value < 0 ? "-" : "", _toString(_abs(value))));
  }

  function _abs(int256 n) internal pure returns (uint) {
  unchecked {
    // must be unchecked in order to support `n = type(int256).min`
    return uint(n >= 0 ? n : -n);
  }
  }

  function _log10(uint value) internal pure returns (uint) {
    uint result = 0;
  unchecked {
    if (value >= 10 ** 64) {
      value /= 10 ** 64;
      result += 64;
    }
    if (value >= 10 ** 32) {
      value /= 10 ** 32;
      result += 32;
    }
    if (value >= 10 ** 16) {
      value /= 10 ** 16;
      result += 16;
    }
    if (value >= 10 ** 8) {
      value /= 10 ** 8;
      result += 8;
    }
    if (value >= 10 ** 4) {
      value /= 10 ** 4;
      result += 4;
    }
    if (value >= 10 ** 2) {
      value /= 10 ** 2;
      result += 2;
    }
    if (value >= 10 ** 1) {
      result += 1;
    }
  }
    return result;
  }
}
