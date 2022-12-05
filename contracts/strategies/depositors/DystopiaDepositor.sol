// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../../third_party/dystopia/IRouter.sol";
import "../../third_party/dystopia/IPair.sol";
import "../../third_party/dystopia/IVoter.sol";
import "../../third_party/dystopia/IGauge.sol";
import "../../tools/TokenAmountsLib.sol";
import "./DepositorBase.sol";

/// @title Dystopia Depositor for ConverterStrategies
/// @author bogdoslav
contract DystopiaDepositor is DepositorBase, Initializable {

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant DYSTOPIA_DEPOSITOR_VERSION = "1.0.0";

  address public depositorRouter;
  address public depositorGauge;
  address public depositorPair;
  address public depositorTokenA;
  address public depositorTokenB;
  bool public depositorStable;
  bool public depositorSwapTokens;

  // @notice tokens must be MockTokens
  function __DystopiaDepositor_init(
    address router, address tokenA, address tokenB, bool stable, address voter
  ) internal onlyInitializing {
    depositorRouter = router;
    depositorTokenA = tokenA;
    depositorTokenB = tokenB;
    depositorStable = stable;
    address _depositorPair = IRouter(router).pairFor(tokenA, tokenB, stable);
    depositorSwapTokens = tokenA == IPair(_depositorPair).token1();
    depositorPair = _depositorPair;
    depositorGauge = IVoter(voter).gauges(_depositorPair);
    require(depositorGauge != address(0), 'DD: No Gauge');
  }

  /// @dev Returns pool assets
  function _depositorPoolAssets() override public virtual view
  returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = depositorTokenA;
    poolAssets[1] = depositorTokenB;
  }

  /// @dev Returns pool weights in percents
  function _depositorPoolWeights() override public virtual view
  returns (uint[] memory weights) {
    weights = new uint[](2);
    if (depositorSwapTokens) {
      (weights[1], weights[0],) = IPair(depositorPair).getReserves();
    } else {
      (weights[0], weights[1],) = IPair(depositorPair).getReserves();
    }
  }

  /// @dev Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override public virtual view returns (uint) {
    return IERC20(depositorGauge).balanceOf(address(this));
  }

  /// @dev Deposit given amount to the pool.
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual
  returns (uint[] memory amountsConsumed, uint liquidity) {

    address tokenA = depositorTokenA;
    address tokenB = depositorTokenB;
    address router = depositorRouter;
    bool stable = depositorStable;
    uint amount0 = amountsDesired_[0];
    uint amount1 = amountsDesired_[1];

    _approveIfNeeded(tokenA, amount0, router);
    _approveIfNeeded(tokenB, amount1, router);

    amountsConsumed = new uint[](2);
    (amountsConsumed[0], amountsConsumed[1], liquidity) = IRouter(router).addLiquidity(
      tokenA,
      tokenB,
      stable,
      amount0,
      amount1,
      0,
      0,
      address(this),
      block.timestamp
    );

    // Stake to the Gauge
    _approveIfNeeded(depositorPair, type(uint).max / 2, depositorGauge);
    IGauge(depositorGauge).depositAll(0);

  }

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount > totalLiquidity) liquidityAmount = totalLiquidity;

    // Unstake from the gauge
    IGauge(depositorGauge).withdraw(liquidityAmount);

    // Remove liquidity
    address router = depositorRouter;

    _approveIfNeeded(depositorPair, liquidityAmount, router);

    amountsOut = new uint[](2);
    (amountsOut[0], amountsOut[1]) = IRouter(router).removeLiquidity(
      depositorTokenA,
      depositorTokenB,
      depositorStable,
      liquidityAmount,
      1,
      1,
      address(this),
      block.timestamp
    );

  }

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual
  returns (address[] memory tokens, uint[] memory amounts) {
    IGauge gauge = IGauge(depositorGauge);
    // gauge.claimFees(); // not sure, what it costly to call it

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
    console.log('rewards:');
    TokenAmountsLib.print(tokens, amounts);
    (tokens, amounts) = TokenAmountsLib.filterZeroAmounts(tokens, amounts);
    console.log('filtered:');
    TokenAmountsLib.print(tokens, amounts);

  }

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   */
  uint[32] private __gap;

}
