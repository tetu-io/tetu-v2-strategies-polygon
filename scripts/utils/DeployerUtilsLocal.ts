import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import axios from "axios";
import {config as dotEnvConfig} from "dotenv";
import logSettings from "../../log_settings";
import {Logger} from "tslog";
import {MaticAddresses} from "../MaticAddresses";
import {
  ControllerV2__factory,
  IBribe,
  IBribe__factory,
  IController,
  IController__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IForwarder,
  IForwarder__factory,
  IGauge,
  IGauge__factory,
  IPlatformVoter,
  IPlatformVoter__factory,
  IStrategyV2,
  ITetuConverter,
  ITetuConverter__factory,
  ITetuLiquidator,
  ITetuLiquidator__factory,
  IVeDistributor,
  IVeDistributor__factory,
  IVeTetu,
  IVeTetu__factory,
  IVoter,
  IVoter__factory,
  Multicall,
  Multicall__factory,
  ProxyControlled__factory,
  StrategyDystopiaConverter__factory,
  StrategySplitterV2__factory,
  TetuVaultV2,
  TetuVaultV2__factory,
  VaultFactory,
  VaultFactory__factory
} from "../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {ICoreContractsWrapper} from "../../test/CoreContractsWrapper";
import {IToolsAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/ToolsAddresses";
import {IToolsContractsWrapper} from "../../test/ToolsContractsWrapper";
import {RunHelper} from "./RunHelper";
import {DeployerUtils} from "./DeployerUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
const log: Logger = new Logger(logSettings);


dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    networkScanKey: {
      type: "string",
    },
    vaultLogic: {
      type: "string",
      default: "0x9ED23756ECD0B9012E4D7ee807dA0E6Ec94A1a70"
    },
    splitterLogic: {
      type: "string",
      default: "0xC4c776e6D2bbae93Ed5acac6cFF35a5980F81845"
    },
  }).argv;

export interface IVaultStrategyInfo {
  vault: TetuVaultV2,
  strategy: IStrategyV2
}

export class DeployerUtilsLocal {

  // ************** VERIFY **********************

