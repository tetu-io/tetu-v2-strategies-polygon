// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface IPoolSwapStructs {
  struct SwapRequest {
    uint8 kind;
    address tokenIn;
    address tokenOut;
    uint256 amount;
    bytes32 poolId;
    uint256 lastChangeBlock;
    address from;
    address to;
    bytes userData;
  }
}