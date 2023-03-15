// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../../tools/AppErrors.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";

abstract contract UniswapV3Depositor is IUniswapV3MintCallback, DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant UNISWAPV3_DEPOSITOR_VERSION = "1.0.0";

  IUniswapV3Pool public pool;
  int24 internal tickSpacing;
  int24 public lowerTick;
  int24 public upperTick;
  int24 internal lowerTickFillup;
  int24 internal upperTickFillup;
  int24 public rebalanceTickRange;

  // asset - collateral token
  address public tokenA;

  // borrowing (hedging) token
  address public tokenB;

  /// @notice false: tokenA == pool.token0
  ///         true:  tokenB == pool.token1
  bool internal _depositorSwapTokens;

  uint128 internal totalLiquidity;
  uint128 internal totalLiquidityFillup;

  uint internal rebalanceEarned0;
  uint internal rebalanceEarned1;
  uint internal rebalanceLost;

  function __UniswapV3Depositor_init(
    address asset_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) internal onlyInitializing {
    require(pool_ != address(0), AppErrors.ZERO_ADDRESS);
    pool = IUniswapV3Pool(pool_);
    rebalanceTickRange = rebalanceTickRange_;
    (tickSpacing, lowerTick, upperTick, tokenA, tokenB, _depositorSwapTokens) = UniswapV3ConverterStrategyLogicLib.initDepositor(pool, tickRange_, rebalanceTickRange_, asset_);
  }

  function _setNewTickRange() internal {
    (lowerTick, upperTick) = UniswapV3ConverterStrategyLogicLib.setNewTickRange(pool, lowerTick, upperTick, tickSpacing);
  }

  /// @notice Uniswap V3 callback fn, called back on pool.mint
  function uniswapV3MintCallback(
    uint amount0Owed,
    uint amount1Owed,
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
    (amountsConsumed, liquidityOut, totalLiquidity) = UniswapV3ConverterStrategyLogicLib.enter(pool, lowerTick, upperTick, amountsDesired_, totalLiquidity, _depositorSwapTokens);
  }

  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    (uint fee0, uint fee1) = getFees();
    rebalanceEarned0 += fee0;
    rebalanceEarned1 += fee1;
    (amountsOut, totalLiquidity, totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.exit(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup, uint128(liquidityAmount), _depositorSwapTokens);
  }

  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = UniswapV3ConverterStrategyLogicLib.quoteExit(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup, uint128(liquidityAmount), _depositorSwapTokens);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    amountsOut = UniswapV3ConverterStrategyLogicLib.claimRewards(pool, lowerTick, upperTick, rebalanceEarned0, rebalanceEarned1, _depositorSwapTokens);
    rebalanceEarned0 = 0;
    rebalanceEarned1 = 0;
    tokensOut = new address[](2);
    tokensOut[0] = tokenA;
    tokensOut[1] = tokenB;
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  function needRebalance() public view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.needRebalance(pool, lowerTick, upperTick, rebalanceTickRange, tickSpacing);
  }

  function getFees() internal view returns (uint fee0, uint fee1) {
    return UniswapV3ConverterStrategyLogicLib.getFees(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup);
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
    return UniswapV3ConverterStrategyLogicLib.getPoolReserves(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup, _depositorSwapTokens);
  }

  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(totalLiquidity);
  }

  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(totalLiquidity);
  }
}