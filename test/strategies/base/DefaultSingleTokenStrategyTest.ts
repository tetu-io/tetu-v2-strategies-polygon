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
  params: IUniversalStrategyInputParams,
  stateRegistrar?: (title: string, h: DoHardWorkLoopBase) => Promise<void>
) {

  // ***********************************************
  //               Test configuration
  // ***********************************************
  const vaultName = 'tetu' + assetName;
  const finalBalanceTolerance = 0;
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
    params,
    stateRegistrar
  );
}

export {startDefaultStrategyTest};
