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
export interface ITokenAmountNum {
  token: MockToken;
  amount: string;
}
export interface IBorrowParams {
  collateralAsset: MockToken;
  collateralAmount: BigNumber;
  borrowAsset: MockToken;
  converter: string;
  maxTargetAmount: BigNumber;
}
export interface IBorrowParamsNum {
  collateralAsset: MockToken;
  collateralAmount: string;
  borrowAsset: MockToken;
  converter: string;
  maxTargetAmount: string;
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
  debtGapToSend?: string;
  debtGapToReturn?: string;
}
export interface IQuoteRepayParams {
  collateralAsset: MockToken;
  borrowAsset: MockToken;
  amountRepay: string;
  collateralAmountOut: string;
  swappedAmountOut?: string;
}
export interface IConversionValidationParams {
  tokenIn: MockToken;
  tokenOut: MockToken;
  amountIn: string;
  amountOut: string;
  /**
   * See SetIsConversionValidResult:
   *  0 - fail
   *  1 - success
   *  2 - zero price error
   */
  result: number;
}