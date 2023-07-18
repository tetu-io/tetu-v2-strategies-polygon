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
}