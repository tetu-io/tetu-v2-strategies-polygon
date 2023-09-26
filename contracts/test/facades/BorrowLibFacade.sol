// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../../libs/BorrowLib.sol";

contract BorrowLibFacade {
  function rebalanceAssets(
    ITetuConverter tetuConverter_,
    ITetuLiquidator tetuLiquidator_,
    address asset0,
    address asset1,
    uint prop0,
    uint threshold0,
    uint threshold1,
    uint addition0
  ) external {
    BorrowLib.rebalanceAssets(tetuConverter_, tetuLiquidator_, asset0, asset1, prop0, threshold0, threshold1, addition0);
  }

  function _makeLittleSwap(
    BorrowLib.RebalanceAssetsCore memory c,
    BorrowLib.PricesDecs memory pd,
    uint balanceA_,
    uint requiredAmountB
  ) external returns (
    uint spentAmountIn,
    uint receivedAmountOut
  ) {
    return BorrowLib._makeLittleSwap(c, pd, balanceA_, requiredAmountB);
  }

  function openPosition(
    BorrowLib.RebalanceAssetsCore memory c,
    BorrowLib.PricesDecs memory pd,
    uint balanceA_,
    uint balanceB_
  ) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    return BorrowLib.openPosition(c, pd, balanceA_, balanceB_);
  }

  function _openPosition(BorrowLib.RebalanceAssetsCore memory c, uint balanceA_, uint balanceB_) external returns (
    uint collateralAmountOut,
    uint borrowedAmountOut
  ) {
    return BorrowLib._openPosition(c, balanceA_, balanceB_);
  }

  function _makeBorrowToDeposit(
    ITetuConverter converter_,
    uint[2] memory amounts_,
    address[2] memory tokens_,
    uint[2] memory thresholds_,
    uint prop0
  ) external {
    BorrowLib._makeBorrowToDeposit(converter_, amounts_, tokens_, thresholds_, prop0);
  }

  function prepareToDeposit(
    ITetuConverter converter_,
    uint amount_,
    address[2] memory tokens_,
    uint[2] memory thresholds_,
    uint prop0
  ) external returns (
    uint[2] memory tokenAmounts
  ) {
    return BorrowLib.prepareToDeposit(converter_, amount_, tokens_, thresholds_, prop0);
  }
}