import {ICoreContractsWrapper} from "../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../ToolsContractsWrapper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IStrategyV2, ITetuVaultV2} from "../../typechain";

export class DeployInfo {
  public core: ICoreContractsWrapper | null = null;
  public tools: IToolsContractsWrapper | null = null;
  public signer: SignerWithAddress | null = null;
  public user: SignerWithAddress | null = null;
  public underlying: string | null = null;
  public vault: ITetuVaultV2 | null = null;
  public strategy: IStrategyV2 | null = null;
}
