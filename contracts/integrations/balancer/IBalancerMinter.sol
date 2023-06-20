// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IBalancerMinter {
  event Minted(address indexed recipient, address gauge, uint256 minted);
  event MinterApprovalSet(
    address indexed user,
    address indexed minter,
    bool approval
  );

  function allowed_to_mint_for(address minter, address user)
  external
  view
  returns (bool);

  function getBalancerToken() external view returns (address);

  function getBalancerTokenAdmin() external view returns (address);

  function getDomainSeparator() external view returns (bytes32);

  function getGaugeController() external view returns (address);

  function getMinterApproval(address minter, address user)
  external
  view
  returns (bool);

  function getNextNonce(address user) external view returns (uint256);

  function mint(address gauge) external returns (uint256);

  function mintFor(address gauge, address user) external returns (uint256);

  function mintMany(address[] memory gauges) external returns (uint256);

  function mintManyFor(address[] memory gauges, address user)
  external
  returns (uint256);

  function mint_for(address gauge, address user) external;

  function mint_many(address[8] memory gauges) external;

  function minted(address user, address gauge)
  external
  view
  returns (uint256);

  function setMinterApproval(address minter, bool approval) external;

  function setMinterApprovalWithSignature(
    address minter,
    bool approval,
    address user,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;

  function toggle_approve_mint(address minter) external;
}
