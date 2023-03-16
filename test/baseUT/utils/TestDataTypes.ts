import {MockToken} from "../../../typechain";
import {BigNumber} from "ethers";

export interface ILiquidationParams {
  tokenIn: MockToken;
  tokenOut: MockToken;
  amountIn: BigNumber;
  amountOut: BigNumber;
}
export interface ITokenAmount {
  token: MockToken;
  amount: BigNumber;
}
export interface IBorrowParams {
  collateralAsset: MockToken;
  collateralAmount: BigNumber;
  borrowAsset: MockToken;
  converter: string;
  maxTargetAmount: BigNumber;
}
export interface IRepayParams {
  collateralAsset: MockToken;
  borrowAsset: MockToken;
  totalDebtAmountOut: BigNumber;
  totalCollateralAmountOut: BigNumber;
  amountRepay: BigNumber;
}
