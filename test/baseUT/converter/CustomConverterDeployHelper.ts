import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {
  Aave3PlatformAdapter,
  Aave3PoolAdapter,
  Aave3PoolAdapterEMode, AaveTwoPlatformAdapter, AaveTwoPoolAdapter,
  IConverterController__factory, MoonwellPlatformAdapter, MoonwellPoolAdapter
} from "../../../typechain";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";

/**
 * To use this class it's necessary to uncomment adapters in Converter.sol file.
 * Usually we don't need to deploy converter manually, so by default they are commented out.
 */
export class CustomConverterDeployHelper {
//region AAVE.v3
  public static async createAave3PlatformAdapter(
    signer: SignerWithAddress,
    converterController: string,
    poolAave: string,
    templateAdapterNormal: string,
    templateAdapterEMode: string,
    borrowManager?: string,
  ) : Promise<Aave3PlatformAdapter> {
    return (await DeployerUtils.deployContract(
      signer,
      "Aave3PlatformAdapter",
      converterController,
      borrowManager || await IConverterController__factory.connect(converterController, signer).borrowManager(),
      poolAave,
      templateAdapterNormal,
      templateAdapterEMode
    )) as Aave3PlatformAdapter;
  }

  public static async createAave3PoolAdapter(signer: SignerWithAddress) : Promise<Aave3PoolAdapter> {
    return (await DeployerUtils.deployContract(signer, "Aave3PoolAdapter")) as Aave3PoolAdapter;
  }
  public static async createAave3PoolAdapterEMode(signer: SignerWithAddress) : Promise<Aave3PoolAdapterEMode> {
    return (await DeployerUtils.deployContract(signer, "Aave3PoolAdapterEMode")) as Aave3PoolAdapterEMode;
  }
//endregion AAVE.v3

//region AAVE.TWO
  public static async createAaveTwoPlatformAdapter(
    signer: SignerWithAddress,
    converterController: string,
    poolAave: string,
    templateAdapterNormal: string,
    borrowManager?: string,
  ) : Promise<AaveTwoPlatformAdapter> {
    return (await DeployerUtils.deployContract(
      signer,
      "AaveTwoPlatformAdapter",
      converterController,
      borrowManager || await IConverterController__factory.connect(converterController, signer).borrowManager(),
      poolAave,
      templateAdapterNormal,
    )) as AaveTwoPlatformAdapter;
  }

  public static async createAaveTwoPoolAdapter(signer: SignerWithAddress) : Promise<AaveTwoPoolAdapter> {
    return (await DeployerUtils.deployContract(signer, "AaveTwoPoolAdapter")) as AaveTwoPoolAdapter;
  }
//endregion AAVE.TWO

//region Moonwell (base-chain)
  public static async createMoonwellPlatformAdapter(
    signer: SignerWithAddress,
    converterController: string,
    templateAdapterNormal: string,
    comptroller?: string,
  ) : Promise<MoonwellPlatformAdapter> {
    return (await DeployerUtils.deployContract(
      signer,
      "MoonwellPlatformAdapter",
      converterController,
      comptroller ?? BaseAddresses.MOONWELL_COMPTROLLER,
      templateAdapterNormal,
      [
        BaseAddresses.MOONWELL_USDC,
        BaseAddresses.MOONWELL_DAI,
        BaseAddresses.MOONWELL_CBETH,
        BaseAddresses.MOONWELL_WETH,
        BaseAddresses.MOONWELL_USDBC
      ]
    )) as MoonwellPlatformAdapter;
  }

  public static async createMoonwellPoolAdapter(signer: SignerWithAddress) : Promise<MoonwellPoolAdapter> {
    return (await DeployerUtils.deployContract(signer, "MoonwellPoolAdapter")) as MoonwellPoolAdapter;
  }
//endregion Moonwell (base-chain)

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

}