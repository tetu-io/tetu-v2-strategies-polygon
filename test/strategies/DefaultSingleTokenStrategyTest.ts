import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {StrategyTestUtils} from "./StrategyTestUtils";
import {IStrategyV2, ITetuVaultV2} from "../../typechain";
import {SpecificStrategyTest} from "./SpecificStrategyTest";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ICoreContractsWrapper} from "../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../ToolsContractsWrapper";
import {universalStrategyTest} from "./UniversalStrategyTest";
import {DeployInfo} from "./DeployInfo";
import {DoHardWorkLoopBase} from "./DoHardWorkLoopBase";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

chai.use(chaiAsPromised);

async function startDefaultSingleTokenStrategyTest(
  strategyName: string,
  underlying: string,
  tokenName: string,
  deployInfo: DeployInfo,
  deployer: ((signer: SignerWithAddress) => Promise<[ITetuVaultV2, IStrategyV2, string]>) | null = null
) {
  // **********************************************
  // ************** CONFIG*************************
  // **********************************************
  const strategyContractName = strategyName;
  const vaultName = tokenName;
  // const underlying = token;
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

  if(deployer === null) {
    deployer = (signer: SignerWithAddress) => {
      const core = deployInfo.core as ICoreContractsWrapper;
      return StrategyTestUtils.deploy(
        signer,
        core,
        vaultName,
        vaultAddress => {
          const strategyArgs = [
            core.controller.address,
            vaultAddress,
            underlying,
          ];
          return DeployerUtils.deployContract(
            signer,
            strategyContractName,
            ...strategyArgs
          ) as Promise<IStrategyV2>;
        },
        underlying
      );
    };
  }
  const hwInitiator = (
    _signer: SignerWithAddress,
    _user: SignerWithAddress,
    _core: ICoreContractsWrapper,
    _tools: IToolsContractsWrapper,
    _underlying: string,
    _vault: ITetuVaultV2,
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
    deployer as (signer: SignerWithAddress) => Promise<[ITetuVaultV2, IStrategyV2, string]>,
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

export {startDefaultSingleTokenStrategyTest};
