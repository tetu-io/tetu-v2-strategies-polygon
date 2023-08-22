import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, ContractFactory } from 'ethers';
import logSettings from '../../log_settings';
import { Logger } from 'tslog';
import { parseUnits } from 'ethers/lib/utils';
import {
  ControllerMinimal,
  MockToken,
  ProxyControlled,
  TetuVaultV2,
  TetuVaultV2__factory,
  VaultInsurance,
} from '../../typechain';
import { RunHelper } from './RunHelper';
import {deployContract, deployContractSilently} from '../deploy/DeployContract';
import { ethers } from 'hardhat';

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
const log: Logger<undefined> = new Logger(logSettings);


export class DeployerUtils {

  // ************ CONTRACT DEPLOY **************************

  public static async deployContractSilent<T extends ContractFactory>(
    signer: SignerWithAddress,
    name: string,
    // tslint:disable-next-line:no-any
    ...args: any[]
  ) {
    return deployContractSilently(hre, signer, name, ...args);
  }

  public static async deployContract<T extends ContractFactory>(
    signer: SignerWithAddress,
    name: string,
    // tslint:disable-next-line:no-any
    ...args: any[]
  ) {
    return deployContract(hre, signer, name, ...args);
  }

  public static async deployMockToken(signer: SignerWithAddress, name = 'MOCK', decimals = 18, mintAmount = '1000000', silent: false) {
    let token
    if (!silent) {
      token = await DeployerUtils.deployContract(signer, 'MockToken', name + '_MOCK_TOKEN', name, decimals) as MockToken;
      await RunHelper.runAndWait(() => token.mint(signer.address, parseUnits(mintAmount, decimals)));
    } else {
      token = await DeployerUtils.deployContractSilent(signer, 'MockToken', name + '_MOCK_TOKEN', name, decimals) as MockToken;
      await RunHelper.runAndWait(() => token.mint(signer.address, parseUnits(mintAmount, decimals)), true, true, silent);
    }

    return token;
  }

  public static async deployProxy(signer: SignerWithAddress, contract: string, silent: false) {
    if (!silent) {
      const logic = await DeployerUtils.deployContract(signer, contract);
      const proxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
      await RunHelper.runAndWait(() => proxy.initProxy(logic.address));
      return proxy.address;
    } else {
      const logic = await DeployerUtils.deployContractSilent(signer, contract);
      const proxy = await DeployerUtils.deployContractSilent(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
      await RunHelper.runAndWait(() => proxy.initProxy(logic.address), true, true, true);
      return proxy.address;
    }
  }

  public static async deployMockController(signer: SignerWithAddress) {
    return await DeployerUtils.deployContract(signer, 'ControllerMinimal', signer.address) as ControllerMinimal;
  }

  public static async deployTetuVaultV2(
    signer: SignerWithAddress,
    controller: string,
    asset: string,
    name: string,
    symbol: string,
    gauge: string,
    buffer: number,
  ) {
    const logic = await DeployerUtils.deployContract(signer, 'TetuVaultV2') as TetuVaultV2;
    const proxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    await proxy.initProxy(logic.address);
    const vault = TetuVaultV2__factory.connect(proxy.address, signer);
    await vault.init(
      controller,
      asset,
      name,
      symbol,
      gauge,
      buffer,
    );
    const insurance = await DeployerUtils.deployContract(signer, 'VaultInsurance') as VaultInsurance;
    await insurance.init(vault.address, asset);
    await vault.initInsurance(insurance.address);
    return vault;
  }

  public static async connectInterface<T extends Contract>(
    signer: SignerWithAddress,
    name: string,
    address: string
  ) {
    return ethers.getContractAt(name, address, signer);
  }


}
