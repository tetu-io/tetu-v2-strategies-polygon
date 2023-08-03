/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {IBuilderResults, PairBasedStrategyBuilder} from "./PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "./AppPlatforms";

export class PairStrategyFixtures {
  static async buildPairStrategyUsdtUsdc(
    strategyName: string,
    signer: SignerWithAddress,
    signer2: SignerWithAddress
  ): Promise<IBuilderResults> {
    switch (strategyName) {
      case PLATFORM_UNIV3:
        return this.buildUniv3UsdtUsdc(signer, signer2);
      case PLATFORM_ALGEBRA:
        return this.buildAlgebraUsdtUsdc(signer, signer2);
      case PLATFORM_KYBER:
        return this.buildKyberUsdtUsdc(signer, signer2);
      default:
        throw Error(`buildStrategy doesn't support ${strategyName}`);
    }
  }

  static async buildUniv3UsdtUsdc(signer: SignerWithAddress, signer2: SignerWithAddress): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildUniv3({
      signer,
      signer2,
      gov: MaticAddresses.GOV_ADDRESS,
      pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
      asset: MaticAddresses.USDC_TOKEN,
      vaultName: 'TetuV2_UniswapV3_USDC-USDT-0.01%',
      converter: MaticAddresses.TETU_CONVERTER,
      profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN],
      swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
      liquidatorPools: [{
        pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDC_TOKEN,
        tokenOut: MaticAddresses.USDT_TOKEN,
      },]

    });
  }

  static async buildAlgebraUsdtUsdc(signer: SignerWithAddress, signer2: SignerWithAddress): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildAlgebra({
      signer,
      signer2,
      gov: MaticAddresses.GOV_ADDRESS,
      pool: MaticAddresses.ALGEBRA_USDC_USDT,
      asset: MaticAddresses.USDC_TOKEN,
      vaultName: 'TetuV2_Algebra_USDC_USDT',
      converter: MaticAddresses.TETU_CONVERTER,
      profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.dQUICK_TOKEN, MaticAddresses.WMATIC_TOKEN,],
      swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
      liquidatorPools: [
        // for production
        {
          pool: MaticAddresses.ALGEBRA_dQUICK_QUICK,
          swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
          tokenIn: MaticAddresses.dQUICK_TOKEN,
          tokenOut: MaticAddresses.QUICK_TOKEN,
        },
        {
          pool: MaticAddresses.ALGEBRA_USDC_QUICK,
          swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
          tokenIn: MaticAddresses.QUICK_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },

        // only for test to prevent 'TS-16 price impact'
        {
          pool: MaticAddresses.ALGEBRA_USDC_USDT,
          swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
          tokenIn: MaticAddresses.USDC_TOKEN,
          tokenOut: MaticAddresses.USDT_TOKEN,
        },
      ]
    });
  }

  static async buildKyberUsdtUsdc(signer: SignerWithAddress, signer2: SignerWithAddress): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildKyber({
      signer,
      signer2,
      gov: MaticAddresses.GOV_ADDRESS,
      pool: MaticAddresses.KYBER_USDC_USDT,
      asset: MaticAddresses.USDC_TOKEN,
      vaultName: 'TetuV2_Kyber_USDC_USDT',
      converter: MaticAddresses.TETU_CONVERTER,
      profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN,],
      swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
      liquidatorPools: [
        {
          pool: MaticAddresses.KYBER_USDC_USDT,
          swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
          tokenIn: MaticAddresses.USDC_TOKEN,
          tokenOut: MaticAddresses.USDT_TOKEN,
        },
        {
          pool: MaticAddresses.KYBER_KNC_USDC,
          swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
          tokenIn: MaticAddresses.KNC_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },
      ]
    });
  }
}