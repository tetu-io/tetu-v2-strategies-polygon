import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IKeomComptroller__factory, IKeomPriceOracle__factory} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export class KeomUtils {
  public static async disableHeartbeatZkEvm(signer: SignerWithAddress, comptrollerAddress: string) {
    console.log("disableHeartbeatZkEvm");
    const comptroller = IKeomComptroller__factory.connect(comptrollerAddress, signer);
    const oracle = await comptroller.oracle();
    const priceOracle = IKeomPriceOracle__factory.connect(oracle, signer);
    const owner = await priceOracle.owner();
    const markets = await comptroller.getAllMarkets();
    for (const kToken of markets) {
      if (kToken) {
        await priceOracle.connect(await Misc.impersonate(owner)).setHeartbeat(kToken, parseUnits("1", 27));
      }
    }
  }

  public static getKToken(asset: string): string {
    switch (asset.toLowerCase()) {
      case ZkevmAddresses.USDC_TOKEN: return ZkevmAddresses.KEOM_USDC;
      case ZkevmAddresses.USDT_TOKEN: return ZkevmAddresses.KEOM_USDT;
      case ZkevmAddresses.MATIC_TOKEN: return ZkevmAddresses.KEOM_MATIC;
      case ZkevmAddresses.WETH_TOKEN: return ZkevmAddresses.KEOM_WETH;
      case ZkevmAddresses.WBTC_TOKEN: return ZkevmAddresses.KEOM_WBTC;
      default: throw Error(`KeomUtils.getKTokens: unknown asset ${asset}`);
    }
  }
}