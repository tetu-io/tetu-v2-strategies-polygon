import {ICoreContractsWrapper} from "../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../ToolsContractsWrapper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ISplitter, IStrategyV2, TetuVaultV2} from "../../../typechain";

export class DeployInfo {
  public core: ICoreContractsWrapper | null = null;
  public tools: IToolsContractsWrapper | null = null;
  public signer: SignerWithAddress | null = null;
  public user: SignerWithAddress | null = null;
  public asset: string | null = null;
  public vault: TetuVaultV2 | null = null;
  public splitter: ISplitter | null = null;
  public strategy: IStrategyV2 | null = null;
}
