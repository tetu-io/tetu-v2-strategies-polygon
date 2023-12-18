import {ICoreTokens} from "./ICoreTokens";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";

export class ZkevmCoreTokensUtils {
  static getCore(): ICoreTokens {
    return {
      usdc: ZkevmAddresses.USDC,
      usdt: ZkevmAddresses.USDT,
      dai: ZkevmAddresses.DAI,
      weth: ZkevmAddresses.WETH,
      wmatic: ZkevmAddresses.MATIC,
      wbtc: ZkevmAddresses.WBTC
    }
  }
}