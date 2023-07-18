import {AlgebraLib, IAlgebraPool__factory, KyberLib} from "../../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class AlgebraLiquidityUtils {
  static async getLiquidityAmountsInCurrentTickspacing(
    signer: SignerWithAddress,
    lib: AlgebraLib,
    poolAddress: string
  ) {
    const pool = IAlgebraPool__factory.connect(poolAddress, signer)
    const poolState = await pool.globalState()
    const poolLiquidity = await pool.liquidity()

    let lowerTick
    if (poolState.tick < 0) {
      lowerTick = Math.ceil(poolState.tick / 60) * 60 - 60
    } else {
      lowerTick = Math.floor(poolState.tick / 60) * 60
    }
    return lib.getAmountsForLiquidity(
      poolState.price,
      lowerTick,
      lowerTick + 60,
      poolLiquidity
    )
  }
}