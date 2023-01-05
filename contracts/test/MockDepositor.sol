// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../strategies/depositors/DepositorBase.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/IMockToken.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";

/// @title Mock contract for base Depositor.
/// @author bogdoslav
contract MockDepositor is DepositorBase, Initializable {

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant DEPOSITOR_MOCK_VERSION = "1.0.0";

  uint[] private _depositorReserves;
  uint[] private _depositorWeights;

  address[] private _depositorAssets;
  uint[] private _depositorAmounts;

  address[] private _depositorRewardTokens;
  uint[] private _depositorRewardAmounts;

  /// @notice total amount of active LP tokens.
  uint public totalSupply;

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  // @notice tokens must be MockTokens
  function __MockDepositor_init(
    address[] memory tokens_,
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_,
    uint[] memory depositorWeights_,
    uint[] memory depositorReserves_
  ) internal onlyInitializing {
    require(rewardTokens_.length == rewardAmounts_.length, "rewardAmounts_.length");
    require(tokens_.length == depositorReserves_.length, "depositorReserves_.length");
    require(tokens_.length == depositorWeights_.length, "depositorWeights_.length");

    uint tokensLength = tokens_.length;
    for (uint i = 0; i < tokensLength; ++i) {
      _depositorAssets.push(tokens_[i]);
      _depositorAmounts.push(0);

      _depositorWeights.push(depositorWeights_[i]);
      _depositorReserves.push(depositorReserves_[i]);
    }
    for (uint i = 0; i < rewardTokens_.length; ++i) {
      _depositorRewardTokens.push(rewardTokens_[i]);
      _depositorRewardAmounts.push(rewardAmounts_[i]);
    }
  }

  function setTotalSupply(uint totalSupply_) external {
    totalSupply = totalSupply_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   DepositorBase
  /////////////////////////////////////////////////////////////////////

  /// @dev Returns pool assets
  function _depositorPoolAssets() override internal virtual view returns (address[] memory) {
    return _depositorAssets;
  }

  /// @dev Returns pool weights
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
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


  /// @dev Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint) {
    return _depositorAmounts[0];
  }

  function _minValue(uint[] memory values_) private pure returns (uint min) {
    min = values_[0];
    uint len = values_.length;

    for (uint i = 1; i < len; ++i) {
      uint val = values_[i];
      if (val < min) min = val;
    }
  }

  /// @dev Deposit given amount to the pool.
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumed,
    uint liquidityOut
  ) {
    require(_depositorAssets.length == amountsDesired_.length);

    uint len = amountsDesired_.length;
    uint minAmount = _minValue(amountsDesired_);
    amountsConsumed = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(_depositorAssets[i]);
      token.burn(address(this), minAmount);
      amountsConsumed[i] = minAmount;
    }

    liquidityOut = minAmount;
    totalSupply += minAmount;
  }

  /// @dev Withdraw given lp amount from the pool.
  /// @notice if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount) override internal virtual returns (uint[] memory amountsOut) {

    uint depositorLiquidity = _depositorLiquidity();
    if (liquidityAmount > depositorLiquidity) {
      liquidityAmount = depositorLiquidity;
    }

    uint len = _depositorAssets.length;
    amountsOut = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(_depositorAssets[i]);
      token.mint(address(this), liquidityAmount);
      amountsOut[i] = liquidityAmount;
    }

    require(totalSupply >= liquidityAmount, "totalSupply >= liquidityAmount");
    totalSupply -= liquidityAmount;
  }
  /// @dev Quotes output for given lp amount from the pool.
  function _depositorQuoteExit(uint liquidityAmount) override internal virtual view returns (uint[] memory amountsOut) {

    uint depositorLiquidity = _depositorLiquidity();
    if (liquidityAmount > depositorLiquidity) {
      liquidityAmount = depositorLiquidity;
    }

    uint len = _depositorAssets.length;
    amountsOut = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      amountsOut[i] = liquidityAmount;
    }
  }

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory rewardTokens,
    uint[] memory rewardAmounts
  ) {
    uint len = _depositorRewardTokens.length;
    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(_depositorRewardTokens[i]);
      uint amount = _depositorRewardAmounts[i];
      token.mint(address(this), amount);
    }
    return (_depositorRewardTokens, _depositorRewardAmounts);
  }

  //// @notice Total amount of LP tokens in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    return totalSupply;
  }
}
