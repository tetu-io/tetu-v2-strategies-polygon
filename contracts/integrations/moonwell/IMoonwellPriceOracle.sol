// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0
interface IMoonwellPriceOracle {
  event FeedSet(address feed, string symbol);
  event NewAdmin(address oldAdmin, address newAdmin);
  event PricePosted(
    address asset,
    uint256 previousPriceMantissa,
    uint256 requestedPriceMantissa,
    uint256 newPriceMantissa
  );

  function admin() external view returns (address);

  function assetPrices(address asset) external view returns (uint256);

  function getFeed(string memory symbol) external view returns (address);

  function getUnderlyingPrice(address mToken) external view returns (uint256);

  function isPriceOracle() external view returns (bool);

  function nativeToken() external view returns (bytes32);


  function setAdmin(address newAdmin) external;

  function setDirectPrice(address asset, uint256 price) external;

  function setFeed(string memory symbol, address feed) external;

  function setUnderlyingPrice(address mToken, uint256 underlyingPriceMantissa) external;
}
