import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import logSettings from '../../log_settings';
import { Logger } from 'tslog';
import { MaticAddresses } from '../addresses/MaticAddresses';
import {
  ControllerV2,
  ControllerV2__factory,
  IBribe__factory,
  IController,
  IController__factory,
  IERC20__factory,
  IForwarder__factory,
  IGauge__factory,
  IPlatformVoter__factory,
  IStrategyV2,
  ITetuConverter__factory,
  ITetuLiquidator,
  ITetuLiquidator__factory,
  IVeDistributor__factory,
  IVeTetu__factory,
  IVoter__factory,
  Multicall__factory,
  ProxyControlled__factory,
  StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2,
  TetuVaultV2__factory,
  VaultFactory__factory,
} from '../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { ICoreContractsWrapper } from '../../test/CoreContractsWrapper';
import { IToolsContractsWrapper } from '../../test/ToolsContractsWrapper';
import { RunHelper } from './RunHelper';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { ToolsAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/ToolsAddresses';
import { DeployerUtils } from './DeployerUtils';
import { Misc } from './Misc';

// tslint:disable-next-line:no-var-requires
const hre = require('hardhat');
const log: Logger<undefined> = new Logger(logSettings);

export interface IVaultStrategyInfo {
  vault: TetuVaultV2,
  splitter: StrategySplitterV2,
  strategy: IStrategyV2
}

export class DeployerUtilsLocal {

  // ************** VERIFY **********************

  public static async verify(address: string) {
    try {
      await hre.run('verify:verify', {
        address,
      });
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  public static async verifyImpl(signer: SignerWithAddress, proxyAddress: string) {
    const proxy = ProxyControlled__factory.connect(proxyAddress, signer);
    const address = await proxy.implementation();
    console.log('impl address', address);
    try {
      await hre.run('verify:verify', {
        address,
      });
    } catch (e) {
      log.info('error verify ' + e);
    }
    await this.verifyProxy(proxyAddress);
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithArgs(address: string, args: any[]) {
    try {
      await hre.run('verify:verify', {
        address, constructorArguments: args,
      });
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithContractName(address: string, contractPath: string, args?: any[]) {
    try {
      await hre.run('verify:verify', {
        address, contract: contractPath, constructorArguments: args,
      });
    } catch (e) {
      log.info('error verify ' + e);
    }
  }

  public static async verifyImplWithContractName(
    signer: SignerWithAddress,
    proxyAddress: string,
    contractPath: string,
    // tslint:disable-next-line:no-any
    args?: any[],
  ) {
    const proxy = ProxyControlled__factory.connect(proxyAddress, signer);
    const address = await proxy.implementation();
    console.log('impl address', address);
    try {
      await hre.run('verify:verify', {
        address, contract: contractPath, constructorArguments: args,
      });
    } catch (e) {
      log.info('error verify ' + e);
    }
    await this.verifyProxy(proxyAddress);
  }

  // tslint:disable-next-line:no-any
  public static async verifyWithArgsAndContractName(address: string, args: any[], contractPath: string) {
    try {
      await hre.run('verify:verify', {
        address, constructorArguments: args, contract: contractPath,
      });
    } catch (e) {
      log.info('error verify ' + e);
    }
  }


  public static async verifyProxy(adr: string) {
    // it's broken for some reason

    // try {
    //
    //   // const resp =
    //   await axios.post(
    //     (await VerifyUtils.getNetworkScanUrl()) +
    //     `?module=contract&action=verifyproxycontract&apikey=${argv.networkScanKey}`,
    //     `address=${adr}`,
    //   );
    //   // log.info("proxy verify resp", resp.data);
    // } catch (e) {
    //   log.info('error proxy verify ' + adr + e);
    // }
  }

  // ************** ADDRESSES **********************


  public static async getCoreAddresses(): Promise<CoreAddresses> {
    const net = Misc.getChainId();
    log.info('network ' + net);
    const core = Addresses.CORE.get(net);
    if (!core) {
      throw Error('No config for ' + net);
    }
    return core;
  }

  public static getController(signer: SignerWithAddress): ControllerV2 {
    const core = Addresses.getCore();
    return ControllerV2__factory.connect(core.controller, signer);
  }

  public static async getControllerGovernance(signer: SignerWithAddress): Promise<SignerWithAddress> {
    if (!signer) {
      signer = (await ethers.getSigners())[0];
    }
    const controller = DeployerUtilsLocal.getController(signer);
    const govAddress = await controller.governance();
    const gov = await DeployerUtilsLocal.impersonate(govAddress);

    if (!(await controller.isOperator(govAddress))) {
      await controller.connect(gov).registerOperator(govAddress);
    }

    return gov;
  }

  public static async getControllerLiquidator(signer?: SignerWithAddress): Promise<ITetuLiquidator> {
    if (!signer) {
      signer = (await ethers.getSigners())[0];
    }
    const controller = IController__factory.connect(Addresses.getCore().controller, signer);
    const liquidatorAddress = await controller.liquidator();
    return ITetuLiquidator__factory.connect(liquidatorAddress, ethers.provider);
  }

  public static async getLiquidator(signer?: SignerWithAddress): Promise<ITetuLiquidator> {
    if (!signer) {
      signer = (await ethers.getSigners())[0];
    }
    const liquidatorAddress = Addresses.getTools().liquidator;
    return ITetuLiquidator__factory.connect(liquidatorAddress, signer);
  }

  public static async getCoreAddressesWrapper(signer: SignerWithAddress): Promise<ICoreContractsWrapper> {
    const chainId = Misc.getChainId();
    log.info('network ' + chainId);
    const core = Addresses.CORE.get(chainId);
    if (!core) {
      throw Error('No config for ' + chainId);
    }

    return {
      tetu: IERC20__factory.connect(core.tetu, signer),
      controller: ControllerV2__factory.connect(core.controller, signer),
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
    const chainId = Misc.getChainId();
    log.info('network ' + chainId);
    const tools = Addresses.TOOLS.get(chainId);
    if (!tools) {
      throw Error('No config for ' + chainId);
    }
    return {
      liquidator: ITetuLiquidator__factory.connect(tools.liquidator, signer),
      converter: ITetuConverter__factory.connect(tools.converter, signer),
      multicall: Multicall__factory.connect(tools.multicall, signer),
    };

  }

  public static async getToolsAddresses(): Promise<ToolsAddresses> {
    const chainId = Misc.getChainId();
    log.info('network ' + chainId);
    const tools = Addresses.TOOLS.get(chainId);
    if (!tools) {
      throw Error('No config for ' + chainId);
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
    const chainId = Misc.getChainId();
    if (chainId === 137) {
      return MaticAddresses.GOV_ADDRESS;
    } else {
      throw Error('No config for ' + chainId);
    }
  }

  public static async impersonate(address: string | null = null, silent?: boolean) {
    if (address === null) {
      address = await DeployerUtilsLocal.getGovernance();
    }
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [address],
    });

    await hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [address, '0x1431E0FAE6D7217CAA0000000'],
    });
    if (!silent) {
      console.log('address impersonated', address);
    }
    return ethers.getSigner(address || '');
  }

  public static async getNetworkTokenAddress() {
    const chainId = Misc.getChainId();
    if (chainId === 137) {
      return MaticAddresses.WMATIC_TOKEN;
    } else {
      throw Error('No config for ' + chainId);
    }
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
    wait = false,
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

    return { vault, splitter, strategy };
  }

  public static async deployAndInitVault<T>(
    assetAddress: string,
    vaultName: string,
    controller: IController,
    signer: SignerWithAddress,
    buffer = 100,
    depositFee = 300,
    withdrawFee = 300,
    wait = false,
  ): Promise<TetuVaultV2> {
    console.log('deployAndInitVault', vaultName);

    const core = Addresses.getCore();

    // const asset = IERC20Metadata__factory.connect(assetAddress, signer);
    // const symbol = await asset.symbol();
    console.log('vaultName', vaultName);

    const factory = VaultFactory__factory.connect(core.vaultFactory, signer);

    const vaultLogic = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const splitterLogic = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    await factory.connect(await Misc.impersonate('0xcc16d636dd05b52ff1d8b9ce09b09bc62b11412b'))
      .setVaultImpl(vaultLogic.address);
    await factory.connect(await Misc.impersonate('0xcc16d636dd05b52ff1d8b9ce09b09bc62b11412b'))
      .setSplitterImpl(splitterLogic.address);

    await RunHelper.runAndWait(() => factory.createVault(
      assetAddress,
      vaultName,
      vaultName,
      core.gauge,
      buffer,
    ), true, wait);
    const l = (await factory.deployedVaultsLength()).toNumber();
    const vaultAddress = await factory.deployedVaults(l - 1);
    console.log(l, 'VAULT: ', vaultAddress);
    const vault = TetuVaultV2__factory.connect(vaultAddress, signer);

    console.log('setFees', depositFee, withdrawFee);
    await RunHelper.runAndWait(() =>
        vault.setFees(depositFee, withdrawFee),
      true, wait,
    );
    await RunHelper.runAndWait(() =>
        vault.setWithdrawRequestBlocks(0),
      true, wait,
    );

    console.log('registerVault');
    await RunHelper.runAndWait(() =>
        ControllerV2__factory.connect(core.controller, signer).registerVault(vaultAddress),
      true, wait,
    );

    console.log('addStakingToken');
    await RunHelper.runAndWait(() =>
        IGauge__factory.connect(core.gauge, signer).addStakingToken(vaultAddress),
      true, wait,
    );

    console.log('+Vault Deployed');
    return vault;
  }


}
