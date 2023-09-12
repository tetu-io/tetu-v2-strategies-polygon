import { BigNumber, ContractTransaction } from 'ethers';

export async function getGasUsed(p: Promise<ContractTransaction>): Promise<BigNumber> {
  const tx = await p;
  const rec = await tx.wait();
  console.log("Gas used: ", rec.gasUsed.toNumber());
  return rec.gasUsed;
}

/**
 * Call f() to check gas limit
 * but only if env settings allows
 * (process.env.TETU_DISABLE_GAS_LIMITS_CONTROL is not "1")
 * @param gasUsed
 * @param gasLimit
 * @param f
 */
export function controlGasLimitsEx(
  gasUsed: BigNumber,
  gasLimit: number,
  f: (gasUsed: BigNumber, gasLimit: number) => void
) {
  console.log("process.env.TETU_DISABLE_GAS_LIMITS_CONTROL", process.env.TETU_DISABLE_GAS_LIMITS_CONTROL)
  if (process.env.TETU_DISABLE_GAS_LIMITS_CONTROL === "1") {
    console.log(`Gas control is skipped: used=${gasUsed.toNumber()} limit=${gasLimit}}`);
  } else {
    f(gasUsed, gasLimit);
    console.log(`Limit - used = ${gasLimit - gasUsed.toNumber()}, used=${gasUsed.toNumber()}`);
  }
}
