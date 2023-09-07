import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {getConverterAddress, Misc} from "../../../scripts/utils/Misc";
import {
  ControllerV2__factory,
  ConverterController__factory,
  ConverterStrategyBase__factory,
  TetuConverter__factory
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";

export class InjectUtils {
  /**
   * Deploy new implementation of TetuConverter-contract and upgrade proxy
   */
  static async injectTetuConverter(signer: SignerWithAddress) {
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const tetuConverter = getConverterAddress();
    const debtMonitor = await ConverterController__factory.connect(
      await TetuConverter__factory.connect(tetuConverter, signer).controller(),
      signer
    ).debtMonitor();

    const converterLogic = await DeployerUtils.deployContract(signer, "TetuConverter");
    const debtMonitorLogic = await DeployerUtils.deployContract(signer, "DebtMonitor");
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade(
      [tetuConverter, debtMonitor],
      [converterLogic.address, debtMonitorLogic.address]
    );
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([tetuConverter, debtMonitor]);
  }

  /**
   * Deploy new implementation of the given strategy and upgrade proxy
   */
  static async injectStrategy(
    signer: SignerWithAddress,
    strategyProxy: string,
    contractName: string
  ) {
    const strategyLogic = await DeployerUtils.deployContract(signer, contractName);
    const controller = ControllerV2__factory.connect(
      await ConverterStrategyBase__factory.connect(strategyProxy, signer).controller(),
      signer
    );
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.removeProxyAnnounce(strategyProxy);
    await controllerAsGov.announceProxyUpgrade([strategyProxy], [strategyLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([strategyProxy]);
  }
}