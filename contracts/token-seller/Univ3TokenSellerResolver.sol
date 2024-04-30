// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../interfaces/IUniv3TokenSeller.sol";

/// @title Gelato resolver for token-seller
contract Univ3TokenSellerResolver {

  //region ---------------------- Constants
  string public constant VERSION = "1.0.0";
  //endregion ---------------------- Constants


  //region ---------------------- Variables

  IUniv3TokenSeller public tokenSeller;
  address public owner;
  address public pendingOwner;
  uint public delay;
  uint public lastRebalance;
  mapping(address => bool) public operators;

  //endregion ---------------------- Variables

  //region ---------------------- Init

  constructor(address tokenSeller_, uint delay_) {
    owner = msg.sender;
    delay = delay_;
    tokenSeller = IUniv3TokenSeller(tokenSeller_);
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "!owner");
    _;
  }

  //endregion ---------------------- Init

  //region ---------------------- Owner functions

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

  function setTokenSeller(address tokenSeller_) external onlyOwner {
    tokenSeller = IUniv3TokenSeller(tokenSeller_);
  }

  function changeOperatorStatus(address operator, bool status) external onlyOwner {
    operators[operator] = status;
  }
  //endregion ---------------------- Owner functions

  //region ---------------------- Main logic
  function checker() external view returns (bool canExec, bytes memory execPayload) {
    IUniv3TokenSeller tokenSeller_ = IUniv3TokenSeller(tokenSeller);
    if (
      lastRebalance + delay < block.timestamp
      && tokenSeller_.needToRefresh()
    ) {
      return (true, abi.encodeWithSelector(Univ3TokenSellerResolver.call.selector));
    }

    return (false, bytes("Not ready to refresh"));
  }

  function call() external {
    require(operators[msg.sender], "!operator");

    try tokenSeller.refreshPool() {} catch Error(string memory _err) {
      revert(string(abi.encodePacked("TokenSeller error: 0x", _toAsciiString(address(tokenSeller)), " ", _err)));
    } catch (bytes memory _err) {
      revert(string(abi.encodePacked("TokenSeller low-level error: 0x", _toAsciiString(address(tokenSeller)), " ", string(_err))));
    }
    lastRebalance = block.timestamp;
  }
  //endregion ---------------------- Main logic

  //region ---------------------- Utils
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
  //endregion ---------------------- Utils
}
