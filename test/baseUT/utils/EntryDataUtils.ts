import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {PLAN_REPAY_SWAP_REPAY_1, PLAN_SWAP_ONLY_2, PLAN_SWAP_REPAY_0} from "../AppConstants";
import {Misc} from "../../../scripts/utils/Misc";
import {BigNumber} from "ethers";

export function buildEntryData0(propNotUnderlying18: string = Number.MAX_SAFE_INTEGER.toString()) {
  return defaultAbiCoder.encode(["uint256", "uint256"],
    [
      PLAN_SWAP_REPAY_0,
      Number(propNotUnderlying18) === Number.MAX_SAFE_INTEGER
        ? Misc.MAX_UINT
        : parseUnits(propNotUnderlying18, 18)
    ])
}

export function buildEntryData1(
  debtAmountToReduce: BigNumber = BigNumber.from(0),
  propNotUnderlying18: string = Number.MAX_SAFE_INTEGER.toString()
) {
  return defaultAbiCoder.encode(["uint256", "uint256", "uint256"],
    [
      PLAN_REPAY_SWAP_REPAY_1,
      Number(propNotUnderlying18) === Number.MAX_SAFE_INTEGER
        ? Misc.MAX_UINT
        : parseUnits(propNotUnderlying18, 18),
      debtAmountToReduce
    ])
}

export function buildEntryData2(propNotUnderlying18: string = Number.MAX_SAFE_INTEGER.toString()) {
  return defaultAbiCoder.encode(["uint256", "uint256"],
    [
      PLAN_SWAP_ONLY_2,
      Number(propNotUnderlying18) === Number.MAX_SAFE_INTEGER
        ? Misc.MAX_UINT
        : parseUnits(propNotUnderlying18, 18)
    ])
}