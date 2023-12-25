import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IKeomComptroller__factory, IKeomPriceOracle__factory} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";

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
}