import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ContractFactory} from "ethers";
import logSettings from "../../log_settings";
import {Logger} from "tslog";
import {parseUnits} from "ethers/lib/utils";
import {
  ControllerMinimal,
  MockToken,
  ProxyControlled, TetuVaultV2, TetuVaultV2__factory, VaultInsurance,
} from "../../typechain";
import {RunHelper} from "./RunHelper";
import {deployContract} from "../deploy/DeployContract";

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
const log: Logger = new Logger(logSettings);


export class DeployerUtils {

  // ************ CONTRACT DEPLOY **************************

  public static async deployContract<T extends ContractFactory>(
    signer: SignerWithAddress,
    name: string,
    // tslint:disable-next-line:no-any
    ...args: any[]
  ) {
    return deployContract(hre, signer, name, ...args);
  }

  public static async deployMockToken(signer: SignerWithAddress, name = 'MOCK', decimals = 18, mintAmount = '1000000') {
    const token = await DeployerUtils.deployContract(signer, 'MockToken', name + '_MOCK_TOKEN', name, decimals) as MockToken;
    await RunHelper.runAndWait(() => token.mint(signer.address, parseUnits(mintAmount, decimals)));
    return token;
  }

  public static async deployProxy(signer: SignerWithAddress, contract: string) {
    const logic = await DeployerUtils.deployContract(signer, contract);
    const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
    await RunHelper.runAndWait(() => proxy.initProxy(logic.address));
    return proxy.address;
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
    const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
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


}
