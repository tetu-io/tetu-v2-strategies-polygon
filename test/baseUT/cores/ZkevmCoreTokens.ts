import {ICoreTokens} from "./ICoreTokens";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {ITetuLiquidator} from "../../../typechain";

export class ZkevmCoreTokensUtils {
  static getCore(): ICoreTokens {
    return {
      usdc: ZkevmAddresses.USDC_TOKEN,
      usdt: ZkevmAddresses.USDT_TOKEN,
      dai: ZkevmAddresses.DAI_TOKEN,
      weth: ZkevmAddresses.WETH_TOKEN,
      wmatic: ZkevmAddresses.MATIC_TOKEN,
      wbtc: ZkevmAddresses.WBTC_TOKEN
    }
  }

  static getLiquidatorPools(): ITetuLiquidator.PoolDataStruct[] {
    return [
      {
        pool: ZkevmAddresses.ALGEBRA_POOL_USDT_USDC,
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
        tokenIn: ZkevmAddresses.USDT_TOKEN,
        tokenOut: ZkevmAddresses.USDC_TOKEN,
      }, {
        pool: ZkevmAddresses.ALGEBRA_POOL_WETH_USDC,
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
        tokenIn: ZkevmAddresses.WETH_TOKEN,
        tokenOut: ZkevmAddresses.USDC_TOKEN,
      }, {
        pool: ZkevmAddresses.ALGEBRA_POOL_USDT_WETH,
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
        tokenIn: ZkevmAddresses.USDT_TOKEN,
        tokenOut: ZkevmAddresses.WETH_TOKEN,
      }, {
        pool: ZkevmAddresses.PANCAKE_POOL_CAKE_WETH_10000,
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
        tokenIn: ZkevmAddresses.PANCAKE_SWAP_TOKEN,
        tokenOut: ZkevmAddresses.WETH_TOKEN,
      }, {
        pool: ZkevmAddresses.PANCAKE_POOL_TETU_USDC_100,
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
        tokenIn: ZkevmAddresses.TETU_TOKEN,
        tokenOut: ZkevmAddresses.USDC_TOKEN,
      }
    ];
  }
}