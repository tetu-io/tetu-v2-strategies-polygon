// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "@tetu_io/tetu-liquidator/contracts/interfaces/ISwapper.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";

/// @notice Combine "transfer" and "swap" to single transaction (to be able to revert both)
contract SwapHelper {
  using SafeERC20 for IERC20;
  function transferAndSwap(
    ISwapper swapper,
    uint swapAmount,
    address pool,
    IERC20 tokenIn,
    IERC20 tokenOut,
    uint priceImpactTolerance
  ) external {
    tokenIn.safeTransferFrom(msg.sender, address(this), swapAmount);
    tokenIn.safeTransfer(address(swapper), swapAmount);
    swapper.swap(
      pool,
      address(tokenIn),
      address(tokenOut),
      msg.sender,
      priceImpactTolerance
    );
  }

}