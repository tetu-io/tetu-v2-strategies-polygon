import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {getConverterAddress, Misc} from "../../../scripts/utils/Misc";
import {
  BorrowManager,
  BorrowManager__factory,
  ControllerV2__factory,
  ConverterController__factory,
  ConverterStrategyBase__factory,
  TetuConverter__factory
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ConverterUtils} from "../utils/ConverterUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {CustomConverterDeployHelper} from "../converter/CustomConverterDeployHelper";

/** Utils to replace currently deployed implementation of contracts by most recent versions */
export class InjectUtils {
  /**
   * Deploy new implementation of TetuConverter-contract and upgrade proxy
   */
  static async injectTetuConverter(signer: SignerWithAddress) {
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const tetuConverter = getConverterAddress();
    const converterController = await TetuConverter__factory.connect(tetuConverter, signer).controller();
    const debtMonitor = await ConverterController__factory.connect(converterController, signer).debtMonitor();
    const borrowManager = await ConverterController__factory.connect(converterController, signer).borrowManager();

    const converterLogic = await DeployerUtils.deployContract(signer, "TetuConverter");
    const debtMonitorLogic = await DeployerUtils.deployContract(signer, "DebtMonitor");
    const borrowManagerLogic = await DeployerUtils.deployContract(signer, "BorrowManager");
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade(
      [tetuConverter, debtMonitor, borrowManager],
      [converterLogic.address, debtMonitorLogic.address, borrowManagerLogic.address]
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

  /** Disable currently deployed pool/platform adapters for AAVE3, deploy and register new versions */
  static async redeployAave3PoolAdapters(signer: SignerWithAddress) {
    const tetuConverter = getConverterAddress();
    const controller = await TetuConverter__factory.connect(tetuConverter, signer).controller();
    const converterGovernance = await Misc.impersonate(
      await ConverterController__factory.connect(controller, signer).governance()
    );
    const borrowManager = BorrowManager__factory.connect(
      await ConverterController__factory.connect(controller, signer).borrowManager(),
      converterGovernance
    );

    // freeze current version of AAVE3 pool adapter
    const oldPlatformAdapterAave3 = await ConverterUtils.disableAaveV3(signer);

    // unregister all asset pairs for AAVE3 pool adapter
    const countPairs = (await borrowManager.platformAdapterPairsLength(oldPlatformAdapterAave3)).toNumber();
    const pairs: BorrowManager.AssetPairStructOutput[] = [];
    for (let i = 0; i < countPairs; ++i) {
      const pair = await borrowManager.platformAdapterPairsAt(oldPlatformAdapterAave3, i);
      pairs.push(pair);
    }

    // create new platform adapter for AAVE3
    const converterNormal = await CustomConverterDeployHelper.createAave3PoolAdapter(signer);
    const converterEMode = await CustomConverterDeployHelper.createAave3PoolAdapterEMode(signer);
    const platformAdapter = await CustomConverterDeployHelper.createAave3PlatformAdapter(
      signer,
      controller,
      MaticAddresses.AAVE3_POOL,
      converterNormal.address,
      converterEMode.address,
    );

    // register all pairs with new platform adapter
    await borrowManager.addAssetPairs(
      platformAdapter.address,
      pairs.map(x => x.assetLeft),
      pairs.map(x => x.assetRight)
    );
  }
}