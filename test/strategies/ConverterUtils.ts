import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {
  TetuVaultV2,
  IBorrowManager__factory,
  IConverterController__factory,
  ITetuConverter__factory
} from "../../typechain";

export class ConverterUtils {

  constructor(public vault: TetuVaultV2) {
  }

  /**
   * Disable DForce (as it reverts on repay after block advance)
   * @param token1Address
   * @param token2Address
   * @param signer
   */
  public static async disableDForce(token1Address: string, token2Address: string, signer: SignerWithAddress) {
    console.log('disableDForce...');
    const tools = Addresses.getTools();
    const converter = ITetuConverter__factory.connect(tools.converter, signer);
    const converterControllerAddr = await converter.controller();
    const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
    const converterGovAddr = await converterController.governance();
    const converterGov = await DeployerUtilsLocal.impersonate(converterGovAddr);
    const borrowManagerAddr = await converterController.borrowManager();
    const borrowManager = IBorrowManager__factory.connect(borrowManagerAddr, converterGov);
    const DFORCE_POOL_ADAPTER = '0x782b232a8C98aa14c8D48144845ccdf1fD3eeCBA';
    await borrowManager.removeAssetPairs(DFORCE_POOL_ADAPTER, [token1Address], [token2Address]);
    console.log('disableDForce done.\n\n');
  }

}
