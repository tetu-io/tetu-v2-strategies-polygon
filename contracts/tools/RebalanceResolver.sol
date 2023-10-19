// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV2.sol";
import "../interfaces/IRebalancingV2Strategy.sol";

/// @title Gelato resolver for rebalancing v2 strategies
/// @author a17
contract RebalanceResolver {
  // --- CONSTANTS ---

  string public constant VERSION = "3.0.0";

  // --- VARIABLES ---

  address public immutable strategy;
  address public owner;
  address public pendingOwner;
  uint public delay;
  uint public lastRebalance;
  mapping(address => bool) public operators;

  // --- INIT ---

  constructor(address strategy_) {
    owner = msg.sender;
    delay = 1 minutes;
    strategy = strategy_;
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "!owner");
    _;
  }

  // --- OWNER FUNCTIONS ---

  function offerOwnership(address value) external onlyOwner {
    pendingOwner = value;
  }

  function acceptOwnership() external {
    require(msg.sender == pendingOwner, "!pendingOwner");
    owner = pendingOwner;
    pendingOwner = address(0);
  }

  function setDelay(uint value) external onlyOwner {
    delay = value;
  }

  function changeOperatorStatus(address operator, bool status) external onlyOwner {
    operators[operator] = status;
  }

  // --- MAIN LOGIC ---

  function call() external {
    require(operators[msg.sender], "!operator");

    try IRebalancingV2Strategy(strategy).rebalanceNoSwaps(true) {} catch Error(string memory _err) {
      revert(string(abi.encodePacked("Strategy error: 0x", _toAsciiString(strategy), " ", _err)));
    } catch (bytes memory _err) {
      revert(string(abi.encodePacked("Strategy low-level error: 0x", _toAsciiString(strategy), " ", string(_err))));
    }
    lastRebalance = block.timestamp;
  }

  function checker() external view returns (bool canExec, bytes memory execPayload) {
    address strategy_ = strategy;
    ISplitter splitter = ISplitter(IStrategyV2(strategy_).splitter());
    if (
      !splitter.pausedStrategies(strategy_)
      && lastRebalance + delay < block.timestamp
      && IRebalancingV2Strategy(strategy_).needRebalance()
    ) {
      return (true, abi.encodeWithSelector(RebalanceResolver.call.selector));
    }

    return (false, bytes("Not ready to rebalance"));
  }

  function _toAsciiString(address x) internal pure returns (string memory) {
    bytes memory s = new bytes(40);
    for (uint i = 0; i < 20; i++) {
      bytes1 b = bytes1(uint8(uint(uint160(x)) / (2 ** (8 * (19 - i)))));
      bytes1 hi = bytes1(uint8(b) / 16);
      bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
      s[2 * i] = _char(hi);
      s[2 * i + 1] = _char(lo);
    }
    return string(s);
  }

  function _char(bytes1 b) internal pure returns (bytes1 c) {
    if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
    else return bytes1(uint8(b) + 0x57);
  }
}
