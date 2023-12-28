import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ICoreTokens} from "./ICoreTokens";

export class MaticCoreTokensUtils {
  static getCore(): ICoreTokens {
    return {
      usdc: MaticAddresses.USDC_TOKEN,
      usdt: MaticAddresses.USDT_TOKEN,
      dai: MaticAddresses.DAI_TOKEN,
      weth: MaticAddresses.WETH_TOKEN,
      wmatic: MaticAddresses.WMATIC_TOKEN,
      wbtc: MaticAddresses.WBTC_TOKEN
    }
  }
}