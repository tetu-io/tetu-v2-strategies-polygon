import {BigNumber} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";

export class UniversalUtils {
  public static getApr(earned: BigNumber, investAmount: BigNumber, startTimestamp: number, endTimestamp: number) {
    const earnedPerSec1e10 = endTimestamp > startTimestamp ? earned.mul(parseUnits('1', 10)).div(endTimestamp - startTimestamp) : BigNumber.from(0);
    const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10));
    const apr = earnedPerDay.mul(365).mul(100000000).div(investAmount).div(1000);
    return +formatUnits(apr, 3)
  }
}