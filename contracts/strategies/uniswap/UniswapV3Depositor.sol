// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "../../integrations/uniswap/IUniswapV3Pool.sol";
import "../../integrations/uniswap/IUniswapV3MintCallback.sol";
import "../../tools/AppErrors.sol";
import "./UniswapV3ConverterStrategyLogic.sol";

//import "hardhat/console.sol";

abstract contract UniswapV3Depositor is IUniswapV3MintCallback, DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant UNISWAPV3_DEPOSITOR_VERSION = "1.0.0";

  IUniswapV3Pool public pool;
  int24 public tickSpacing;
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
  uint128 internal totalLiquidity;
  uint128 internal totalLiquidityFillup;

  uint internal rebalanceEarned0;
  uint internal rebalanceEarned1;

  function __UniswapV3Depositor_init(
    address asset_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) internal onlyInitializing {
    require(pool_ != address(0) && tickRange_ != 0 && rebalanceTickRange_ != 0, AppErrors.ZERO_ADDRESS);
    pool = IUniswapV3Pool(pool_);
    rebalanceTickRange = rebalanceTickRange_;
    (tickSpacing, lowerTick, upperTick, tokenA, tokenB, _depositorSwapTokens) = UniswapV3ConverterStrategyLogic.initDepositor(pool, tickRange_, asset_);
  }

  function _setNewTickRange() internal {
    (, int24 tick, , , , ,) = pool.slot0();
    int24 halfRange = (upperTick - lowerTick) / 2;
    lowerTick = (tick - halfRange) / tickSpacing * tickSpacing;
    upperTick = (tick + halfRange) / tickSpacing * tickSpacing;
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
    (amountsConsumed, liquidityOut, totalLiquidity) = UniswapV3ConverterStrategyLogic.enter(pool, lowerTick, upperTick, amountsDesired_, totalLiquidity, _depositorSwapTokens);
  }

  function _addFillup() internal {
    (lowerTickFillup, upperTickFillup, totalLiquidityFillup) = UniswapV3ConverterStrategyLogic.addFillup(pool, lowerTick, upperTick, tickSpacing);
  }

  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    (amountsOut, totalLiquidity, totalLiquidityFillup) = UniswapV3ConverterStrategyLogic.exit(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup, uint128(liquidityAmount), _depositorSwapTokens);
  }

  function _depositorQuoteExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = UniswapV3ConverterStrategyLogic.quoteExit(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup, uint128(liquidityAmount), _depositorSwapTokens);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    amountsOut = UniswapV3ConverterStrategyLogic.claimRewards(pool, lowerTick, upperTick, rebalanceEarned0, rebalanceEarned1, _depositorSwapTokens);
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
    return UniswapV3ConverterStrategyLogic.needRebalance(pool, lowerTick, upperTick, rebalanceTickRange);
  }

  function getFees() public view returns (uint fee0, uint fee1) {
    return UniswapV3ConverterStrategyLogic.getFees(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup);
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
    return UniswapV3ConverterStrategyLogic.getPoolReserves(pool, lowerTick, upperTick, lowerTickFillup, upperTickFillup, totalLiquidity, totalLiquidityFillup, _depositorSwapTokens);
  }

  function _depositorLiquidity() override internal virtual view returns (uint) {
    return uint(totalLiquidity);
  }

  function _depositorTotalSupply() override internal view virtual returns (uint) {
    return uint(totalLiquidity);
  }
}