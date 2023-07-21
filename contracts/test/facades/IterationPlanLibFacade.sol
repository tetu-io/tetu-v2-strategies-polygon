// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/IterationPlanLib.sol";

contract IterationPlanLibFacade {
  function estimateSwapAmountForRepaySwapRepay(
    IterationPlanLib.SwapRepayPlanParams memory p,
    uint balanceA,
    uint balanceB,
    uint indexA,
    uint indexB,
    uint propB,
    uint totalCollateralA,
    uint totalBorrowB,
    uint collateralA,
    uint amountToRepayB
  ) external pure returns(uint) {
    return IterationPlanLib.estimateSwapAmountForRepaySwapRepay(
      p,
      balanceA,
      balanceB,
      indexA,
      indexB,
      propB,
      totalCollateralA,
      totalBorrowB,
      collateralA,
      amountToRepayB
    );
  }

  function getEntryKind(bytes memory entryData_) external pure returns (uint) {
    return IterationPlanLib.getEntryKind(entryData_);
  }

  function _buildPlanRepaySwapRepay(
    IterationPlanLib.SwapRepayPlanParams memory p,
    uint[2] memory balancesAB,
    uint[2] memory idxAB,
    uint propB,
    uint totalCollateralA,
    uint totalBorrowB
  ) external returns (
    uint indexToSwapPlus1,
    uint amountToSwap,
    uint indexToRepayPlus1
  ) {
    return IterationPlanLib._buildPlanRepaySwapRepay(
      p,
      balancesAB,
      idxAB,
      propB,
      totalCollateralA,
      totalBorrowB
    );
  }
}