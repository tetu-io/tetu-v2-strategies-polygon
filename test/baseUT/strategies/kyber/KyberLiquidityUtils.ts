import {IPool__factory, KyberLib} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class KyberLiquidityUtils {
  static async getLiquidityAmountsInCurrentTick(
    signer: SignerWithAddress,
    lib: KyberLib,
    poolAddress: string,
    deltaTick?: number
  ) {
    const pool = IPool__factory.connect(poolAddress, signer)
    const poolState = await pool.getPoolState()
    const poolLiquidityState = await pool.getLiquidityState()

    const tick = poolState.currentTick + (deltaTick ?? 0);
    console.log("KyberLiquidityUtils tick", tick);

    const amounts = await lib.getAmountsForLiquidity(
      poolState.sqrtP,
        tick,
        tick + 1,
      poolLiquidityState.baseL.add(poolLiquidityState.reinvestL)
    )

    return amounts
  }
}