  public static async verify(address: string) {
    try {
      await hre.run("verify:verify", {
        address
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  public static async verifyImpl(signer: SignerWithAddress, proxyAddress: string) {
    const proxy = ProxyControlled__factory.connect(proxyAddress, signer);
    const address = await proxy.implementation();
    console.log('impl address', address);
    try {
      await hre.run("verify:verify", {
        address
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
    await this.verifyProxy(proxyAddress);
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithArgs(address: string, args: any[]) {
    try {
      await hre.run("verify:verify", {
        address, constructorArguments: args
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithContractName(address: string, contractPath: string, args?: any[]) {
    try {
      await hre.run("verify:verify", {
        address, contract: contractPath, constructorArguments: args
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }


  // tslint:disable-next-line:no-any
  public static async verifyImplWithContractName(signer: SignerWithAddress, proxyAddress: string, contractPath: string, args?: any[]) {
    const proxy = ProxyControlled__factory.connect(proxyAddress, signer);
    const address = await proxy.implementation();
    console.log('impl address', address);
    try {
      await hre.run("verify:verify", {
        address, contract: contractPath, constructorArguments: args
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
    await this.verifyProxy(proxyAddress);
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithArgsAndContractName(address: string, args: any[], contractPath: string) {
    try {
      await hre.run("verify:verify", {
        address, constructorArguments: args, contract: contractPath
      })
    } catch (e) {
      log.info('error verify ' + e);
    }
  }


  public static async verifyProxy(adr: string) {
    try {

      // const resp =
        await axios.post(
          (await DeployerUtilsLocal.getNetworkScanUrl()) +
          `?module=contract&action=verifyproxycontract&apikey=${argv.networkScanKey}`,
          `address=${adr}`);
      // log.info("proxy verify resp", resp.data);
    } catch (e) {
      log.info('error proxy verify ' + adr + e);
    }
  }

  // ************** ADDRESSES **********************

  public static async getNetworkScanUrl(): Promise<string> {
    const net = (await ethers.provider.getNetwork());
    if (net.name === 'ropsten') {
      return 'https://api-ropsten.etherscan.io/api';
    } else if (net.name === 'kovan') {
      return 'https://api-kovan.etherscan.io/api';
    } else if (net.name === 'rinkeby') {
      return 'https://api-rinkeby.etherscan.io/api';
    } else if (net.name === 'ethereum') {
      return 'https://api.etherscan.io/api';
    } else if (net.name === 'matic') {
      return 'https://api.polygonscan.com/api'
    } else if (net.chainId === 80001) {
      return 'https://api-testnet.polygonscan.com/api'
    } else if (net.chainId === 250) {
      return 'https://api.ftmscan.com//api'
    } else {
      throw Error('network not found ' + net);
    }
  }


  public static async getCoreAddresses(): Promise<CoreAddresses> {
    const net = await ethers.provider.getNetwork();
    log.info('network ' + net.chainId);
    const core = Addresses.CORE.get(net.chainId);
    if (!core) {
      throw Error('No config for ' + net.chainId);
    }
    return core;
  }

  public static getController(signer: SignerWithAddress): IController {
    const core = Addresses.getCore();
    return IController__factory.connect(core.controller, signer);
  }

  public static async getControllerGovernance(signer: SignerWithAddress): Promise<SignerWithAddress> {
    const controller = DeployerUtilsLocal.getController(signer);
    const govAddress = await controller.governance();
    return DeployerUtilsLocal.impersonate(govAddress);
  }

  public static async getCoreAddressesWrapper(signer: SignerWithAddress): Promise<ICoreContractsWrapper> {
    const net = await ethers.provider.getNetwork();
    log.info('network ' + net.chainId);
    const core = Addresses.CORE.get(net.chainId);
    if (!core) {
      throw Error('No config for ' + net.chainId);
    }

    return {
      tetu: IERC20__factory.connect(core.tetu, signer),
      controller: IController__factory.connect(core.controller, signer),
      ve: IVeTetu__factory.connect(core.ve, signer),
      veDist: IVeDistributor__factory.connect(core.veDist, signer),
      gauge: IGauge__factory.connect(core.gauge, signer),
      bribe: IBribe__factory.connect(core.bribe, signer),
      tetuVoter: IVoter__factory.connect(core.tetuVoter, signer),
      platformVoter: IPlatformVoter__factory.connect(core.platformVoter, signer),
      forwarder: IForwarder__factory.connect(core.forwarder, signer),
      vaultFactory: VaultFactory__factory.connect(core.vaultFactory, signer),
    };

  }

  public static async getToolsAddressesWrapper(signer: SignerWithAddress): Promise<IToolsContractsWrapper> {
    const net = await ethers.provider.getNetwork();
    log.info('network ' + net.chainId);
    const tools = Addresses.TOOLS.get(net.chainId);
    if (!tools) {
      throw Error('No config for ' + net.chainId);
    }
    return {
      liquidator: ITetuLiquidator__factory.connect(tools.liquidator, signer),
      converter: ITetuConverter__factory.connect(tools.converter, signer),
      multicall: Multicall__factory.connect(tools.multicall, signer),
    };

  }

  public static async getToolsAddresses(): Promise<IToolsAddresses> {
    const net = await ethers.provider.getNetwork();
    log.info('network ' + net.chainId);
    const tools = Addresses.TOOLS.get(net.chainId);
    if (!tools) {
      throw Error('No config for ' + net.chainId);
    }
    return tools;
  }

  /*
  public static async getTokenAddresses(): Promise<Map<string, string>> {
  const net = await ethers.provider.getNetwork();
  log.info('network ' + net.chainId);
  const mocks = Addresses.TOKENS.get(net.chainId + '');
  if (!mocks) {
    throw Error('No config for ' + net.chainId);
  }
  return mocks;
}
*/

  public static async getGovernance() {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.GOV_ADDRESS;
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async impersonate(address: string | null = null) {
    if (address === null) {
      address = await DeployerUtilsLocal.getGovernance();
    }
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [address],
    });

    await hre.network.provider.request({
      method: "hardhat_setBalance",
      params: [address, "0x1431E0FAE6D7217CAA0000000"],
    });
    console.log('address impersonated', address);
    return ethers.getSigner(address || '');
  }

  public static async getDefaultNetworkFactory() {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.QUICK_FACTORY;
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async getUSDCAddress() {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.USDC_TOKEN;
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async getNetworkTokenAddress() {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.WMATIC_TOKEN;
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async getTETUAddress() {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.TETU_TOKEN;
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async getBlueChips() {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.BLUE_CHIPS;
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async isBlueChip(address: string): Promise<boolean> {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.BLUE_CHIPS.has(address.toLowerCase())
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async getRouterByFactory(_factory: string) {
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 137) {
      return MaticAddresses.getRouterByFactory(_factory);
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

  public static async isNetwork(id: number) {
    return (await ethers.provider.getNetwork()).chainId === id;
  }

  public static async getStorageAt(address: string, index: string) {
    return ethers.provider.getStorageAt(address, index);
  }

  public static async setStorageAt(address: string, index: string, value: string) {
    await ethers.provider.send("hardhat_setStorageAt", [address, index, value]);
    await ethers.provider.send("evm_mine", []); // Just mines to the next block
  }

  // ****************** WAIT ******************

  public static async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static async wait(blocks: number) {
    if (hre.network.name === 'hardhat') {
      return;
    }
    const start = ethers.provider.blockNumber;
    while (true) {
      log.info('wait 10sec');
      await DeployerUtilsLocal.delay(10000);
      if (ethers.provider.blockNumber >= start + blocks) {
        break;
      }
    }
  }

  public static async deployAndInitVaultAndStrategy<T>(
    asset: string,
    vaultName: string,
    strategyDeployer: (splitterAddress: string) => Promise<IStrategyV2>,
    controller: IController,
    signer: SignerWithAddress,
    buffer = 0,
    depositFee = 0,
    withdrawFee = 0,
    wait = false
  ): Promise<IVaultStrategyInfo> {
    console.log('deployAndInitVaultAndStrategy', vaultName);
    const core = Addresses.getCore();
    const vault = await DeployerUtilsLocal.deployAndInitVault(
      asset, vaultName, controller, signer, buffer, depositFee, withdrawFee, wait);

    const splitterAddress = await vault.splitter();
    const splitter = StrategySplitterV2__factory.connect(splitterAddress, signer);

    const gauge = IGauge__factory.connect(core.gauge, signer);
    await gauge.addStakingToken(vault.address);

    // ADD STRATEGY
    const strategy = await strategyDeployer(splitterAddress);

    await splitter.addStrategies([strategy.address], [0]);

    return {vault, strategy};
  }

  public static async deployAndInitVault<T>(
    assetAddress: string,
    vaultName: string,
    controller: IController,
    signer: SignerWithAddress,
    buffer = 100,
    depositFee = 300,
    withdrawFee = 300,
    wait = false
  ): Promise<TetuVaultV2> {
    console.log('deployAndInitVaultAndStrategy', vaultName);

    const core = Addresses.getCore();

    const asset = IERC20Metadata__factory.connect(assetAddress, signer);
    const symbol = await asset.symbol();
    console.log('vaultName', vaultName);

    const factory = VaultFactory__factory.connect(core.vaultFactory, signer)

    await RunHelper.runAndWait(() => factory.createVault(
      assetAddress,
      vaultName,
      vaultName,
      core.gauge,
      buffer
    ),true, wait);
    const l = (await factory.deployedVaultsLength()).toNumber();
    const vaultAddress = await factory.deployedVaults(l - 1);
    console.log(l, 'VAULT: ', vaultAddress)
    const vault = TetuVaultV2__factory.connect(vaultAddress, signer);

    console.log('setFees', depositFee, withdrawFee);
    await RunHelper.runAndWait(() =>
      vault.setFees(depositFee, withdrawFee),
      true, wait);

    console.log('registerVault');
    await RunHelper.runAndWait(() =>
      ControllerV2__factory.connect(core.controller, signer).registerVault(vaultAddress),
      true, wait);

    console.log('addStakingToken');
    await RunHelper.runAndWait(() =>
      IGauge__factory.connect(core.gauge, signer).addStakingToken(vaultAddress),
      true, wait);

    console.log('+Vault Deployed');
    return vault;
  }


}
