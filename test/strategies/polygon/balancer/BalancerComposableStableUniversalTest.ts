import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {config as dotEnvConfig} from "dotenv";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter,
} from '../../../../scripts/utils/Misc';
import {IUniversalStrategyInputParams} from "../../base/UniversalStrategyTest";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {BalancerIntTestUtils, IState} from "./utils/BalancerIntTestUtils";
import {ethers} from "hardhat";
import {BalancerComposableStableStrategy, IStrategyV2, TetuVaultV2} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

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

describe('BalancerComposableStableUniversalTest @skip-on-coverage', () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  const deployInfo: DeployInfo = new DeployInfo();
  const states: IState[] = [];
  const core = Addresses.getCore();
  const tetuConverterAddress = getConverterAddress();

  before(async function() {
    await StrategyTestUtils.deployCoreAndInit(deployInfo, argv.deployCoreContracts);
    console.log("Liquidator", deployInfo.tools?.liquidator);
    console.log(deployInfo.tools?.converter);

    const [signer] = await ethers.getSigners();

    await BalancerIntTestUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await BalancerIntTestUtils.deployAndSetCustomSplitter(signer, core);
    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());

    // Disable Hundred Finance (no liquidity)
    await ConverterUtils.disablePlatformAdapter(signer, getHundredFinancePlatformAdapter());
  });

  /** Save collected states to csv, compute profit */
  after(async function() {
    const pathOut = "./tmp/ts2-snapshots.csv";
    await BalancerIntTestUtils.saveListStatesToCSVRows(pathOut, states);
    BalancerIntTestUtils.outputProfit(states);
  });

  describe('tests', async () => {
    const strategyName = 'BalancerComposableStableStrategy';
    const assetName = 'USDC';
    const asset = PolygonAddresses.USDC_TOKEN;
    const reinvestThresholdPercent = 1_000; // 1%
    const params: IUniversalStrategyInputParams = {
      ppfsDecreaseAllowed: false,
      balanceTolerance: 0.000001, // looks like some rounding issues with 6-decimals tokens
      deposit: 100_000,
      loops: 40,
      loopValue: 2000,
      advanceBlocks: true,
      specificTests: [],
      hwParams: {
        compoundRate: 100_000, // 50%
      },
      stateRegistrar: async (title, h) => {
        states.push(await BalancerIntTestUtils.getState(
          h.signer,
          h.user,
          h.strategy as unknown as BalancerComposableStableStrategy,
          h.vault,
          title
        ));
      },
      strategyInit: async (strategy: IStrategyV2, vault: TetuVaultV2, user: SignerWithAddress) => {
        await BalancerIntTestUtils.setThresholds(
          strategy as unknown as IStrategyV2,
          user,
          {reinvestThresholdPercent}
        );
      }
    }

    const deployer = async (signer: SignerWithAddress) => UniversalTestUtils.makeStrategyDeployer(
      signer,
      core,
      asset,
      tetuConverterAddress,
      strategyName,
      {
        vaultName: 'tetu' + assetName
      }
    );

    /* tslint:disable:no-floating-promises */
    await startDefaultStrategyTest(
      strategyName,
      asset,
      assetName,
      deployInfo,
      deployer,
      params,
    );
  });
});
