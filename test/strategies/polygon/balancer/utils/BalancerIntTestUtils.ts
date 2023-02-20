import {
  BalancerComposableStableStrategy__factory, ControllerV2,
  ControllerV2__factory,
  IBorrowManager__factory, IController__factory,
  IConverterController__factory, IStrategyV2, ITetuConverter__factory, StrategyBaseV2__factory, VaultFactory__factory
} from "../../../../../typechain";
import {Misc} from "../../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../../scripts/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../../../scripts/utils/DeployerUtilsLocal";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {BigNumber} from "ethers";

export interface ISetThresholdsInputParams {
  reinvestThresholdPercent?: number;
  rewardLiquidationThresholds?: {
    asset: string,
    threshold: BigNumber
  }[];
}

/**
 * Utils for integration tests of BalancerComposableStableStrategy
 */
export class BalancerIntTestUtils {
  /**
   * set up health factors in tetu converter
   * set min health factor 1.02
   * for dai and usdt set target health factor = 1.05
   */
  static async setTetConverterHealthFactors(signer: SignerWithAddress, tetuConverter: string) {
    const controllerAddress = await ITetuConverter__factory.connect(tetuConverter, signer).controller();
    const controller = IConverterController__factory.connect(controllerAddress, signer);
    const governance = await controller.governance();
    const controllerAsGovernance = IConverterController__factory.connect(
      controllerAddress,
      await Misc.impersonate(governance)
    );

    const borrowManagerAddress = await controller.borrowManager();
    await controllerAsGovernance.setMinHealthFactor2(102);
    const borrowManagerAsGovernance = IBorrowManager__factory.connect(
      borrowManagerAddress,
      await Misc.impersonate(governance)
    );

    await controllerAsGovernance.setTargetHealthFactor2(112);
    await borrowManagerAsGovernance.setTargetHealthFactors(
      [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN, MaticAddresses.USDT_TOKEN],
      [112, 112, 112]
    );
  }

  /**
   * deploy own splitter to be able to add console messages to the splitter
   */
  static async deployAndSetCustomSplitter(signer: SignerWithAddress, core: CoreAddresses) {
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2')
    await VaultFactory__factory.connect(
      core.vaultFactory,
      await DeployerUtilsLocal.getControllerGovernance(signer)
    ).setSplitterImpl(splitterImpl.address);
  }

  /**
   * Set reinvest and reward-liquidation thresholds
   */
  static async setThresholds(
    strategy: IStrategyV2,
    user: SignerWithAddress,
    params?: ISetThresholdsInputParams
  ) {
    const controller = await StrategyBaseV2__factory.connect(strategy.address, user).controller();
    const platformVoter = await IController__factory.connect(controller, user).platformVoter();
    const strategyAsPlatformVoter = await StrategyBaseV2__factory.connect(
      strategy.address,
      await Misc.impersonate(platformVoter)
    );

    const controllerAsUser = await ControllerV2__factory.connect(controller, user);
    const operators = await controllerAsUser.operatorsList();
    const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(
      strategyAsPlatformVoter.address,
      await Misc.impersonate(operators[0])
    );
    if (params?.rewardLiquidationThresholds) {
      for (const p of params?.rewardLiquidationThresholds) {
        await strategyAsOperator.setLiquidationThreshold(p.asset, p.threshold);
      }
    }

    if (params?.reinvestThresholdPercent) {
      await strategyAsOperator.setReinvestThresholdPercent(params.reinvestThresholdPercent); // 100_000 / 100
    }
  }
}