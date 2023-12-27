import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

import {IPlatformAdapter__factory} from "../../../typechain";
import {LendingPlatformKinds} from "./ConverterConstants";

export class ConverterAdaptersHelper {
  static async getPlatformAdapterName(signer: SignerWithAddress, address: string): Promise<string> {
    const platformKind = await (IPlatformAdapter__factory.connect(address, signer)).platformKind() as LendingPlatformKinds;
    switch (platformKind) {
      case LendingPlatformKinds.DFORCE_1: return "dforce";
      case LendingPlatformKinds.AAVE2_2: return "aave2";
      case LendingPlatformKinds.AAVE3_3: return "aave3";
      case LendingPlatformKinds.HUNDRED_FINANCE_4: return "hundred-finance";
      case LendingPlatformKinds.COMPOUND3_5: return "compound";
      default: return "?";
    }
  }
}
