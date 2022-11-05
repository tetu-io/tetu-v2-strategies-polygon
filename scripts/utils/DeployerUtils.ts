import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ContractFactory} from "ethers";
import logSettings from "../../log_settings";
import {Logger} from "tslog";
import {parseUnits} from "ethers/lib/utils";
import {
  MockToken,
  ProxyControlled,
} from "../../typechain";
import {RunHelper} from "./RunHelper";
import {deployContract} from "../deploy/DeployContract";

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
// const log: Logger = new Logger(logSettings);


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

  public static async deployMockToken(signer: SignerWithAddress, name = 'MOCK', decimals = 18) {
    const token = await DeployerUtils.deployContract(signer, 'MockToken', name + '_MOCK_TOKEN', name, decimals) as MockToken;
    await RunHelper.runAndWait(() => token.mint(signer.address, parseUnits('1000000', decimals)));
    return token;
  }

  public static async deployProxy(signer: SignerWithAddress, contract: string) {
    const logic = await DeployerUtils.deployContract(signer, contract);
    const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
    await RunHelper.runAndWait(() => proxy.initProxy(logic.address));
    return proxy.address;
  }



}
