import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import axios from "axios";
import {config as dotEnvConfig} from "dotenv";
import logSettings from "../../log_settings";
import {Logger} from "tslog";
import {MaticAddresses} from "../MaticAddresses";
import {
  IBribe, IBribe__factory,
  IController,
  IController__factory,
  IERC20__factory,
  IForwarder, IForwarder__factory,
  IGauge, IGauge__factory,
  IPlatformVoter, IPlatformVoter__factory,
  IVeDistributor,
  IVeDistributor__factory,
  IVeTetu,
  IVeTetu__factory,
  IVoter, IVoter__factory,
  ProxyControlled__factory,
  VaultFactory,
  VaultFactory__factory
} from "../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {ICoreContractsWrapper} from "../../test/CoreContractsWrapper";
import {IToolsAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/ToolsAddresses";

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

/*  public static async getToolsAddressesWrapper(signer: SignerWithAddress): Promise<ToolsContractsWrapper> {
    const net = await ethers.provider.getNetwork();
    log.info('network ' + net.chainId);
    const tools = Addresses.TOOLS.get(net.chainId + '');
    if (!tools) {
      throw Error('No config for ' + net.chainId);
    }
    return new ToolsContractsWrapper(
      IPriceCalculator__factory.connect(tools.calculator, signer),
    );

  }*/

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


}
