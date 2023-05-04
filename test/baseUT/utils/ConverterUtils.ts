import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { DeployerUtilsLocal } from '../../../scripts/utils/DeployerUtilsLocal';
import {
  BorrowManager, BorrowManager__factory,
  ConverterController__factory, IBorrowManager,
  IBorrowManager__factory,
  IConverterController__factory,
  IPlatformAdapter__factory, ITetuConverter,
  ITetuConverter__factory,
  TetuConverter__factory
} from '../../../typechain';
import {
  getAaveThreePlatformAdapter, getAaveTwoPlatformAdapter,
  getConverterAddress,
  getDForcePlatformAdapter,
  Misc,
} from '../../../scripts/utils/Misc';
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class ConverterUtils {

  public static async whitelist(adrs: string[], converterAddress?: string) {
    const signer = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);
    const converterControllerAddr = await TetuConverter__factory.connect(converterAddress || getConverterAddress(), signer).controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const converterControllerGovernanceAddr = await converterController.governance();
    const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);

    const contrl = ConverterController__factory.connect(converterControllerAddr, converterControllerGovernance);

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

  public static async disableAaveV3(signer: SignerWithAddress) {
    console.log('disableAaveV3...');
    await this.disablePlatformAdapter(signer, getAaveThreePlatformAdapter());
    console.log('disableAaveV3 done.\n\n');
  }

  public static async disableAaveV2(signer: SignerWithAddress) {
    console.log('disableAaveV2...');
    await this.disablePlatformAdapter(signer, getAaveTwoPlatformAdapter());
    console.log('disableAaveV2 done.\n\n');
  }

  public static async disablePlatformAdapter(signer: SignerWithAddress, platformAdapter: string, converterAddress?: string) {
    console.log(`disable ${platformAdapter}`);
    const tools = Addresses.getTools();
    const converter = TetuConverter__factory.connect(converterAddress || getConverterAddress(), signer);
    const converterControllerAddr = await converter.controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const converterControllerGovernanceAddr = await converterController.governance();
    const converterControllerGovernance = await DeployerUtilsLocal.impersonate(converterControllerGovernanceAddr);
    const platformAdapterDForce = IPlatformAdapter__factory.connect(platformAdapter, converterControllerGovernance);
    await platformAdapterDForce.setFrozen(true);
    console.log(`disable ${platformAdapter} done.\n\n`);
  }

  /**
   * set up health factors in tetu converter
   * set min health factor 1.02
   * for dai and usdt set target health factor = 1.05
   */
  public static async setTetConverterHealthFactors(signer: SignerWithAddress, tetuConverter: string) {
    const controllerAddress = await ITetuConverter__factory.connect(tetuConverter, signer).controller();
    const controller = IConverterController__factory.connect(controllerAddress, signer);
    const governance = await controller.governance();
    const controllerAsGovernance = IConverterController__factory.connect(
      controllerAddress,
      await Misc.impersonate(governance),
    );

    const borrowManagerAddress = await controller.borrowManager();
    await controllerAsGovernance.setMinHealthFactor2(102);
    const borrowManagerAsGovernance = IBorrowManager__factory.connect(
      borrowManagerAddress,
      await Misc.impersonate(governance),
    );

    await controllerAsGovernance.setTargetHealthFactor2(112);
    await borrowManagerAsGovernance.setTargetHealthFactors(
      [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN, MaticAddresses.USDT_TOKEN],
      [112, 112, 112],
    );
  }

  /**
   * Set pause ON/OFF (disable/enable new borrows)
   */
  public static async setTetuConverterPause(signer: SignerWithAddress, tetuConverter: string, paused: boolean) {
    const controllerAddress = await ITetuConverter__factory.connect(tetuConverter, signer).controller();
    const controller = ConverterController__factory.connect(controllerAddress, signer);
    const governance = await controller.governance();
    const controllerAsGovernance = controller.connect(await Misc.impersonate(governance));
    await controllerAsGovernance.setPaused(paused);
  }

  /**
   * Add {borrower} to white list of tetuController
   */
  public static async addToWhitelist(signer: SignerWithAddress, tetuConverter: string, borrower: string) {
    const controllerAddress = await ITetuConverter__factory.connect(tetuConverter, signer).controller();
    const controller = ConverterController__factory.connect(controllerAddress, signer);
    const governance = await controller.governance();
    const controllerAsGovernance = controller.connect(await Misc.impersonate(governance));
    await controllerAsGovernance.setWhitelistValues([borrower], true);
  }

  public static async getBorrowManager(signer: SignerWithAddress, tetuConverter: string): Promise<BorrowManager> {
    const controllerAddress = await ITetuConverter__factory.connect(tetuConverter, signer).controller();
    const controller = ConverterController__factory.connect(controllerAddress, signer);
    return BorrowManager__factory.connect(
      await controller.borrowManager(),
      signer
    );
  }
}
