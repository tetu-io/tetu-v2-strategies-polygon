import {BigNumber} from "ethers";
import {formatUnits} from "ethers/lib/utils";

export interface IPoolAdapterStatus {
    collateralAmount: BigNumber;
    amountToPay: BigNumber;
    healthFactor18: BigNumber;
    opened: boolean;
    collateralAmountLiquidated: BigNumber;
    debtGapRequired: boolean;
}

export interface IPoolAdapterStatusNum {
    collateralAmount: number;
    amountToPay: number;
    healthFactor18: number;
    opened: boolean;
    collateralAmountLiquidated: number;
    debtGapRequired: boolean;
}

export class BorrowRepayDataTypeUtils {
    static getPoolAdapterStatusNum(
        p: IPoolAdapterStatus,
        collateralDecimals: number,
        borrowDecimals: number
    ): IPoolAdapterStatusNum {
        return {
            opened: p.opened,
            collateralAmount: +formatUnits(p.collateralAmount, collateralDecimals),
            amountToPay: +formatUnits(p.amountToPay, borrowDecimals),
            healthFactor18: +formatUnits(p.healthFactor18, 18),
            collateralAmountLiquidated: +formatUnits(p.collateralAmountLiquidated, collateralDecimals),
            debtGapRequired: p.debtGapRequired
        }
    }
}