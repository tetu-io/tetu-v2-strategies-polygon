import {ICoreTokens} from "./ICoreTokens";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";

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
}