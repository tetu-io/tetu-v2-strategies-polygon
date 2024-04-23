import {DeployerUtils} from "../utils/DeployerUtils";
import {IERC20Metadata__factory, UniswapV3Pool__factory, Univ3TokenSeller} from "../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {parseUnits} from "ethers/lib/utils";
import {Univ3TokenSellerLib} from "../../typechain/contracts/token-seller/Univ3TokenSeller";
import TokenSellerConfigStruct = Univ3TokenSellerLib.TokenSellerConfigStruct;

export class DeployTokenSellerUtils {
  public static async deployTokenSeller(
    signer: SignerWithAddress,
    tokenA: string,
    tokenB: string,
    pool: string,
    amountA: string,
    tickRangeSize: number = 1,
    thresholdRatio: string = "0.1",
    thresholdLastRefreshPoolSec: number = 1000,
  ): Promise<string> {
    const decimalsA = await IERC20Metadata__factory.connect(tokenA, signer).decimals();

    const slot0 = await UniswapV3Pool__factory.connect(pool, signer).slot0();
    const poolTokenA = await UniswapV3Pool__factory.connect(pool, signer).token0();
    const poolSwapTokens = poolTokenA.toLowerCase() === tokenA;

    const sqrtPriceX96Limit =  poolSwapTokens
      ? slot0.sqrtPriceX96.mul(100) // upper limit
      : slot0.sqrtPriceX96.div(100); // lowest limit

    const config: TokenSellerConfigStruct = {
      amountA: parseUnits(amountA, decimalsA),
      thresholdLastRefreshPoolSec,
      thresholdRatio: parseUnits(thresholdRatio, 5),
      thresholdTokenB: 0,
      tickRangeSize,
      tickLimit: 0, // auto calculated
    }

    const tokenSeller = (await DeployerUtils.deployContract(
      signer,
      tokenA,
      tokenB,
      pool,
      config,
      sqrtPriceX96Limit,
      signer.address
    )) as Univ3TokenSeller;

    return tokenSeller.address
  }
}