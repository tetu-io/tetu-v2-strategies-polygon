import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { DeployerUtilsLocal } from '../../../scripts/utils/DeployerUtilsLocal';
import {
  ConverterController__factory,
  IConverterController__factory,
  IPlatformAdapter__factory,
  TetuConverter__factory,
} from '../../../typechain';
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter,
  Misc,
} from '../../../scripts/utils/Misc';
import { MaticAddresses } from '../../../scripts/addresses/MaticAddresses';

export class ConverterUtils {

  public static async whitelist(adrs: string[]) {
    const signer = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);
    const converterControllerAddr = await TetuConverter__factory.connect(getConverterAddress(), signer).controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const converterControllerGovernanceAddr = await converterController.governance();
    const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);

    const contrl = ConverterController__factory.connect(getConverterAddress(), converterControllerGovernance);

    await contrl.setWhitelistValues(adrs, true);
  }

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

  public static async disableHf(signer: SignerWithAddress) {
    console.log('disableHf...');
    await this.disablePlatformAdapter(signer, getHundredFinancePlatformAdapter());
    console.log('disableHf done.\n\n');
  }

  public static async disablePlatformAdapter(signer: SignerWithAddress, platformAdapter: string) {
    console.log(`disable ${platformAdapter}`);
    const tools = Addresses.getTools();
    const converter = TetuConverter__factory.connect(getConverterAddress(), signer);
    const converterControllerAddr = await converter.controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const converterControllerGovernanceAddr = await converterController.governance();
    const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);
    const platformAdapterDForce = IPlatformAdapter__factory.connect(platformAdapter, converterControllerGovernance);
    await platformAdapterDForce.setFrozen(true);
    console.log(`disable ${platformAdapter} done.\n\n`);
  }

  /*  public static async disableAaveV2(signer: SignerWithAddress) {
   console.log('disableAaveV2...');
   const tools = Addresses.getTools();
   const converter = ITetuConverter__factory.connect(getConverterAddress(), signer);
   const converterControllerAddr = await converter.controller();
   const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
   const converterControllerGovernanceAddr = await converterController.governance();
   const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);
   const platformAdapterDForce = IPlatformAdapter__factory.connect(getAaveV2PlatformAdapter(), converterControllerGovernance);
   await platformAdapterDForce.setFrozen(true);
   console.log('disableAaveV2 done.\n\n');
   }

   public static async disableAaveV3(signer: SignerWithAddress) {
   console.log('disableAaveV3...');
   const tools = Addresses.getTools();
   const converter = ITetuConverter__factory.connect(getConverterAddress(), signer);
   const converterControllerAddr = await converter.controller();
   const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
   const converterControllerGovernanceAddr = await converterController.governance();
   const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);
   const platformAdapterDForce = IPlatformAdapter__factory.connect(getAaveV3PlatformAdapter(), converterControllerGovernance);
   await platformAdapterDForce.setFrozen(true);
   console.log('disableAaveV3 done.\n\n');
   }*/
}
