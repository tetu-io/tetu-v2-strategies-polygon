import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {IStrategyV2, TetuVaultV2} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ICoreContractsWrapper} from "../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../ToolsContractsWrapper";
import {IUniversalStrategyInputParams, universalStrategyTest} from "./UniversalStrategyTest";
import {DeployInfo} from "../../baseUT/utils/DeployInfo";
import {DoHardWorkLoopBase} from "../../baseUT/utils/DoHardWorkLoopBase";
import {IVaultStrategyInfo} from "../../../scripts/utils/DeployerUtilsLocal";

chai.use(chaiAsPromised);

async function startDefaultStrategyTest(
  strategyName: string,
  asset: string,
  assetName: string,
  deployInfo: DeployInfo,
  deployer: ((signer: SignerWithAddress) => Promise<IVaultStrategyInfo>),
  stateRegistrar?: (title: string, h: DoHardWorkLoopBase) => Promise<void>,
) {

  // ***********************************************
  //               Test configuration
  // ***********************************************
  const vaultName = 'tetu' + assetName;
  const finalBalanceTolerance = 0;
  const params: IUniversalStrategyInputParams = {
      ppfsDecreaseAllowed: false,
      balanceTolerance:  0.000001, // looks like some rounding issues with 6-decimals tokens
      deposit: 100_000,
      loops: 20,
      loopValue: 1000,
      advanceBlocks: true,
      specificTests: [],
      stateRegistrar
  }
  // **********************************************

  const hwInitiator = (
    _signer: SignerWithAddress,
    _user: SignerWithAddress,
    _core: ICoreContractsWrapper,
    _tools: IToolsContractsWrapper,
    _underlying: string,
    _vault: TetuVaultV2,
    _strategy: IStrategyV2,
    _balanceTolerance: number
  ) => {
    return new DoHardWorkLoopBase(
      _signer,
      _user,
      _core,
      _tools,
      _underlying,
      _vault,
      _strategy,
      _balanceTolerance,
      finalBalanceTolerance,
    );
  };


  await universalStrategyTest(
    strategyName + '_' + vaultName,
    deployInfo,
    deployer as (signer: SignerWithAddress) => Promise<IVaultStrategyInfo>,
    hwInitiator,
    params
  );
}

export {startDefaultStrategyTest};
