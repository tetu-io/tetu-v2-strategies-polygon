// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../DepositorBase.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../integrations/uniswap/TickMath.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../../tools/AppErrors.sol";
import "./UniswapV3Library.sol";

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
  int24 public lowerTickFillup;
  int24 public upperTickFillup;
  int24 public rebalanceTickRange;

  // asset - collateral token
  address public tokenA;

  // borrowing (hedging) token
  address public tokenB;

  /// @notice false: tokenA == pool.token0
  ///         true:  tokenB == pool.token1
  bool internal _depositorSwapTokens;

  /// @dev Total fractional shares of Uniswap V3 position
  uint128 public totalLiquidity;
  uint128 public totalLiquidityFillup;

  uint public rebalanceEarned0;
  uint public rebalanceEarned1;

  function __UniswapV3Depositor_init(
    address asset_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) internal onlyInitializing {
    require(pool_ != address(0) && tickRange_ != 0 && rebalanceTickRange_ != 0, AppErrors.ZERO_ADDRESS);
    pool = IUniswapV3Pool(pool_);
    rebalanceTickRange = rebalanceTickRange_;
    (, int24 tick, , , , ,) = pool.slot0();
    lowerTick = (tick - tickRange_) / 10 * 10;
    upperTick = (tick + tickRange_) / 10 * 10;
    if (asset_ == pool.token0()) {
      tokenA = pool.token0();
      tokenB = pool.token1();
      _depositorSwapTokens = false;
    } else {
      tokenA = pool.token1();
      tokenB = pool.token0();
      _depositorSwapTokens = true;
    }
    console.log('__UniswapV3Depositor_init _depositorSwapTokens', _depositorSwapTokens);
  }

  function _setNewTickRange() internal {
    (, int24 tick, , , , ,) = pool.slot0();
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
    // console.log('uniswapV3MintCallback amount0Owed', amount0Owed);
    // console.log('uniswapV3MintCallback amount1Owed', amount1Owed);
    if (amount0Owed > 0) IERC20(_depositorSwapTokens ? tokenB : tokenA).safeTransfer(msg.sender, amount0Owed);
    if (amount1Owed > 0) IERC20(_depositorSwapTokens ? tokenA : tokenB).safeTransfer(msg.sender, amount1Owed);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    // console.log('_depositorEnter amountsDesired_[0]', amountsDesired_[0]);
    // console.log('_depositorEnter amountsDesired_[1]', amountsDesired_[1]);

    if (_depositorSwapTokens) {
      (amountsDesired_[0], amountsDesired_[1]) = (amountsDesired_[1], amountsDesired_[0]);
    }

    amountsConsumed = new uint[](2);

    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();
    uint128 newLiquidity = UniswapV3Library.getLiquidityForAmounts(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      amountsDesired_[0],
      amountsDesired_[1]
    );
    liquidityOut = uint(newLiquidity);
    (amountsConsumed[0], amountsConsumed[1]) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      newLiquidity
    );

//    console.log('_depositorEnter pool.mint before');
    pool.mint(address(this), lowerTick, upperTick, uint128(liquidityOut), "");
