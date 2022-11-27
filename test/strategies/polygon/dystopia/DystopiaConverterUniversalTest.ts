import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {startDefaultStrategyTest} from "../../DefaultSingleTokenStrategyTest";
import {config as dotEnvConfig} from "dotenv";
import {DeployInfo} from "../../DeployInfo";
import {StrategyTestUtils} from "../../StrategyTestUtils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {StrategyDystopiaConverter__factory} from "../../../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../ConverterUtils";

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
  const token1 = asset;
  // const token2 = MaticAddresses.USDPlus_TOKEN;
  // const token2 = MaticAddresses.USDT_TOKEN;
  const token2 = MaticAddresses.DAI_TOKEN; // MAYBE iterate
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
        token1,
        token2,
        true
      );

      // Disable DForce (as it reverts on repay after block advance)
      await ConverterUtils.disableDForce(token1, token2, signer);

      return strategy;
    }

    console.log('getControllerGovernance...');
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    console.log('deployAndInitVaultAndStrategy...');
    return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset, vaultName, strategyDeployer, controller, gov,
      100, 1000, 500, false
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
