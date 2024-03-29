import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  AlgebraLib,
  ConverterStrategyBase__factory,
  IAlgebraQuoter__factory,
  IKyberQuoterV2__factory,
  IPancakeQuoterV2__factory, IPancakeV3Pool__factory,
  IPool__factory,
  IUniswapV3Quoter__factory,
  KyberLib,
  PancakeLib,
  UniswapV3Lib
} from "../../../../typechain";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_PANCAKE, PLATFORM_UNIV3} from "../AppPlatforms";
import {UniswapV3LiquidityUtils} from "../univ3/UniswapV3LiquidityUtils";
import {AlgebraLiquidityUtils} from "../algebra/AlgebraLiquidityUtils";
import {KyberLiquidityUtils} from "../kyber/KyberLiquidityUtils";
import {BigNumber, BigNumberish} from "ethers";
import {IStrategyBasicInfo} from "./PairBasedStrategyBuilder";
import {IUniswapV3Pool__factory} from "../../../../typechain/factories/contracts/integrations/uniswap";
import {GAS_LIMIT} from "../../GasLimits";
import {PancakeLiquidityUtils} from "../pancake/PancakeLiquidityUtils";
import type {PromiseOrValue} from "../../../../typechain/common";

export class PairStrategyLiquidityUtils {
  /**
   * Calculate liquidity amount inside the given tick
   * By default deltaTick is undefined, it means current tick.
   * Use deltaTick +1 or -1 to get liquidity in the ticks nearest to the current
   */
  static async getLiquidityAmountsInCurrentTick(
    signer: SignerWithAddress,
    platform: string,
    lib: KyberLib | UniswapV3Lib | AlgebraLib | PancakeLib,
    poolAddress: string,
    deltaTick?: number
  ) {
    switch (platform) {
      case PLATFORM_UNIV3:
        return UniswapV3LiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib as unknown as UniswapV3Lib, poolAddress, deltaTick);
      case PLATFORM_ALGEBRA:
        return AlgebraLiquidityUtils.getLiquidityAmountsInCurrentTickspacing(signer, lib as unknown as AlgebraLib, poolAddress, deltaTick);
      case PLATFORM_KYBER:
        return KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib as unknown as KyberLib, poolAddress, deltaTick);
      case PLATFORM_PANCAKE:
        return PancakeLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib as unknown as PancakeLib, poolAddress, deltaTick);
      default: throw Error(`PairStrategyLiquidityUtils unknown ${platform}`);
    }
  }

  /**
   * Calculate {amountIn} of {tokenIn}
   * that should be swapped to receive {amountOut} of {tokenOut}
   * in the given pool.
   */
  static async quoteExactOutputSingle(
    signer: SignerWithAddress,
    b: IStrategyBasicInfo,
    tokenIn: string,
    tokenOut: string,
    amountOut: BigNumber
  ): Promise<BigNumber> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    switch (platform) {
      case PLATFORM_UNIV3:
        return IUniswapV3Quoter__factory.connect(b.quoter, signer).callStatic.quoteExactOutputSingle(
          tokenIn,
          tokenOut,
          await IUniswapV3Pool__factory.connect(b.pool, signer).fee(),
          amountOut,
          0,
          {gasLimit: GAS_LIMIT}
        );
      case PLATFORM_ALGEBRA:
        console.log("algebra.quoteExactOutputSingle");
        console.log("algebra.tokenIn", tokenIn);
        console.log("algebra.tokenOut", tokenOut);
        console.log("algebra.amountOut", amountOut);
        const algebraRet = await IAlgebraQuoter__factory.connect(b.quoter, signer).callStatic.quoteExactOutputSingle(
          tokenIn,
          tokenOut,
          amountOut,
          0,
          {gasLimit: GAS_LIMIT}
        );
        console.log("quoteExactOutputSingle.algebra.amountOut", amountOut);
        console.log("quoteExactOutputSingle.algebra.results", algebraRet);
        return algebraRet.amountIn;
      case PLATFORM_KYBER:
        const kyberRet = await IKyberQuoterV2__factory.connect(b.quoter, signer).callStatic.quoteExactOutputSingle(
          {
            tokenIn,
            tokenOut,
            feeUnits: await IPool__factory.connect(b.pool, signer).swapFeeUnits(),
            amount: amountOut,
            limitSqrtP: 0,
          },
          {gasLimit: GAS_LIMIT}
        );
        console.log("quoteExactOutputSingle.kyber.amountOut", amountOut);
        console.log("quoteExactOutputSingle.kyber.results", kyberRet);
        return kyberRet.returnedAmount;
      case PLATFORM_PANCAKE:
        return (await IPancakeQuoterV2__factory.connect(b.quoter, signer).callStatic.quoteExactOutputSingle({
            tokenIn,
            tokenOut,
            amount: amountOut,
            fee: await IPancakeV3Pool__factory.connect(b.pool, signer).fee(),
            sqrtPriceLimitX96: 0,
          },
          {gasLimit: GAS_LIMIT}
        )).amountIn;
      default: throw Error(`quoteExactOutputSingle unknown ${platform}`);
    }
  }
}