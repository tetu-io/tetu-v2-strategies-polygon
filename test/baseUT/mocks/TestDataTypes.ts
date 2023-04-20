import {MockToken} from "../../../typechain";
import {BigNumber} from "ethers";

export interface ILiquidationParams {
  tokenIn: MockToken;
  tokenOut: MockToken;
  amountIn: string;
  amountOut: string;
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
  totalDebtAmountOut: string;
  totalCollateralAmountOut: string;
  amountRepay: string;
  collateralAmountOut: string;
  returnedBorrowAmountOut?: string;
  swappedLeftoverCollateralOut?: string;
  swappedLeftoverBorrowOut?: string;
}
export interface IQuoteRepayParams {
  collateralAsset: MockToken;
  borrowAsset: MockToken;
  amountRepay: string;
  collateralAmountOut: string;
  swappedAmountOut?: string;
}