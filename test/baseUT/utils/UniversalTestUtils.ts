import {BigNumber, ContractReceipt, ContractTransaction} from "ethers";
import hre from "hardhat";
import {
  BalancerComposableStableStrategy__factory, ControllerV2__factory,
  IBalancerGauge__factory, IController__factory,
  IERC20__factory,
  ISplitter__factory, IStrategyV2,
  StrategyBaseV2__factory, TetuVaultV2
} from "../../../typechain";
import {MaticAddresses} from "../../../scripts/MaticAddresses";
import {writeFileSync} from "fs";
import {formatUnits} from "ethers/lib/utils";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal, IVaultStrategyInfo} from "../../../scripts/utils/DeployerUtilsLocal";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";

export interface IMakeStrategyDeployerInputParams {
  vaultName?: string;

  buffer?: number;
  depositFee?: number;
  withdrawFee?: number;
  wait?: boolean;
}

export interface IDistributedInfo {
  sender: string;
  incomeToken: string;
  queuedBalance: BigNumber;
  tetuValue: BigNumber;
  tetuBalance: BigNumber;
  toInvestFund: BigNumber;
  toGauges: BigNumber;
  toBribes: BigNumber;
}

/**
 * Utils for universal test
 */
export class UniversalTestUtils {
  static async makeStrategyDeployer(
    core: CoreAddresses,
    asset: string,
    tetuConverterAddress: string,
    strategyName: string,
    params?: IMakeStrategyDeployerInputParams
  ) : Promise<((signer: SignerWithAddress) => Promise<IVaultStrategyInfo>)> {
    return async (signer: SignerWithAddress) => {
      const controller = DeployerUtilsLocal.getController(signer);

      const strategyDeployer = async (splitterAddress: string) => {
        const strategyProxy = await DeployerUtils.deployProxy(signer, strategyName);
        const strategy = BalancerComposableStableStrategy__factory.connect(strategyProxy, signer);
        await strategy.init(core.controller, splitterAddress, tetuConverterAddress);
        return strategy as unknown as IStrategyV2;
      }

      const governance = await DeployerUtilsLocal.getControllerGovernance(signer);
      return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
        asset,
        params?.vaultName || "vault",
        strategyDeployer,
        controller,
        governance,
        params?.buffer || 100,
        params?.depositFee || 250,
        params?.withdrawFee || 500,
        params?.wait || false
      );
    }
  }

  static async setCompoundRatio(strategy: IStrategyV2, user: SignerWithAddress, compoundRate?: number) {
    if (compoundRate) {
      const controller = await StrategyBaseV2__factory.connect(strategy.address, user).controller();
      const platformVoter = await IController__factory.connect(controller, user).platformVoter();
      const strategyAsPlatformVoter = await StrategyBaseV2__factory.connect(
        strategy.address,
        await Misc.impersonate(platformVoter)
      );
      await strategyAsPlatformVoter.setCompoundRatio(compoundRate);
    }
  }

  /**
   * Move all available {asset} from balance of the {user} to {liquidator}
   */
  static async removeExcessTokens(asset: string, user: SignerWithAddress, liquidator: string) {
    const excessBalance = await TokenUtils.balanceOf(asset, user.address);
    if (!excessBalance.isZero()) {
      await TokenUtils.transfer(asset, user, liquidator, excessBalance.toString());
    }
  }

  /**
   * Finds event "LossCovered(lossValue)" in {tx}, returns {lossValue}
   */
  static async extractLossCovered(cr: ContractReceipt, vaultAddress: string) : Promise<BigNumber | undefined> {
    if (cr.events) {
      for (const event of cr.events) {
        if (event.address === vaultAddress) {
          if (event.event === "LossCovered") {
            if (event.args) {
              console.log("vault", vaultAddress);
              console.log("recoveredLoss", event.args[0]);
              return event.args[0];
            }
          }
        }
      }
    }
  }

  static async extractDistributed(cr: ContractReceipt, forwarder: string) : Promise<IDistributedInfo[]> {
    const dest: IDistributedInfo[] = [];
    if (cr.events) {
      for (const event of cr.events) {
        if (event.address === forwarder) {
          if (event.event === "Distributed") {
            if (event.args) {
              console.log("Distributed", event.args);
              dest.push({
                sender: event.args[0],
                incomeToken: event.args[1],
                queuedBalance: event.args[2],
                tetuValue: event.args[3],
                tetuBalance: event.args[4],
                toInvestFund: event.args[5],
                toGauges: event.args[6],
                toBribes: event.args[7]
              });
            }
          }
        }
      }
    }

    return dest;
  }

  static async getAnOperator(strategy: string, signer: SignerWithAddress) : Promise<SignerWithAddress> {
    const controller = await StrategyBaseV2__factory.connect(strategy, signer).controller();
    const controllerAsUser = await ControllerV2__factory.connect(controller, signer);
    const operators = await controllerAsUser.operatorsList();
    return Misc.impersonate(operators[0]);
  }
}