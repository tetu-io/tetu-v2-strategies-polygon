// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "../../tools/TokenAmountsLib.sol";
import "../../tools/AppErrors.sol";
import "../../tools/Uniswap2Lib.sol";
import "../../tools/AppLib.sol";
import "../../integrations/uniswap/IUniswapV2Pair.sol";
import "../../integrations/uniswap/IUniswapV2Factory.sol";
import "../../integrations/uniswap/IUniswapV2Router02.sol";
import "../../integrations/quickswap/IStakingBase.sol";

import "hardhat/console.sol";

/// @title Quickswap Depositor for ConverterStrategies
/// @notice Put two amounts to the pool, get LP tokens in exchange,
///         stake the LP tokens in the reward pool, claim the rewards by request
/// @dev The contract is abstract because it can be used with two different rewards pool -
///      both with IStakingRewards and IStakingDualRewards, but the strategy should implement few functions
///      that depend on the variant of reward pool.
abstract contract QuickswapDepositor is DepositorBase, Initializable {
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

  /// @notice IStakingRewards or IStakingDualRewards depending on implementation
  address internal _rewardsPool;
  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __QuickswapDepositor_init(
    address router_,
    address tokenA_,
    address tokenB_,
    address rewardsPool_
  ) internal onlyInitializing {
    require(
      router_ != address(0)
      && rewardsPool_ != address(0)
      && tokenA_ != address(0)
      && tokenB_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    router = IUniswapV2Router02(router_);
    tokenA = tokenA_;
    tokenB = tokenB_;

    IUniswapV2Factory factory = IUniswapV2Factory(IUniswapV2Router02(router_).factory());
    address pair = factory.getPair(tokenA_, tokenB_);
    require(pair != address(0), AppErrors.UNISWAP_PAIR_NOT_FOUND);
    depositorPair = IUniswapV2Pair(pair);

    _depositorSwapTokens = tokenA == IUniswapV2Pair(pair).token1();

    _rewardsPool = rewardsPool_;

    // infinity approve,  2**255 is more gas-efficient than type(uint).max
    IERC20(address(depositorPair)).approve(_rewardsPool, 2**255);
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
    console.log("_depositorLiquidity", IStakingBase(_rewardsPool).balanceOf(address(this)));
    // All LP tokens were staked into the rewards pool
    return IStakingBase(_rewardsPool).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    console.log("_depositorTotalSupply", depositorPair.totalSupply());
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

    AppLib.approveIfNeeded(_tokenA, amount0, address(_router));
    AppLib.approveIfNeeded(_tokenB, amount1, address(_router));

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
    console.log("_depositorEnter.amountsConsumedOut[0]", amountsConsumedOut[0]);
    console.log("_depositorEnter.amountsConsumedOut[1]", amountsConsumedOut[1]);
    console.log("_depositorEnter.liquidityOut", liquidityOut);
    console.log("_depositorEnter.depositorPair balance", IERC20(address(depositorPair)).balanceOf(address(this)));

    // stake the liquidity to the rewards pool
    // infinity approve was made in initialization
    IStakingBase(_rewardsPool).stake(liquidityOut);
    console.log("_depositorEnter.depositorPair balance after staking", IERC20(address(depositorPair)).balanceOf(address(this)));
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    console.log("_depositorExit.liquidityAmount_", liquidityAmount_);
    amountsOut = new uint[](2);
    if (liquidityAmount_ == 0) {
      return amountsOut;
    }

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount_ > totalLiquidity) {
      liquidityAmount_ = totalLiquidity;
    }
    console.log("_depositorExit.liquidityAmount_ updated", liquidityAmount_);

    // unstake the liquidity from the rewards pool
    console.log("_depositorEnter.depositorPair balance before unstaking", IERC20(address(depositorPair)).balanceOf(address(this)));
    IStakingBase(_rewardsPool).withdraw(liquidityAmount_);
    console.log("_depositorEnter.depositorPair balance after unstaking", IERC20(address(depositorPair)).balanceOf(address(this)));

    // Remove liquidity
    IUniswapV2Router02 _router = router; // gas saving

    AppLib.approveIfNeeded(address(depositorPair), liquidityAmount_, address(_router));
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
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    console.log("_depositorQuoteExit", liquidityAmount_);
    amountsOut = new uint[](2);
    if (liquidityAmount_ == 0) {
      return amountsOut;
    }

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount_ > totalLiquidity) {
      liquidityAmount_ = totalLiquidity;
    }

    (amountsOut[0], amountsOut[1]) = Uniswap2Lib.quoteRemoveLiquidity(
      router,
      address(this),
      tokenA,
      tokenB,
      liquidityAmount_
    );
  }

  /////////////////////////////////////////////////////////////////////
  ////   Abstract functions
  ///    The implementation depends on the rewards pool kind:
  ///    IStakingRewards and IStakingDualRewards have different implementations.
  /////////////////////////////////////////////////////////////////////

  /// @notice List of rewards tokens
  function _getRewardTokens(address rewardsPool_) internal virtual view returns (address[] memory rewardTokensOut);

  /// @notice True if any reward token can be claimed with not zero amount for the given address
  function _hasAnyRewards(address rewardsPool_, address user_) internal virtual view returns (bool);

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    IStakingBase __rewardsPool = IStakingBase(_rewardsPool); // gas saving

    if (_hasAnyRewards(address(__rewardsPool), address(this))) {
      tokensOut = _getRewardTokens(address(__rewardsPool));
      uint len = tokensOut.length;
      amountsOut = new uint[](len);

      // temporary save exist balances of reward-tokens to amountsOut
      for (uint i; i < len; ++i) {
        amountsOut[i] = IERC20(tokensOut[i]).balanceOf(address(this));
      }

      __rewardsPool.getReward();

      // get amounts of the claimed rewards
      for (uint i; i < len; ++i) {
        amountsOut[i] = IERC20(tokensOut[i]).balanceOf(address(this)) - amountsOut[i];
      }
    }

    (tokensOut, amountsOut) = TokenAmountsLib.filterZeroAmounts(tokensOut, amountsOut);
  }


  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   */
  uint[16] private __gap;

}
