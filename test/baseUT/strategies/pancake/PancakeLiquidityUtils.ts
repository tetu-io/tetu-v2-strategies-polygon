import {IPancakeV3Pool__factory, IUniswapV3Pool__factory, PancakeLib, UniswapV3Lib} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class PancakeLiquidityUtils {
  static async getLiquidityAmountsInCurrentTick(
    signer: SignerWithAddress,
    lib: PancakeLib,
    poolAddress: string,
    deltaTick?: number
  ) {
    const pool = IPancakeV3Pool__factory.connect(poolAddress, signer)
    const slot0 = await pool.slot0()
    const poolLiquidity = await pool.liquidity()
    console.log("PancakeLiquidityUtils.current tick", slot0.tick);

    return lib.getAmountsForLiquidity(
      slot0.sqrtPriceX96,
      slot0.tick + (deltaTick ?? 0),
      slot0.tick + 1 + (deltaTick ?? 0),
      poolLiquidity
    )
  }
}