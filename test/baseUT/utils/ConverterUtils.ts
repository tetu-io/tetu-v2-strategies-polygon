import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {
  IBorrowManager__factory,
  IConverterController__factory, IPlatformAdapter__factory,
  ITetuConverter__factory
} from "../../../typechain";
import {getConverterAddress, getDForcePlatformAdapter} from "../../../scripts/utils/Misc";

export class ConverterUtils {

  /**
   * Disable DForce (because it reverts on repay after block advance)
   *
   * We can avoid disabling of DForce also by replacing DForce's price oracle by mocked version (same as in TetuConverter)
   * The mocked version returns not-zero prices after block advance.
   * @param signer
   */
  public static async disableDForce(signer: SignerWithAddress) {
    console.log('disableDForce...');
    await this.disablePlatformAdapter(signer, getDForcePlatformAdapter());
    console.log('disableDForce done.\n\n');
  }

  public static async disablePlatformAdapter(signer: SignerWithAddress, platformAdapter: string) {
    console.log(`disable ${platformAdapter}`);
    const tools = Addresses.getTools();
    const converter = ITetuConverter__factory.connect(getConverterAddress(), signer);
    const converterControllerAddr = await converter.controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const converterControllerGovernanceAddr = await converterController.governance();
    const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);
    const platformAdapterDForce = IPlatformAdapter__factory.connect(platformAdapter, converterControllerGovernance);
    await platformAdapterDForce.setFrozen(true);
    console.log(`disable ${platformAdapter} done.\n\n`);
  }
}
