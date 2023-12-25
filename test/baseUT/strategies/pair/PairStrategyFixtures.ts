/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {IBuilderResults, IStrategyCustomizationParams, PairBasedStrategyBuilder} from "./PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_PANCAKE, PLATFORM_UNIV3} from "../AppPlatforms";
import {MockSwapper} from "../../../../typechain";
import {BASE_NETWORK_ID, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../utils/HardhatUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

interface IBuildPairStrategyParams {
  notUnderlying?: string; // default is MaticAddresses.USDT_TOKEN
  kyberPid?: number; // default is undefined
  customParams?: IStrategyCustomizationParams
}

export class PairStrategyFixtures {
  static async buildPairStrategyUsdcXXX(
    chainId: number,
    strategyName: string,
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IBuildPairStrategyParams
  ): Promise<IBuilderResults> {
    if (chainId === POLYGON_NETWORK_ID) {
      const notUnderlying = p?.notUnderlying ?? MaticAddresses.USDT_TOKEN;
      switch (strategyName) {
        case PLATFORM_UNIV3:
          switch (notUnderlying) {
            case MaticAddresses.USDT_TOKEN:
              return this.buildUniv3UsdtUsdc(signer, signer2, chainId, p?.customParams,);
            case MaticAddresses.WETH_TOKEN:
              return this.buildUniv3UsdcWeth(signer, signer2, p?.customParams,);
            case MaticAddresses.WMATIC_TOKEN:
              return this.buildUniv3WmaticUsdc(signer, signer2, p?.customParams,);
            default:
              throw Error(`univ3-buildStrategy doesn't support ${notUnderlying}`);
          }
        case PLATFORM_ALGEBRA:
          return this.buildAlgebraUsdtUsdc(signer, signer2, p?.customParams,);
        case PLATFORM_KYBER:
          return this.buildKyberUsdtUsdc(signer, signer2, p?.customParams, p?.kyberPid);
        default:
          throw Error(`buildStrategy doesn't support ${strategyName}`);
      }
    } else if (chainId === BASE_NETWORK_ID) {
      switch (strategyName) {
        case PLATFORM_PANCAKE:
          return this.buildPancakeUsdtUsdcBaseChain(signer, signer2, p?.customParams,);
        default:
          throw Error(`buildStrategy doesn't support ${strategyName}`);
      }
    } else if (chainId === ZKEVM_NETWORK_ID) {
      switch (strategyName) {
        case PLATFORM_PANCAKE:
          return this.buildPancakeUsdtUsdcZkEvm(signer, signer2, p?.customParams,);
        default:
          throw Error(`buildStrategy doesn't support ${strategyName}`);
      }
    } else {
      throw Error(`buildPairStrategyUsdcXXX doesn't support chain ${chainId}`);
    }
  }

//region Polygon
  static async buildUniv3UsdtUsdc(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    chainId: number,
    p?: IStrategyCustomizationParams
  ): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildUniv3(
      {
        signer,
        signer2,
        gov: MaticAddresses.GOV_ADDRESS,
        pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        asset: MaticAddresses.USDC_TOKEN,
        vaultName: 'TetuV2_UniswapV3_USDC-USDT-0.01%',
        converter: MaticAddresses.TETU_CONVERTER,
        profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN],
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        quoter: MaticAddresses.UNISWAPV3_QUOTER,

        liquidatorPools: [{
          pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
          swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          tokenIn: MaticAddresses.USDC_TOKEN,
          tokenOut: MaticAddresses.USDT_TOKEN,
        },],

        ...p
      },
      chainId
    );
  }

  static async buildUniv3WmaticUsdc(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IStrategyCustomizationParams
  ): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildUniv3(
      {
        signer,
        signer2,
        gov: MaticAddresses.GOV_ADDRESS,
        pool: MaticAddresses.UNISWAPV3_WMATIC_USDC_500,
        asset: MaticAddresses.USDC_TOKEN,
        vaultName: 'TetuV2_UniswapV3_WMATIC_USDC-0.05%',
        converter: MaticAddresses.TETU_CONVERTER,
        profitHolderTokens: [MaticAddresses.WMATIC_TOKEN, MaticAddresses.USDC_TOKEN],
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        quoter: MaticAddresses.UNISWAPV3_QUOTER,

        liquidatorPools: [{
          pool: MaticAddresses.UNISWAPV3_WMATIC_USDC_500,
          swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          tokenIn: MaticAddresses.WMATIC_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },],

        ...p
      },
      POLYGON_NETWORK_ID
    );
  }

  static async buildUniv3UsdcWeth(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IStrategyCustomizationParams
  ): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildUniv3(
      {
        signer,
        signer2,
        gov: MaticAddresses.GOV_ADDRESS,
        pool: MaticAddresses.UNISWAPV3_USDC_WETH_500,
        asset: MaticAddresses.USDC_TOKEN,
        vaultName: 'TetuV2_UniswapV3_USDC-WETH-0.05%',
        converter: MaticAddresses.TETU_CONVERTER,
        profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.WETH_TOKEN],
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        quoter: MaticAddresses.UNISWAPV3_QUOTER,

        liquidatorPools: [{
          pool: MaticAddresses.UNISWAPV3_USDC_WETH_500,
          swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          tokenIn: MaticAddresses.USDC_TOKEN,
          tokenOut: MaticAddresses.WETH_TOKEN,
        },],

        ...p
      },
      POLYGON_NETWORK_ID
    );
  }

  static async buildAlgebraUsdtUsdc(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IStrategyCustomizationParams
  ): Promise<IBuilderResults> {
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
      quoter: MaticAddresses.ALGEBRA_QUOTER,
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
      ],
      ...p
    });
  }

  static async buildKyberUsdtUsdc(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IStrategyCustomizationParams,
    pid?: number
  ): Promise<IBuilderResults> {
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
      quoter: MaticAddresses.KYBER_ELASTIC_QUOTER_V2,
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
      ],
      ...p
    }, pid);
  }
