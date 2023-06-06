// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";

contract StrategyProfitHolder {
  using SafeERC20 for IERC20;

  address public immutable strategy;
  address[] public tokens;

  constructor(address strategy_, address[] memory tokens_) {
    strategy = strategy_;
    tokens = tokens_;
    uint len = tokens_.length;
    for (uint i; i < len; ++i) {
      IERC20(tokens_[i]).safeApprove(strategy_, 2 ** 255);
    }
  }

  function addToken(address token) external {
    address _strategy = strategy;
    require(msg.sender == _strategy, "SPH: denied");
    uint len = tokens.length;
    for (uint i; i < len; ++i) {
      require(tokens[i] != token, "SPH: token exists");
    }
    tokens.push(token);
    IERC20(token).safeApprove(_strategy, 2 ** 255);
  }

  function tokensLength() external view returns (uint) {
    return tokens.length;
  }
}
