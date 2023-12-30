// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IKeomApi3Server {
  function readDataFeedWithId(bytes32 dataFeedId) external view returns (int224 value, uint32 timestamp);
}