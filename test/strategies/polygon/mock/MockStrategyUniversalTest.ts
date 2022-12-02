import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {startDefaultStrategyTest} from "../../DefaultSingleTokenStrategyTest";
import {config as dotEnvConfig} from "dotenv";
import {DeployInfo} from "../../DeployInfo";
import {StrategyTestUtils} from "../../StrategyTestUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {IStrategyV2, MockStrategySimple__factory} from "../../../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";

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

  const strategyName = 'MockStrategySimple';
  const asset = PolygonAddresses.USDC_TOKEN;
  const assetName = 'USDC';
  const vaultName = 'mock' + assetName;
  const core = Addresses.getCore();

  const deployer = async (signer: SignerWithAddress) => {

    const controller = DeployerUtilsLocal.getController(signer);
    const strategyDeployer = async (splitterAddress: string) => {
      const strategy = MockStrategySimple__factory.connect(
        await DeployerUtils.deployProxy(signer, strategyName), signer);

      await strategy.init(
        core.controller,
        splitterAddress,
        asset
      );

      return strategy as unknown as IStrategyV2;
    }

    console.log('getControllerGovernance...');
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    console.log('deployAndInitVaultAndStrategy...');
    return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset, vaultName, strategyDeployer, controller, gov,
      100, 250, 500, false
    );

  }

  /* tslint:disable:no-floating-promises */
  await startDefaultStrategyTest(
    strategyName,
    asset,
    assetName,
    deployInfo,
    deployer
  );


});
