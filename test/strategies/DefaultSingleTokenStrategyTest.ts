import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {IStrategyV2, TetuVaultV2} from "../../typechain";
import {SpecificStrategyTest} from "./SpecificStrategyTest";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ICoreContractsWrapper} from "../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../ToolsContractsWrapper";
import {universalStrategyTest} from "./UniversalStrategyTest";
import {DeployInfo} from "./DeployInfo";
import {DoHardWorkLoopBase} from "./DoHardWorkLoopBase";
import {IVaultStrategyInfo} from "../../scripts/utils/DeployerUtilsLocal";

chai.use(chaiAsPromised);

async function startDefaultStrategyTest(
  strategyName: string,
  asset: string,
  assetName: string,
  deployInfo: DeployInfo,
  deployer: ((signer: SignerWithAddress) => Promise<IVaultStrategyInfo>)
) {
  // **********************************************
  // ************** CONFIG*************************
  // **********************************************
  const vaultName = 'tetu' + assetName;
  // const asset = token;
  // add custom liquidation path if necessary
  const forwarderConfigurator = null;
  // only for strategies where we expect PPFS fluctuations
  const ppfsDecreaseAllowed = false;
  // only for strategies where we expect PPFS fluctuations
  const balanceTolerance = 0;
  const finalBalanceTolerance = 0;
  const deposit = 100_000;
  // at least 3
  const loops = 3;
  // number of blocks or timestamp value
  const loopValue = 300;
  // use 'true' if farmable platform values depends on blocks, instead you can use timestamp
  const advanceBlocks = true;
  const specificTests: SpecificStrategyTest[] = [];
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
    strategyName + vaultName,
    deployInfo,
    deployer as (signer: SignerWithAddress) => Promise<IVaultStrategyInfo>,
    hwInitiator,
    forwarderConfigurator,
    ppfsDecreaseAllowed,
    balanceTolerance,
    deposit,
    loops,
    loopValue,
    advanceBlocks,
    specificTests,
  );
}

export {startDefaultStrategyTest};
