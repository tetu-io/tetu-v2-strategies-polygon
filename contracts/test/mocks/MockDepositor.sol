// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/DepositorBase.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/IMockToken.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
// import "hardhat/console.sol";

/// @title Mock contract for base Depositor.
contract MockDepositor is DepositorBase, Initializable {

  uint[] private _depositorReserves;
  uint[] private _depositorWeights;

  address[] private _depositorAssets;

  /// @notice total amount of active LP tokens.
  uint public totalSupply;
  uint private depositorLiquidity;

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  // @notice tokens must be MockTokens
  function __MockDepositor_init(
    address[] memory tokens_,
    uint[] memory depositorWeights_,
    uint[] memory depositorReserves_
  ) internal onlyInitializing {
    uint tokensLength = tokens_.length;
    for (uint i = 0; i < tokensLength; ++i) {
      _depositorAssets.push(tokens_[i]);
      _depositorWeights.push(depositorWeights_[i]);
      _depositorReserves.push(depositorReserves_[i]);
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorTotalSupply
  /////////////////////////////////////////////////////////////////////
  function setTotalSupply(uint totalSupply_) external {
    totalSupply = totalSupply_;
  }
  //// @notice Total amount of LP tokens in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    return totalSupply;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorLiquidity
  /////////////////////////////////////////////////////////////////////

  function _depositorLiquidity() override internal virtual view returns (uint) {
    return depositorLiquidity;
  }

  function setDepositorLiquidity(uint depositorLiquidity_) external {
    depositorLiquidity = depositorLiquidity_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Misc
  /////////////////////////////////////////////////////////////////////

  /// @dev Returns pool assets
  function _depositorPoolAssets() override internal virtual view returns (address[] memory) {
    //    console.log("_depositorPoolAssets");
    return _depositorAssets;
  }

  /// @dev Returns pool weights
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    //    console.log("_depositorPoolWeights", _depositorWeights.length);
    weights = _depositorWeights;
    uint len = weights.length;
    totalWeight = 0;
    for (uint i; i < len; i++) {
      totalWeight += weights[i];
    }
  }

  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    reserves = _depositorReserves;
  }

  function setDepositorPoolReserves(uint[] memory depositorReserves_) external {
    _depositorReserves = depositorReserves_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorEnter
  /////////////////////////////////////////////////////////////////////
  struct DepositorEnterParams {
    uint[] amountsDesired;
    uint[] amountsConsumed;
    uint liquidityOut;
  }

  DepositorEnterParams internal depositorEnterParams;

  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    require(_depositorAssets.length == amountsDesired_.length);

    uint len = amountsDesired_.length;
    amountsConsumed = depositorEnterParams.amountsConsumed;

    for (uint i = 0; i < len; ++i) {
      require(amountsDesired_[i] == depositorEnterParams.amountsDesired[i], "!depositorEnter");
      IMockToken token = IMockToken(_depositorAssets[i]);
      token.burn(address(this), depositorEnterParams.amountsConsumed[i]);
    }

    liquidityOut = depositorEnterParams.liquidityOut;
    depositorLiquidity += liquidityOut;
  }

  function setDepositorEnter(uint[] memory amountsDesired_, uint[] memory amountsConsumed_, uint liquidityOut_) external {
    depositorEnterParams.liquidityOut = liquidityOut_;
    depositorEnterParams.amountsDesired = amountsDesired_;
    depositorEnterParams.amountsConsumed = amountsConsumed_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorExit
  /////////////////////////////////////////////////////////////////////

  struct DepositorExitParams {
    uint liquidityAmount;
    uint[] amountsOut;
  }

  DepositorExitParams internal depositorExitParams;

  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    require(liquidityAmount == depositorExitParams.liquidityAmount, "!depositorExit");

    uint len = _depositorAssets.length;
    amountsOut = depositorExitParams.amountsOut;

    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(_depositorAssets[i]);
      token.mint(address(this), depositorExitParams.amountsOut[i]);
    }

    // we need to modify depositorLiquidity for tests with _updateInvestedAssets
    if (depositorLiquidity >= liquidityAmount) {
      depositorLiquidity -= liquidityAmount;
    }
  }

  function setDepositorExit(uint liquidityAmount_, uint[] memory amountsOut_) external {
    //    console.log("MockDepositor.setDepositorExit liquidityAmount", liquidityAmount_);
    depositorExitParams.liquidityAmount = liquidityAmount_;
    depositorExitParams.amountsOut = amountsOut_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorQuoteExit
  /////////////////////////////////////////////////////////////////////
  struct DepositorQuoteExitParams {
    uint liquidityAmount;
    uint[] amountsOut;
  }
  /// @notice keccak256(liquidityAmount + 1) => results
  mapping(bytes32 => DepositorQuoteExitParams) internal depositorQuoteExitParams;

  /// @dev Quotes output for given lp amount from the pool.
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual view returns (uint[] memory amountsOut) {
    bytes32 key = keccak256(abi.encodePacked(liquidityAmount + 1));
    DepositorQuoteExitParams memory p = depositorQuoteExitParams[key];
    if (p.liquidityAmount == liquidityAmount) {
      amountsOut = p.amountsOut;
    } else {
      //console.log("_depositorQuoteExit.missed liquidityAmount", liquidityAmount);
      revert("MockDepositor.!liquidityAmount");
    }

    return amountsOut;
  }

  function setDepositorQuoteExit(uint liquidityAmount_, uint[] memory amountsOut_) external {
    //    console.log("setDepositorQuoteExit, liquidityAmount_", liquidityAmount_);
    bytes32 key = keccak256(abi.encodePacked(liquidityAmount_ + 1));

    DepositorQuoteExitParams memory p = DepositorQuoteExitParams({
    liquidityAmount : liquidityAmount_,
    amountsOut : amountsOut_
    });

    depositorQuoteExitParams[key] = p;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorClaimRewards
  /////////////////////////////////////////////////////////////////////
  struct DepositorClaimRewardsParams {
    address[] rewardTokens;
    uint[] rewardAmounts;
  }

  DepositorClaimRewardsParams internal depositorClaimRewardsParams;

  function _depositorClaimRewards() override internal virtual returns (
    address[] memory rewardTokens,
    uint[] memory rewardAmounts,
    uint[] memory balancesBefore
  ) {
    uint len = depositorClaimRewardsParams.rewardTokens.length;
    rewardTokens = depositorClaimRewardsParams.rewardTokens;
    rewardAmounts = depositorClaimRewardsParams.rewardAmounts;

    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(depositorClaimRewardsParams.rewardTokens[i]);
      token.mint(address(this), depositorClaimRewardsParams.rewardAmounts[i]);
    }
    return (rewardTokens, rewardAmounts, balancesBefore);
  }

  function setDepositorClaimRewards(address[] memory rewardTokens_, uint[] memory rewardAmounts_) external {
    depositorClaimRewardsParams.rewardTokens = rewardTokens_;
    depositorClaimRewardsParams.rewardAmounts = rewardAmounts_;
  }
}
