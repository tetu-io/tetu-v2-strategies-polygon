import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {startDefaultStrategyTest} from "../../DefaultSingleTokenStrategyTest";
import {config as dotEnvConfig} from "dotenv";
import {DeployInfo} from "../../DeployInfo";
import {StrategyTestUtils} from "../../StrategyTestUtils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal, IVaultStrategyInfo} from "../../../../scripts/utils/DeployerUtilsLocal";
import {IController__factory, IStrategyV2, StrategyDystopiaConverter__factory} from "../../../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: "boolean",
      default: false,
    },
    hardhatChainId: {
      type: "number",
      default: 137
    },
  }).argv;

// const {expect} = chai;
chai.use(chaiAsPromised);

describe('Universal tests', async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  const deployInfo: DeployInfo = new DeployInfo();
  before(async function () {
    await StrategyTestUtils.deployCoreAndInit(deployInfo, argv.deployCoreContracts);
  });

  const strategyName = 'StrategyDystopiaConverter';
  const assetName = 'USDC';
  const asset = MaticAddresses.USDC_TOKEN;
  const vaultName = 'tetu' + assetName;
  const core = Addresses.getCore();
  const tools = Addresses.getTools();


  const deployer = async (signer: SignerWithAddress) => {

    const controller = DeployerUtilsLocal.getController(signer);
    const strategyDeployer = async (splitterAddress: string) => {
      const strategy = StrategyDystopiaConverter__factory.connect(
        await DeployerUtils.deployProxy(signer, 'StrategyDystopiaConverter'), signer);

      await strategy.initialize(
        core.controller,
        splitterAddress,
        tools.converter,
        MaticAddresses.USDC_TOKEN,
        // MaticAddresses.USDPlus_TOKEN,
        // MaticAddresses.USDT_TOKEN,
        MaticAddresses.DAI_TOKEN,
        true
      );

      return strategy;
    }

    console.log('getControllerGovernance...');
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    console.log('deployAndInitVaultAndStrategy...');
    return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset, vaultName, strategyDeployer, controller, gov,
      100, 300, 300, false
    );
  }

  /* tslint:disable:no-floating-promises */
  startDefaultStrategyTest(
    strategyName,
    asset,
    assetName,
    deployInfo,
    deployer
  );


});
