import {IPool__factory, KyberLib} from "../../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class KyberLiquidityUtils {
  static async getLiquidityAmountsInCurrentTick(
    signer: SignerWithAddress,
    lib: KyberLib,
    poolAddress: string
  ) {
    const pool = IPool__factory.connect(poolAddress, signer)
    const poolState = await pool.getPoolState()
    const poolLiquidityState = await pool.getLiquidityState()

    const amounts = await lib.getAmountsForLiquidity(
      poolState.sqrtP,
      poolState.currentTick,
      poolState.currentTick + 1,
      poolLiquidityState.baseL.add(poolLiquidityState.reinvestL)
    )

    return amounts
  }
}