import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  AlgebraLib,
  ConverterStrategyBase__factory, IAlgebraQuoter__factory, IKyberQuoterV2__factory, IPool__factory,
  IUniswapV3Quoter__factory,
  KyberLib,
  UniswapV3Lib
} from "../../../typechain";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "./AppPlatforms";
import {UniswapV3LiquidityUtils} from "../../strategies/polygon/uniswapv3/utils/UniswapV3LiquidityUtils";
import {AlgebraLiquidityUtils} from "../../strategies/polygon/algebra/utils/AlgebraLiquidityUtils";
import {KyberLiquidityUtils} from "../../strategies/polygon/kyber/utils/KyberLiquidityUtils";
import {BigNumber} from "ethers";
import {IBuilderResults} from "./PairBasedStrategyBuilder";
import {IUniswapV3Pool__factory} from "../../../typechain/factories/contracts/integrations/uniswap";

export class PairStrategyLiquidityUtils {
  /**
   * Calculate liquidity amount inside the given tick
   * By default deltaTick is undefined, it means current tick.
   * Use deltaTick +1 or -1 to get liquidity in the ticks nearest to the current
   */
  static async getLiquidityAmountsInCurrentTick(
    signer: SignerWithAddress,
    platform: string,
    lib: KyberLib | UniswapV3Lib | AlgebraLib,
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
    b: IBuilderResults,
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
          0
        );
      case PLATFORM_ALGEBRA:
        const algebraRet = await IAlgebraQuoter__factory.connect(b.quoter, signer).callStatic.quoteExactOutputSingle(
          tokenIn,
          tokenOut,
          amountOut,
          0
        );
        console.log("quoteExactOutputSingle.algebra.amountOut", amountOut);
        console.log("quoteExactOutputSingle.algebra.results", algebraRet);
        return algebraRet.amountIn;
      case PLATFORM_KYBER:
        const kyberRet = await IKyberQuoterV2__factory.connect(b.quoter, signer).callStatic.quoteExactOutputSingle({
          tokenIn,
          tokenOut,
          feeUnits: await IPool__factory.connect(b.pool, signer).swapFeeUnits(),
          amount: amountOut,
          limitSqrtP: 0
        });
        console.log("quoteExactOutputSingle.kyber.amountOut", amountOut);
        console.log("quoteExactOutputSingle.kyber.results", kyberRet);
        return kyberRet.returnedAmount;
      default: throw Error(`quoteExactOutputSingle unknown ${platform}`);
    }
  }

  static async quoteExactOutputSingle2(
    signer: SignerWithAddress,
    strategy: string,
    quoter: string,
    pool: string,
    tokenIn: string,
    tokenOut: string,
    amountOut: BigNumber
  ): Promise<BigNumber> {
    const platform = await ConverterStrategyBase__factory.connect(strategy, signer).PLATFORM();
    switch (platform) {
      case PLATFORM_UNIV3:
        return IUniswapV3Quoter__factory.connect(quoter, signer).callStatic.quoteExactOutputSingle(
          tokenIn,
          tokenOut,
          await IUniswapV3Pool__factory.connect(pool, signer).fee(),
          amountOut,
          0
        );
      case PLATFORM_ALGEBRA:
        const algebraRet = await IAlgebraQuoter__factory.connect(quoter, signer).callStatic.quoteExactOutputSingle(
          tokenIn,
          tokenOut,
          amountOut,
          0
        );
        console.log("quoteExactOutputSingle.algebra.amountOut", amountOut);
        console.log("quoteExactOutputSingle.algebra.results", algebraRet);
        return algebraRet.amountIn;
      case PLATFORM_KYBER:
        const kyberRet = await IKyberQuoterV2__factory.connect(quoter, signer).callStatic.quoteExactOutputSingle({
          tokenIn,
          tokenOut,
          feeUnits: await IPool__factory.connect(pool, signer).swapFeeUnits(),
          amount: amountOut,
          limitSqrtP: 0
        });
        console.log("quoteExactOutputSingle.kyber.amountOut", amountOut);
        console.log("quoteExactOutputSingle.kyber.results", kyberRet);
        return kyberRet.returnedAmount;
      default: throw Error(`quoteExactOutputSingle unknown ${platform}`);
    }
  }
}