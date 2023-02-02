// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../strategies/DepositorBase.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/IMockToken.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "hardhat/console.sol";

/// @title Mock contract for base Depositor.
contract MockDepositor is DepositorBase, Initializable {

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant DEPOSITOR_MOCK_VERSION = "1.0.0";

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
    require(tokens_.length == depositorReserves_.length, "depositorReserves_.length");
    require(tokens_.length == depositorWeights_.length, "depositorWeights_.length");

    uint tokensLength = tokens_.length;
    for (uint i = 0; i < tokensLength; ++i) {
      _depositorAssets.push(tokens_[i]);
      _depositorWeights.push(depositorWeights_[i]);
      _depositorReserves.push(depositorReserves_[i]);
    }
    console.log("__MockDepositor_init", tokensLength, _depositorAssets.length, _depositorWeights.length);
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
    console.log("_depositorPoolAssets");
    return _depositorAssets;
  }

  /// @dev Returns pool weights
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    console.log("_depositorPoolWeights", _depositorWeights.length);
    weights = _depositorWeights;
    uint len = weights.length;
    totalWeight = 0;
    for(uint i = 0; i < len; i++) {
      totalWeight += weights[i];
    }
  }

  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    reserves = new uint[](_depositorReserves.length);
    for (uint i = 0; i < _depositorReserves.length; ++i) {
      reserves[i] = _depositorReserves[i];
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorEnter
  /////////////////////////////////////////////////////////////////////
  struct DepositorEnterParams {
    uint[] amountsDesired;
    uint[] amountsConsumed;
    uint liquidityOut;
  }
  DepositorEnterParams public depositorEnterParams;

  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    require(_depositorAssets.length == amountsDesired_.length);

    uint len = amountsDesired_.length;
    amountsConsumed = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      require(amountsDesired_[i] == depositorEnterParams.amountsDesired[i], "_depositorEnter input params");
      IMockToken token = IMockToken(_depositorAssets[i]);
      token.burn(address(this), depositorEnterParams.amountsConsumed[i]);
      amountsConsumed[i] = depositorEnterParams.amountsConsumed[i];
    }

    liquidityOut = depositorEnterParams.liquidityOut;
  }

  function setDepositorEnter(uint[] memory amountsDesired_, uint[] memory amountsConsumed_, uint liquidityOut_) external {
    depositorEnterParams.liquidityOut = liquidityOut_;

    uint len = _depositorAssets.length;
    depositorEnterParams.amountsDesired = new uint[](len);
    depositorEnterParams.amountsConsumed = new uint[](len);
    for (uint i = 0; i < len; ++i) {
      depositorEnterParams.amountsDesired[i] = amountsDesired_[i];
      depositorEnterParams.amountsConsumed[i] = amountsConsumed_[i];
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorExit
  /////////////////////////////////////////////////////////////////////

  struct DepositorExitParams {
    uint liquidityAmount;
    uint[] amountsOut;
  }
  DepositorExitParams public depositorExitParams;

  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {
    console.log("MockDepositor._depositorExit liquidityAmount", liquidityAmount, depositorExitParams.liquidityAmount);
    require(liquidityAmount == depositorExitParams.liquidityAmount, "_depositorExit input params");

    uint len = _depositorAssets.length;
    amountsOut = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(_depositorAssets[i]);
      token.mint(address(this), depositorExitParams.amountsOut[i]);
      amountsOut[i] = depositorExitParams.amountsOut[i];
    }
  }

  function setDepositorExit(uint liquidityAmount_, uint[] memory amountsOut_) external {
    depositorExitParams.liquidityAmount = liquidityAmount_;
    depositorExitParams.amountsOut = new uint[](amountsOut_.length);
    for (uint i = 0; i < amountsOut_.length; ++i) {
      depositorExitParams.amountsOut[i] = amountsOut_[i];
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                   _depositorQuoteExit
  /////////////////////////////////////////////////////////////////////
  DepositorExitParams public depositorQuoteExitParams;

  /// @dev Quotes output for given lp amount from the pool.
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual view returns (uint[] memory amountsOut) {
    console.log("_depositorQuoteExit liquidityAmount", liquidityAmount);
    require(liquidityAmount == depositorQuoteExitParams.liquidityAmount, "_depositorQuoteExit input params");

    uint len = _depositorAssets.length;
    amountsOut = new uint[](len);
    for (uint i = 0; i < len; ++i) {
      amountsOut[i] = depositorQuoteExitParams.amountsOut[i];
    }
  }

  function setDepositorQuoteExit(uint liquidityAmount_, uint[] memory amountsOut_) external {
    depositorQuoteExitParams.liquidityAmount = liquidityAmount_;
    depositorQuoteExitParams.amountsOut = new uint[](amountsOut_.length);
    for (uint i = 0; i < amountsOut_.length; ++i) {
      depositorQuoteExitParams.amountsOut[i] = amountsOut_[i];
    }
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
    uint[] memory rewardAmounts
  ) {
    uint len = depositorClaimRewardsParams.rewardTokens.length;
    rewardTokens = new address[](len);
    rewardAmounts = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(depositorClaimRewardsParams.rewardTokens[i]);
      uint amount = depositorClaimRewardsParams.rewardAmounts[i];
      token.mint(address(this), amount);

      rewardTokens[i] = depositorClaimRewardsParams.rewardTokens[i];
      rewardAmounts[i] = depositorClaimRewardsParams.rewardAmounts[i];
    }
    return (rewardTokens, rewardAmounts);
  }

  function setDepositorClaimRewards(address[] memory rewardTokens_, uint[] memory rewardAmounts_) external {
    uint len = rewardTokens_.length;
    depositorClaimRewardsParams.rewardTokens = new address[](len);
    depositorClaimRewardsParams.rewardAmounts = new uint[](len);
    for (uint i = 0; i < len; ++i) {
      depositorClaimRewardsParams.rewardTokens[i] = rewardTokens_[i];
      depositorClaimRewardsParams.rewardAmounts[i] = rewardAmounts_[i];
    }
  }
}
