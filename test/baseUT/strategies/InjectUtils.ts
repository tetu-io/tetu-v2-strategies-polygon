import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {getConverterAddress, Misc} from "../../../scripts/utils/Misc";
import {
  Bookkeeper__factory,
  BorrowManager,
  BorrowManager__factory,
  ControllerV2__factory,
  ConverterController__factory,
  ConverterStrategyBase__factory, ProxyControlled,
  TetuConverter__factory
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ConverterUtils} from "../utils/ConverterUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {CustomConverterDeployHelper} from "../converter/CustomConverterDeployHelper";
import {RunHelper} from "../../../scripts/utils/RunHelper";

/** Utils to replace currently deployed implementation of contracts by most recent versions */
export class InjectUtils {
  /**
   * This function prepare exist instance of TetuConverter before each test
   * if such preparations are necessary. Don't remove injectTetuConverterBeforeAnyTest from tests,
   * just comment body of injectTetuConverterBeforeAnyTest if no preparations are required.
   */
  static async injectTetuConverterBeforeAnyTest(signer: SignerWithAddress) {
    await InjectUtils.injectTetuConverter(signer);
    await ConverterUtils.disableAaveV2(signer);
    await InjectUtils.redeployAave3PoolAdapters(signer);
  }

  static async injectTetuConverter(signer: SignerWithAddress) {


    // -------------------------------------------- Deploy new version of TetuConverter
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const tetuConverter = getConverterAddress();
    const converterController = await TetuConverter__factory.connect(tetuConverter, signer).controller();

    const debtMonitor = await ConverterController__factory.connect(converterController, signer).debtMonitor();
    const borrowManager = await ConverterController__factory.connect(converterController, signer).borrowManager();

    const converterControllerLogic = await DeployerUtils.deployContract(signer, "ConverterController");
    const converterLogic = await DeployerUtils.deployContract(signer, "TetuConverter");
    const debtMonitorLogic = await DeployerUtils.deployContract(signer, "DebtMonitor");
    const borrowManagerLogic = await DeployerUtils.deployContract(signer, "BorrowManager");
    const bookkeeperLogic = await DeployerUtils.deployContract(signer, "Bookkeeper");
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade(
      [converterController, tetuConverter, debtMonitor, borrowManager],
      [converterControllerLogic.address, converterLogic.address, debtMonitorLogic.address, borrowManagerLogic.address]
    );
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([converterController, tetuConverter, debtMonitor, borrowManager]);

    const converterGovernance = await Misc.impersonate(await ConverterController__factory.connect(converterController, signer).governance());
    const converterControllerAsGov = ConverterController__factory.connect(converterController, converterGovernance);

    const bookkeeperProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-converter/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    await RunHelper.runAndWait(() => bookkeeperProxy.initProxy(bookkeeperLogic.address));
    const bookkeeper = await Bookkeeper__factory.connect(bookkeeperProxy.address, signer);

    await bookkeeper.init(converterController);
    console.log("version", await converterControllerAsGov.CONVERTER_CONTROLLER_VERSION());
    await converterControllerAsGov.setBookkeeper(bookkeeper.address);

    // -------------------------------------------- Set up TetuConverter
    // const tetuConverter = getConverterAddress();
    // const converterController = await TetuConverter__factory.connect(tetuConverter, signer).controller();
    // const converterGovernance = await Misc.impersonate(await ConverterController__factory.connect(converterController, signer).governance());
    // const converterControllerAsGov = ConverterController__factory.connect(converterController, converterGovernance);
    // await converterControllerAsGov.setRebalanceOnBorrowEnabled(true);
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
    const operator = await Misc.impersonate((await controllerAsGov.operatorsList())[0]);

    await controllerAsGov.connect(operator).removeProxyAnnounce(strategyProxy);
    await controllerAsGov.announceProxyUpgrade([strategyProxy], [strategyLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.connect(operator).upgradeProxy([strategyProxy]);
  }

  static async injectStrategyWithDeployedLogic(signer: SignerWithAddress, strategyProxy: string, newLogic: string) {
    const controller = ControllerV2__factory.connect(
      await ConverterStrategyBase__factory.connect(strategyProxy, signer).controller(),
      signer
    );
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.removeProxyAnnounce(strategyProxy);
    await controllerAsGov.announceProxyUpgrade([strategyProxy], [newLogic]);
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

  static async redeployAaveTwoPoolAdapters(signer: SignerWithAddress) {
    const tetuConverter = getConverterAddress();
    const controller = await TetuConverter__factory.connect(tetuConverter, signer).controller();
    const converterGovernance = await Misc.impersonate(
      await ConverterController__factory.connect(controller, signer).governance()
    );
    const borrowManager = BorrowManager__factory.connect(
      await ConverterController__factory.connect(controller, signer).borrowManager(),
      converterGovernance
    );

    // freeze current version of AAVE2 pool adapter
    const oldPlatformAdapterAaveTwo = await ConverterUtils.disableAaveV2(signer);

    // unregister all asset pairs for AAVE2 pool adapter
    const countPairs = (await borrowManager.platformAdapterPairsLength(oldPlatformAdapterAaveTwo)).toNumber();
    const pairs: BorrowManager.AssetPairStructOutput[] = [];
    for (let i = 0; i < countPairs; ++i) {
      const pair = await borrowManager.platformAdapterPairsAt(oldPlatformAdapterAaveTwo, i);
      pairs.push(pair);
    }

    // create new platform adapter for AAVE2
    // const converterNormal = await CustomConverterDeployHelper.createAave3PoolAdapter(signer);
    // const converterEMode = await CustomConverterDeployHelper.createAave3PoolAdapterEMode(signer);
    // const platformAdapter = await CustomConverterDeployHelper.createAave3PlatformAdapter(
    //   signer,
    //   controller,
    //   MaticAddresses.AAVE3_POOL,
    //   converterNormal.address,
    //   converterEMode.address,
    // );

    // register all pairs with new platform adapter
    console.log("0xD0879ABD0f2EAFaBa07A0701cC1AD2f70e69a069");
    await borrowManager.addAssetPairs(
      "0xD0879ABD0f2EAFaBa07A0701cC1AD2f70e69a069", // platformAdapter.address,
      pairs.map(x => x.assetLeft),
      pairs.map(x => x.assetRight)
    );
  }
}