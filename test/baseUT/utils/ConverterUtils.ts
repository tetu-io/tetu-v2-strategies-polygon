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
  public static async disableDForce(signer: SignerWithAddress): Promise<string> {
    console.log('disableDForce...');
    const platformAdapterAddress = await getDForcePlatformAdapter(signer);
    await this.disablePlatformAdapter(signer, platformAdapterAddress);
    console.log('disableDForce done.\n\n');
    return platformAdapterAddress;
  }

  public static async disableAaveV3(signer: SignerWithAddress): Promise<string> {
    console.log('disableAaveV3...');
    const platformAdapterAddress = await getAaveThreePlatformAdapter(signer);
    await this.disablePlatformAdapter(signer, platformAdapterAddress);
    console.log('disableAaveV3 done.\n\n');
    return platformAdapterAddress;
  }

  public static async disableAaveV2(signer: SignerWithAddress): Promise<string> {
    console.log('disableAaveV2...');
    const platformAdapterAddress = await getAaveTwoPlatformAdapter(signer);
    await this.disablePlatformAdapter(signer, platformAdapterAddress);
    console.log('disableAaveV2 done.\n\n');
    return platformAdapterAddress;
  }

  public static async disablePlatformAdapter(signer: SignerWithAddress, platformAdapterAddr: string, converterAddress?: string) {
    console.log(`disable ${platformAdapterAddr}`);
    const converter = TetuConverter__factory.connect(converterAddress || getConverterAddress(), signer);
    const converterControllerAddr = await converter.controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const governance = await DeployerUtilsLocal.impersonate(await converterController.governance());
    const platformAdapter = IPlatformAdapter__factory.connect(platformAdapterAddr, governance);
    await platformAdapter.setFrozen(true);
    console.log(`disable ${platformAdapterAddr} done.\n\n`);
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
   * Add {borrower} to whitelist of tetuController
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
