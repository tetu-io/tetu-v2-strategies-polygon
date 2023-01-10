// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "./DepositorBase.sol";
import "../tools/TokenAmountsLib.sol";
import "../tools/AppErrors.sol";
import "../integrations/uniswap/IUniswapV2Pair.sol";
import "../integrations/uniswap/IUniswapV2Factory.sol";
import "../integrations/uniswap/IUniswapV2Router02.sol";

import "hardhat/console.sol";

/// @title Quickswap Depositor for ConverterStrategies
contract QuickswapDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

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

  address internal _depositorGauge;
  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __QuickswapDepositor_init(
    address router_,
    address tokenA_,
    address tokenB_
  ) internal onlyInitializing {
    router = IUniswapV2Router02(router_);
    tokenA = tokenA_;
    tokenB = tokenB_;

    IUniswapV2Factory factory = IUniswapV2Factory(IUniswapV2Router02(router_).factory());
    address pair = factory.getPair(tokenA_, tokenB_);
    require(pair != address(0), AppErrors.UNISWAP_PAIR_NOT_FOUND);
    depositorPair = IUniswapV2Pair(pair);

    _depositorSwapTokens = tokenA == IUniswapV2Pair(pair).token1();
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
  /// @return amountsConsumedOut Amounts of token A and B deposited to the internal pool
  /// @return liquidityOut Total amount of liquidity added to the internal pool
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    uint amount0 = amountsDesired_[0];
    uint amount1 = amountsDesired_[1];

    console.log('/// !!! DEPOSITOR deposit amount0', amount0);
    console.log('/// !!! DEPOSITOR deposit amount1', amount1);

    amountsConsumedOut = new uint[](2);

    if (amount0 == 0 || amount1 == 0) {
      return (amountsConsumedOut, 0);
    }

    address _tokenA = tokenA; // gas saving
    address _tokenB = tokenB; // gas saving
    IUniswapV2Router02 _router = router; // gas saving

    _approveIfNeeded(_tokenA, amount0, address(_router));
    _approveIfNeeded(_tokenB, amount1, address(_router));

    (amountsConsumedOut[0], amountsConsumedOut[1], liquidityOut) = _router.addLiquidity(
      _tokenA,
      _tokenB,
      amount0,
      amount1,
      0, // todo
      0, // todo
      address(this),
      block.timestamp
    );
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    if (liquidityAmount_ == 0) {
      return amountsOut;
    }

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount_ > totalLiquidity) {
      liquidityAmount_ = totalLiquidity;
    }

    // Remove liquidity
    IUniswapV2Router02 _router = router; // gas saving

    _approveIfNeeded(address(depositorPair), liquidityAmount_, address(_router));
    (amountsOut[0], amountsOut[1]) = _router.removeLiquidity(
      tokenA,
      tokenB,
      liquidityAmount_,
      1, // todo
      1, // todo
      address(this),
      block.timestamp
    );

    console.log('/// !!! DEPOSITOR withdraw amountsOut[0]', amountsOut[0]);
    console.log('/// !!! DEPOSITOR withdraw amountsOut[1]', amountsOut[1]);
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual view returns (uint[] memory amountsOut) {
    amountsOut = new uint[](2);
    if (liquidityAmount_ == 0) {
      return amountsOut;
    }

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount_ > totalLiquidity) {
      liquidityAmount_ = totalLiquidity;
    }

    // todo (amountsOut[0], amountsOut[1]) = router.quoteTODO(liquidityAmount_, tokenA, tokenB);
  }


  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (address[] memory tokens, uint[] memory amounts) {
//    IGauge gauge = IGauge(_depositorGauge);
//    gauge.claimFees(); // sends fees to bribe
//
//    uint len = gauge.rewardTokensLength();
//    amounts = new uint[](len);
//    tokens = new address[](len);
//
//    for (uint i = 0; i < len; i++) {
//      address token = gauge.rewardTokens(i);
//      tokens[i] = token;
//      // temporary store current token balance
//      amounts[i] = IERC20(token).balanceOf(address(this));
//    }
//
//    gauge.getReward(address(this), tokens);
//
//    for (uint i = 0; i < len; i++) {
//      amounts[i] = IERC20(tokens[i]).balanceOf(address(this)) - amounts[i];
//    }
//    (tokens, amounts) = TokenAmountsLib.filterZeroAmounts(tokens, amounts);

  }




  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   */
  uint[16] private __gap;

}