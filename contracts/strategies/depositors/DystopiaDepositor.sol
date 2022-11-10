// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "./DepositorBase.sol";
import "../../third_party/dystopia/IRouter.sol";
import "../../third_party/dystopia/IPair.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";

/// @title Dystopia Depositor for ConverterStrategies
/// @author bogdoslav
contract DystopiaDepositor is DepositorBase, Initializable {

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant DYSTOPIA_DEPOSITOR_VERSION = "1.0.0";

  address public depositorRouter;
  address public depositorPair;
  address public depositorTokenA;
  address public depositorTokenB;
  bool public depositorStable;

  // @notice tokens must be MockTokens
  function __DystopiaDepositor_init(
    address router, address tokenA, address tokenB, bool stable
  ) internal onlyInitializing {
    depositorRouter = router;
    depositorTokenA = tokenA;
    depositorTokenB = tokenB;
    depositorStable = stable;
    depositorPair = IRouter(router).pairFor(tokenA, tokenB, stable);
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
  returns (uint8[] memory weights) {
    weights = new uint8[](2);
    weights[0] = 50;
    weights[1] = 50;
  }

  /// @dev Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override public virtual view returns (uint) {
    return IERC20(depositorPair).balanceOf(address(this));
  }

  /// @dev Deposit given amount to the pool.
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual
  returns (uint[] memory amountsConsumed, uint liquidity) {
    uint amountA;
    uint amountB;
    (amountA, amountB, liquidity) = IRouter(depositorRouter).addLiquidity(
      depositorTokenA,
      depositorTokenB,
      depositorStable,
      amountsDesired_[0],
      amountsDesired_[1],
      0,
      0,
      address(this),
      block.timestamp
    );

    amountsConsumed = new uint[](2);
    amountsConsumed[0] = amountA;
    amountsConsumed[1] = amountB;
  }

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {

    uint totalLiquidity = _depositorLiquidity();
    if (liquidityAmount > totalLiquidity) liquidityAmount = totalLiquidity;

    (uint amountA, uint amountB) = IRouter(depositorRouter).removeLiquidity(
      depositorTokenA,
      depositorTokenB,
      depositorStable,
      liquidityAmount,
      1,
      1,
      address(this),
      block.timestamp
    );

    amountsOut = new uint[](2);
    amountsOut[0] = amountA;
    amountsOut[1] = amountB;
  }

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual
  returns (address[] memory rewardTokens, uint[] memory rewardAmounts) {
    // TODO
    rewardTokens = _depositorPoolAssets();
    (uint a, uint b) = IPair(depositorPair).claimFees();
    rewardAmounts = new uint[](2);
    rewardAmounts[0] = a;
    rewardAmounts[1] = b;
  }

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   */
  uint[32] private __gap;

}