//endregion Polygon

//region Base
  static async buildPancakeUsdtUsdcBaseChain(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IStrategyCustomizationParams
  ): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildPancake(
      {
        signer,
        signer2,
        gov: BaseAddresses.GOV_ADDRESS,
        pool: BaseAddresses.PANCAKE_POOL_USDC_USDbC_LP_100,
        asset: BaseAddresses.USDbC_TOKEN,
        vaultName: 'TetuV2_Pancake_USDC-USDbC-0.01%',
        converter: BaseAddresses.TETU_CONVERTER,
        profitHolderTokens: [BaseAddresses.USDC_TOKEN, BaseAddresses.USDbC_TOKEN, BaseAddresses.PANCAKE_SWAP_TOKEN],
        swapper: BaseAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
        quoter: BaseAddresses.PANCAKE_QUOTER_V2,

        liquidatorPools: [
          {
            pool: BaseAddresses.PANCAKE_POOL_USDC_USDbC_LP_100,
            swapper: BaseAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
            tokenIn: BaseAddresses.USDC_TOKEN,
            tokenOut: BaseAddresses.USDbC_TOKEN,
          }, {
            pool: BaseAddresses.PANCAKE_POOL_CAKE_WETH_10000,
            swapper: BaseAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
            tokenIn: BaseAddresses.PANCAKE_SWAP_TOKEN,
            tokenOut: BaseAddresses.WETH_TOKEN,
          }, {
            pool: BaseAddresses.PANCAKE_POOL_USDbC_ETH_LP_100,
            swapper: BaseAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
            tokenIn: BaseAddresses.USDbC_TOKEN,
            tokenOut: BaseAddresses.WETH_TOKEN,
          },
        ],

        ...p
      },
      BASE_NETWORK_ID,
      BaseAddresses.PANCAKE_MASTER_CHEF_V3,
    );
  }
//endregion Base

//region zkEvm
  static async buildPancakeUsdtUsdcZkEvm(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    p?: IStrategyCustomizationParams
  ): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildPancake(
      {
        signer,
        signer2,
        gov: ZkevmAddresses.GOV_ADDRESS,
        pool: ZkevmAddresses.PANCAKE_POOL_USDT_USDC_LP,
        asset: ZkevmAddresses.USDC_TOKEN,
        vaultName: 'TetuV2_Pancake_USDC-USDT-0.01%',
        converter: ZkevmAddresses.TETU_CONVERTER,
        profitHolderTokens: [ZkevmAddresses.USDC_TOKEN, ZkevmAddresses.USDT_TOKEN, ZkevmAddresses.PANCAKE_SWAP_TOKEN],
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
        quoter: ZkevmAddresses.PANCAKE_QUOTER_V2,

        liquidatorPools: [
          {
            pool: ZkevmAddresses.PANCAKE_POOL_USDT_USDC_LP,
            swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
            tokenIn: ZkevmAddresses.USDC_TOKEN,
            tokenOut: ZkevmAddresses.USDT_TOKEN,
          }, {
            pool: ZkevmAddresses.PANCAKE_POOL_CAKE_WETH_10000,
            swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
            tokenIn: ZkevmAddresses.PANCAKE_SWAP_TOKEN,
            tokenOut: ZkevmAddresses.WETH_TOKEN,
          }, {
            pool: ZkevmAddresses.PANCAKE_POOL_USDC_ETH_LP_500,
            swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
            tokenIn: ZkevmAddresses.USDC_TOKEN,
            tokenOut: ZkevmAddresses.WETH_TOKEN,
          },
        ],

        ...p
      },
      ZKEVM_NETWORK_ID,
      ZkevmAddresses.PANCAKE_MASTER_CHEF_V3
    );
  }
//endregion zkEvm
}
