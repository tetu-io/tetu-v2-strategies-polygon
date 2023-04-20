// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/proxy/ControllableV3.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuVaultV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ISplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IStrategyV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/EnumerableSet.sol";
import "../interfaces/IRebalancingStrategy.sol";
import "../libs/AppPlatforms.sol";

/// @title Gelato resolver for rebalancing strategies
/// @author a17
contract RebalanceResolver is ControllableV3 {
  // --- CONSTANTS ---

  string public constant VERSION = "1.1.0";
  uint public constant DELAY_RATE_DENOMINATOR = 100_000;

  // --- VARIABLES ---

  address public owner;
  address public pendingOwner;
  uint public delay;
  uint public maxGas;

  mapping(address => uint) internal _lastRebalance;
  mapping(address => uint) public delayRate;
  mapping(address => bool) public operators;

  EnumerableSet.AddressSet internal deprecated;

  // --- INIT ---

  function init(address controller_) external initializer {
    ControllableV3.__Controllable_init(controller_);

    owner = msg.sender;
    delay = 1 minutes;
    maxGas = 35 gwei;
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

  function setMaxGas(uint value) external onlyOwner {
    maxGas = value;
  }

  function setDelayRate(address[] memory _strategies, uint value) external onlyOwner {
    for (uint i; i < _strategies.length; ++i) {
      delayRate[_strategies[i]] = value;
    }
  }

  function changeOperatorStatus(address operator, bool status) external onlyOwner {
    operators[operator] = status;
  }

  // --- MAIN LOGIC ---

  function lastRebalance(address strategy) public view returns (uint lastRebalanceTimestamp) {
    lastRebalanceTimestamp = _lastRebalance[strategy];
  }

  function call(address[] memory _strategies) external returns (uint amountOfCalls) {
    require(operators[msg.sender], "!operator");

    uint strategiesLength = _strategies.length;
    uint counter;
    for (uint i; i < strategiesLength; ++i) {
      address strategy = _strategies[i];

      try IRebalancingStrategy(strategy).rebalance() {} catch Error(string memory _err) {
        revert(string(abi.encodePacked("Strategy error: 0x", _toAsciiString(strategy), " ", _err)));
      } catch (bytes memory _err) {
        revert(string(abi.encodePacked("Strategy low-level error: 0x", _toAsciiString(strategy), " ", string(_err))));
      }
      _lastRebalance[strategy] = block.timestamp;
      counter++;
    }

    return counter;
  }

  function checker() external view returns (bool canExec, bytes memory execPayload) {
    IController _controller = IController(controller());
    uint vaultsLength = _controller.vaultsListLength();

    uint counter;
    for (uint i; i < vaultsLength; ++i) {
      ISplitter splitter = ITetuVaultV2(_controller.vaults(i)).splitter();
      for (uint k; k < splitter.strategiesLength(); ++k) {
        if (_needRebalance(splitter.strategies(k))) {
          ++counter;
        }
      }
    }

    if (counter == 0) {
      return (false, bytes("No ready strategies"));
    } else {
      address[] memory strategiesResult = new address[](counter);
      uint j;
      for (uint i; i < vaultsLength; ++i) {
        ISplitter splitter = ITetuVaultV2(_controller.vaults(i)).splitter();
        for (uint k; k < splitter.strategiesLength(); ++k) {
          if (_needRebalance(splitter.strategies(k))) {
            strategiesResult[j] = splitter.strategies(k);
            ++j;
          }
        }
      }
      return (true, abi.encodeWithSelector(RebalanceResolver.call.selector, strategiesResult));
    }
  }

  function _needRebalance(address strategy_) internal view returns (bool) {
    IStrategyV2 strategyV2 = IStrategyV2(strategy_);
    if (keccak256(bytes(strategyV2.PLATFORM())) == keccak256(bytes(AppPlatforms.UNIV3)) && IRebalancingStrategy(strategy_).needRebalance()) {
      uint delayAdjusted = delay;
      uint _delayRate = delayRate[strategy_];
      if (_delayRate != 0) {
        delayAdjusted = delay * _delayRate / DELAY_RATE_DENOMINATOR;
      }
      if (lastRebalance(strategy_) + delayAdjusted < block.timestamp) {
        return true;
      }
    }
    return false;
  }

  /// @dev Inspired by OraclizeAPI's implementation - MIT license
  ///      https://github.com/oraclize/ethereum-api/blob/b42146b063c7d6ee1358846c198246239e9360e8/oraclizeAPI_0.4.25.sol
  function _toString(uint value) internal pure returns (string memory) {
    if (value == 0) {
      return "0";
    }
    uint temp = value;
    uint digits;
    while (temp != 0) {
      digits++;
      temp /= 10;
    }
    bytes memory buffer = new bytes(digits);
    while (value != 0) {
      digits -= 1;
      buffer[digits] = bytes1(uint8(48 + uint(value % 10)));
      value /= 10;
    }
    return string(buffer);
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
