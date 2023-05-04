import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class ConverterAdaptersHelper {
  static getPlatformAdapterName(address: string): string {
    switch (address.toLowerCase()) {
      case MaticAddresses.TETU_CONVERTER_AAVE2_PLATFORM_ADAPTER.toLowerCase(): return "aave2";
      case MaticAddresses.TETU_CONVERTER_COMPOUND_PLATFORM_ADAPTER.toLowerCase(): return "compound";
      case MaticAddresses.TETU_CONVERTER_AAVE3_PLATFORM_ADAPTER.toLowerCase(): return "aave3";
      case MaticAddresses.TETU_CONVERTER_DFORCE_PLATFORM_ADAPTER.toLowerCase(): return "dforce";
      default: return "?";
    }
  }
}
