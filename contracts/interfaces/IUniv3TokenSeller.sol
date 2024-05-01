// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IUniv3TokenSeller {
  function needToRefresh() external view returns (bool);
  function refreshPool() external;
}