import {ICoreTokens} from "./ICoreTokens";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";

export class BaseCoreTokensUtils {
  static getCore(): ICoreTokens {
    return {
      usdc: BaseAddresses.USDC_TOKEN,
      usdt: BaseAddresses.USDbC_TOKEN, // second stable coin on base, there is no USDT at this moment
      dai: BaseAddresses.DAI_TOKEN,
      weth: BaseAddresses.WETH_TOKEN,
    }
  }
}