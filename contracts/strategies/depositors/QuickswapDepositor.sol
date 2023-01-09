// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../../tools/TokenAmountsLib.sol";
import "../../third_party/Uniswap/IUniswapV2Pair.sol";
import "../../third_party/Uniswap/IUniswapV2Factory.sol";
import "./DepositorBase.sol";

import "hardhat/console.sol";
import "../../third_party/Uniswap/IUniswapV2Router02.sol";

/// @title Quickswap Depositor for ConverterStrategies
contract QuickswapDepositor is DepositorBase, Initializable {

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant QUICKSWAP_DEPOSITOR_VERSION = "1.0.0";

  /////////////////////////////////////////////////////////////////////
  ///                   Variables
  /////////////////////////////////////////////////////////////////////
  IUniswapV2Pair public depositorPair;
  IUniswapV2Router02 public router;
  address public tokenA;
  address public tokenB;
  /// @notice false: _depositorTokenA == depositorPair.token0
  ///         true:  _depositorTokenA == depositorPair.token1
  bool private _depositorSwapTokens;
  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __QuickswapDepositor_init(
    address router_,
    address factory_,
    address tokenA_,
    address tokenB_,
    address voter
  ) internal onlyInitializing {
    router = IUniswapV2Router02(router_);
    tokenA = tokenA_;
    tokenB = tokenB_;

    IUniswapV2Factory factory = IUniswapV2Factory(factory_);
    address pair = factory.getPair(tokenA_, tokenB_);
    require(pair != address(0), "TODO");
    depositorPair = pair;

    _depositorSwapTokens = tokenA == IUniswapV2Pair(pair_).token1();
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = tokenA;
    poolAssets[1] = tokenB;
  }

  /// @notice Returns pool weights in percents (50/50%)
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](2);
    weights[0] = 1; // 50%
    weights[1] = 1; // 50%
    totalWeight = 2; // 100%
  }

  /// @notice Returns pool weights in percents
  /// @return reserves Reserves for: _depositorTokenA, _depositorTokenB
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    IUniswapV2Pair _depositorPair = depositorPair; // gas saving

    reserves = new uint[](2);
    if (_depositorSwapTokens) {
      (reserves[1], reserves[0],) = _depositorPair.getReserves();
    } else {
      (reserves[0], reserves[1],) = _depositorPair.getReserves();
    }
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint) {
    return depositorPair.balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    return depositorPair.totalSupply();
  }


  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of token A and B on the balance of the depositor
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidity
  ) {
    uint amount0 = amountsDesired_[0];
    uint amount1 = amountsDesired_[1];

    console.log('/// !!! DEPOSITOR deposit amount0', amount0);
    console.log('/// !!! DEPOSITOR deposit amount1', amount1);

    amountsConsumed = new uint[](2);

    if (amount0 == 0 || amount1 == 0) {
      return (amountsConsumed, 0);
    }

    address _tokenA = tokenA; // gas saving
    address _tokenB = tokenB; // gas saving
    address _router = router; // gas saving

    _approveIfNeeded(_tokenA, amount0, _router);
    _approveIfNeeded(_tokenB, amount1, _router);

    (amountsConsumed[0], amountsConsumed[1], liquidity) = IRouter(_router).addLiquidity(
      _tokenA,
      _tokenB,
      amount0,
      amount1,
      0, // todo
      0, // todo
      address(this),
      block.timestamp
    );

    // Stake to the Gauge
    _approveIfNeeded(depositorPair, type(uint).max / 2, _depositorGauge); // TODO: make infinite approve in init
    IGauge(_depositorGauge).depositAll(0);

  }

  /// @notice Withdraw given lp amount from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    if (liquidityAmount == 0) {
      return amountsOut;
    }

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount > totalLiquidity) {
      liquidityAmount = totalLiquidity;
    }

    // Unstake from the gauge
    IGauge(_depositorGauge).withdraw(liquidityAmount);

    // Remove liquidity
    address router = router;

    _approveIfNeeded(depositorPair, liquidityAmount, router);

    (amountsOut[0], amountsOut[1]) = IRouter(router).removeLiquidity(
      tokenA,
      tokenB,
      depositorStable,
      liquidityAmount,
      1,
      1,
      address(this),
      block.timestamp
    );

    console.log('/// !!! DEPOSITOR withdraw amountsOut[0]', amountsOut[0]);
    console.log('/// !!! DEPOSITOR withdraw amountsOut[1]', amountsOut[1]);
  }

  /// @notice Quotes output for given lp amount from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual view returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    if (liquidityAmount == 0) {
      return amountsOut;
    }

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount > totalLiquidity) {
      liquidityAmount = totalLiquidity;
    }

    (amountsOut[0], amountsOut[1]) = IRouter(router).quoteRemoveLiquidity(
      tokenA,
      tokenB,
      depositorStable,
      liquidityAmount
    );
  }


  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (address[] memory tokens, uint[] memory amounts) {
    IGauge gauge = IGauge(_depositorGauge);
    gauge.claimFees(); // sends fees to bribe

    uint len = gauge.rewardTokensLength();
    amounts = new uint[](len);
    tokens = new address[](len);

    for (uint i = 0; i < len; i++) {
      address token = gauge.rewardTokens(i);
      tokens[i] = token;
      // temporary store current token balance
      amounts[i] = IERC20(token).balanceOf(address(this));
    }

    gauge.getReward(address(this), tokens);

    for (uint i = 0; i < len; i++) {
      amounts[i] = IERC20(tokens[i]).balanceOf(address(this)) - amounts[i];
    }
    (tokens, amounts) = TokenAmountsLib.filterZeroAmounts(tokens, amounts);

  }




  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   */
  uint[16] private __gap;

}
