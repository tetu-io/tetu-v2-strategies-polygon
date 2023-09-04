import {AlgebraLib, IAlgebraPool__factory, KyberLib} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class AlgebraLiquidityUtils {
  static async getLiquidityAmountsInCurrentTickspacing(
    signer: SignerWithAddress,
    lib: AlgebraLib,
    poolAddress: string,
    deltaTick?: number
  ) {
    const pool = IAlgebraPool__factory.connect(poolAddress, signer)
    const poolState = await pool.globalState()
    const poolLiquidity = await pool.liquidity()

    const tick = poolState.tick + (deltaTick ?? 0);
    console.log("AlgebraLiquidityUtils.current tick", tick);

    let lowerTick
    if (poolState.tick < 0) {
      lowerTick = Math.ceil(tick / 60) * 60 - 60
    } else {
      lowerTick = Math.floor(tick / 60) * 60
    }
    return lib.getAmountsForLiquidity(
      poolState.price,
      lowerTick,
      lowerTick + 60,
      poolLiquidity
    )
  }
}