//    console.log('_depositorEnter pool.mint after');
    totalLiquidity += uint128(liquidityOut);

    if (_depositorSwapTokens) {
      (amountsConsumed[0], amountsConsumed[1]) = (amountsConsumed[1], amountsConsumed[0]);
    }

    // console.log('_depositorEnter amountsConsumed[0]', amountsConsumed[0]);
    // console.log('_depositorEnter amountsConsumed[1]', amountsConsumed[1]);
    // console.log('_depositorEnter liquidityOut', liquidityOut);
  }

  function _addFillup() internal {
    (, int24 tick, , , , ,) = pool.slot0();
    if (_balance(pool.token0()) > _balance(pool.token1()) * UniswapV3Library.getPrice(pool, pool.token1()) / 10**IERC20Metadata(pool.token1()).decimals()) {
      // add token0 to half range
      lowerTickFillup = tick / 10 * 10 + 10;
      upperTickFillup = upperTick;
      _addLiquidityFillup(_balance(pool.token0()), 0);
    } else {
      lowerTickFillup = lowerTick;
      upperTickFillup = tick / 10 * 10 - 10;
      _addLiquidityFillup(0, _balance(pool.token1()));
    }
  }

  function _addLiquidityFillup(uint amount0Desired_, uint amount1Desired_) internal returns (uint amount0Consumed, uint amount1Consumed, uint128 liquidityOut) {
    require(amount0Desired_ != 0 || amount1Desired_ != 0, "_addLiquidityFillup: Zero amount");
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();
    liquidityOut = UniswapV3Library.getLiquidityForAmounts(
      sqrtRatioX96,
      lowerTickFillup.getSqrtRatioAtTick(),
      upperTickFillup.getSqrtRatioAtTick(),
      amount0Desired_,
      amount1Desired_
    );
    (amount0Consumed, amount1Consumed) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTickFillup.getSqrtRatioAtTick(),
      upperTickFillup.getSqrtRatioAtTick(),
      liquidityOut
    );
    pool.mint(address(this), lowerTickFillup, upperTickFillup, liquidityOut, "");
    totalLiquidityFillup += liquidityOut;
  }

  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = pool.burn(lowerTick, upperTick, uint128(liquidityAmount));
    pool.collect(
      address(this),
      lowerTick,
      upperTick,
      type(uint128).max,
      type(uint128).max
    );

    // remove proportional part of fillup liquidity
    if (totalLiquidityFillup != 0) {
      uint128 toRemovefillUpAmount = totalLiquidityFillup * uint128(liquidityAmount) / totalLiquidity;
      (uint amountsOutFillup0, uint amountsOutFillup1) = pool.burn(lowerTickFillup, upperTickFillup, toRemovefillUpAmount);
      pool.collect(
        address(this),
        lowerTickFillup,
        upperTickFillup,
        type(uint128).max,
        type(uint128).max
      );
      amountsOut[0] += amountsOutFillup0;
      amountsOut[1] += amountsOutFillup1;

      totalLiquidityFillup -= toRemovefillUpAmount;
    }

    totalLiquidity -= uint128(liquidityAmount);

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }
  }

  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    // console.log('_depositorQuoteExit liquidityAmount', liquidityAmount);
    amountsOut = new uint[](2);

    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();

    (amountsOut[0], amountsOut[1]) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      uint128(liquidityAmount)
    );

    (uint amountOut0Fillup, uint amountOut1Fillup) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTickFillup.getSqrtRatioAtTick(),
      upperTickFillup.getSqrtRatioAtTick(),
      totalLiquidityFillup * uint128(liquidityAmount) / totalLiquidity
    );
    amountsOut[0] += amountOut0Fillup;
    amountsOut[1] += amountOut1Fillup;

    (uint fee0, uint fee1) = getFees();
    amountsOut[0] += fee0;
    amountsOut[1] += fee1;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }

    // console.log('_depositorQuoteExit amountsOut[0]', amountsOut[0]);
    // console.log('_depositorQuoteExit amountsOut[1]', amountsOut[1]);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    (uint fee0, uint fee1) = getFees();

    console.log('_depositorClaimRewards fee0', fee0);
    console.log('_depositorClaimRewards fee1', fee1);

    amountsOut = new uint[](2);

    if (fee0 > 0 || fee1 > 0) {
      pool.burn(lowerTick, upperTick, 0);
      (amountsOut[0], amountsOut[1]) = pool.collect(
        address(this),
        lowerTick,
        upperTick,
        type(uint128).max,
        type(uint128).max
      );
    }

    amountsOut[0] += rebalanceEarned0;
    amountsOut[1] += rebalanceEarned1;
    rebalanceEarned0 = 0;
    rebalanceEarned1 = 0;

    if (_depositorSwapTokens) {
      (amountsOut[0], amountsOut[1]) = (amountsOut[1], amountsOut[0]);
    }

    tokensOut = new address[](2);
    tokensOut[0] = tokenA;
    tokensOut[1] = tokenB;
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  function needRebalance() public view returns (bool) {
    (, int24 tick, , , , ,) = pool.slot0();
    int24 halfRange = (upperTick - lowerTick) / 2;
    int24 oldMedianTick = lowerTick + halfRange;
    if (tick > oldMedianTick) {
      return tick - oldMedianTick > rebalanceTickRange;
    }
    return oldMedianTick - tick > rebalanceTickRange;
  }

  function getFees() public view returns (uint fee0, uint fee1) {
    UniswapV3Library.PoolPosition memory position = UniswapV3Library.PoolPosition(address(pool), lowerTick, upperTick, totalLiquidity, address(this));
    (fee0, fee1) = UniswapV3Library.getFees(position);
    UniswapV3Library.PoolPosition memory positionFillup = UniswapV3Library.PoolPosition(address(pool), lowerTickFillup, upperTickFillup, totalLiquidityFillup, address(this));
    (uint fee0Fillup, uint fee1Fillup) = UniswapV3Library.getFees(positionFillup);
    fee0 += fee0Fillup;
    fee1 += fee1Fillup;
  }

  /// @notice Returns pool assets
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = tokenA;
    poolAssets[1] = tokenB;
  }

  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](2);
    weights[0] = 1;
    weights[1] = 1;
    totalWeight = 2;
  }

  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    reserves = new uint[](2);
    (reserves[0], reserves[1]) = getUnderlyingBalances();
    if (_depositorSwapTokens) {
      (reserves[0], reserves[1]) = (reserves[1], reserves[0]);
    }
  }

  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(totalLiquidity);
  }

  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(totalLiquidity);
  }

  function getUnderlyingBalances() public view returns (uint256 amount0Current, uint256 amount1Current) {
    (uint160 sqrtRatioX96, , , , , ,) = pool.slot0();
    return _getUnderlyingBalances(sqrtRatioX96);
  }

  function getPrice(address tokenIn) external view returns (uint) {
    return UniswapV3Library.getPrice(pool, tokenIn);
  }

  function _getUnderlyingBalances(uint160 sqrtRatioX96) internal view returns (uint256 amount0Current, uint256 amount1Current) {
    // compute current holdings from liquidity
    (amount0Current, amount1Current) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTick.getSqrtRatioAtTick(),
      upperTick.getSqrtRatioAtTick(),
      totalLiquidity
    );

    (uint amount0CurrentFillup, uint amount1CurrentFillup) = UniswapV3Library.getAmountsForLiquidity(
      sqrtRatioX96,
      lowerTickFillup.getSqrtRatioAtTick(),
      upperTickFillup.getSqrtRatioAtTick(),
      totalLiquidityFillup
    );

    (uint fee0, uint fee1) = getFees();

    // add any leftover in contract to current holdings
    amount0Current += amount0CurrentFillup + fee0 + _balance(_depositorSwapTokens ? tokenB : tokenA);
    amount1Current += amount1CurrentFillup + fee1 + _balance(_depositorSwapTokens ? tokenA : tokenB);
  }

  function _getPositionID() internal view returns (bytes32 positionID) {
    return keccak256(abi.encodePacked(address(this), lowerTick, upperTick));
  }

  function _getPositionIDFillup() internal view returns (bytes32 positionID) {
    return keccak256(abi.encodePacked(address(this), lowerTickFillup, upperTickFillup));
  }
}