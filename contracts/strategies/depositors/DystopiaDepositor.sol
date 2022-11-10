// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "./DepositorBase.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";

/// @title Dystopia Depositor for ConverterStrategies
/// @author bogdoslav
contract DystopiaDepositor is DepositorBase, Initializable {

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant DYSTOPIA_DEPOSITOR_VERSION = "1.0.0";

  address public router;
  address public tokenA;
  address public tokenB;

  // @notice tokens must be MockTokens
  function __DystopiaDepositor_init(address router_, address tokenA_, address tokenB_
  ) internal onlyInitializing {
    router = router_;
    tokenA = tokenA_;
    tokenB = tokenB_;
  }

  /// @dev Returns pool assets
  function _depositorPoolAssets() override public virtual view
  returns (address[] memory) {
    // TODO
  }

  /// @dev Returns pool weights in percents
  function _depositorPoolWeights() override public virtual view
  returns (uint8[] memory) {
    // TODO
  }

  /// @dev Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override public virtual view returns (uint) {
    // TODO
  }

  /// @dev Deposit given amount to the pool.
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual
  returns (uint[] memory amountsConsumed, uint liquidityOut) {
    // TODO
  }

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    // TODO
  }

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual
  returns (address[] memory rewardTokens, uint[] memory rewardAmounts) {
    // TODO
    return (_depositorRewardTokens, _depositorRewardAmounts);
  }

}
