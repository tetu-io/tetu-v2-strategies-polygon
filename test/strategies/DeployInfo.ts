import {CoreContractsWrapper} from "../CoreContractsWrapper";
import {ToolsContractsWrapper} from "../ToolsContractsWrapper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IStrategy, ISmartVault} from "../../typechain";

export class DeployInfo {
  public core: CoreContractsWrapper | null = null;
  public tools: ToolsContractsWrapper | null = null;
  public signer: SignerWithAddress | null = null;
  public user: SignerWithAddress | null = null;
  public underlying: string | null = null;
  public vault: ISmartVault | null = null;
  public strategy: IStrategy | null = null;
}
