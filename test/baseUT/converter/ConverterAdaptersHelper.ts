import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class ConverterAdaptersHelper {
// //region AAVE.v3
//   public static async createAave3PlatformAdapter(
//     signer: SignerWithAddress,
//     controller: string,
//     poolAave: string,
//     templateAdapterNormal: string,
//     templateAdapterEMode: string,
//     borrowManager?: string,
//   ) : Promise<Aave3PlatformAdapter> {
//     return (await DeployerUtils.deployContract(
//       signer,
//       "Aave3PlatformAdapter",
//       controller,
//       borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
//       poolAave,
//       templateAdapterNormal,
//       templateAdapterEMode
//     )) as Aave3PlatformAdapter;
//   }
//
//   public static async createAave3PoolAdapter(signer: SignerWithAddress) : Promise<Aave3PoolAdapter> {
//     return (await DeployerUtils.deployContract(signer, "Aave3PoolAdapter")) as Aave3PoolAdapter;
//   }
//   public static async createAave3PoolAdapterEMode(signer: SignerWithAddress) : Promise<Aave3PoolAdapterEMode> {
//     return (await DeployerUtils.deployContract(signer, "Aave3PoolAdapterEMode")) as Aave3PoolAdapterEMode;
//   }
// //endregion AAVE.v2
//
// //region AAVE.TWO
//   public static async createAaveTwoPlatformAdapter(
//     signer: SignerWithAddress,
//     controller: string,
//     poolAave: string,
//     templateAdapterNormal: string,
//     borrowManager?: string,
//   ) : Promise<AaveTwoPlatformAdapter> {
//     return (await DeployerUtils.deployContract(
//       signer,
//       "AaveTwoPlatformAdapter",
//       controller,
//       borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
//       poolAave,
//       templateAdapterNormal,
//     )) as AaveTwoPlatformAdapter;
//   }
//
//   public static async createAaveTwoPoolAdapter(signer: SignerWithAddress) : Promise<AaveTwoPoolAdapter> {
//     return (await DeployerUtils.deployContract(signer, "AaveTwoPoolAdapter")) as AaveTwoPoolAdapter;
//   }
// //endregion AAVE.TWO
//
// //region dForce
//   public static async createDForcePlatformAdapter(
//     signer: SignerWithAddress,
//     controller: string,
//     comptroller: string,
//     templateAdapterNormal: string,
//     cTokensActive: string[],
//     borrowManager?: string,
//   ) : Promise<DForcePlatformAdapter> {
//     return (await DeployerUtils.deployContract(
//       signer,
//       "DForcePlatformAdapter",
//       controller,
//       borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
//       comptroller,
//       templateAdapterNormal,
//       cTokensActive,
//     )) as DForcePlatformAdapter;
//   }
//
//   public static async createDForcePoolAdapter(signer: SignerWithAddress) : Promise<DForcePoolAdapter> {
//     return (await DeployerUtils.deployContract(signer, "DForcePoolAdapter")) as DForcePoolAdapter;
//   }
// //endregion dForce

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
