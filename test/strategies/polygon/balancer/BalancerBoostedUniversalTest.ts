/* tslint:disable:no-trailing-whitespace */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { config as dotEnvConfig } from 'dotenv';
import { DeployInfo } from '../../../baseUT/utils/DeployInfo';
import { StrategyTestUtils } from '../../../baseUT/utils/StrategyTestUtils';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import {
  getConverterAddress,
  getDForcePlatformAdapter,
} from '../../../../scripts/utils/Misc';
import { UniversalTestUtils } from '../../../baseUT/utils/UniversalTestUtils';
import { ethers } from 'hardhat';
import {
  BalancerBoostedStrategy,
  BalancerBoostedStrategy__factory,
  IERC20Metadata__factory,
  IStrategyV2,
  TetuVaultV2
} from '../../../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {IState, IStateParams, StateUtils} from "../../../StateUtils";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {IUniversalStrategyInputParams} from "../../base/UniversalStrategyTest";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

// const {expect} = chai;
chai.use(chaiAsPromised);

describe('BalancerBoostedUniversalTest', async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  // [asset, pool]
  const targets = [
    [MaticAddresses.USDC_TOKEN, MaticAddresses.BALANCER_POOL_T_USD],
  ]

  const deployInfo: DeployInfo = new DeployInfo();
  const core = Addresses.getCore();
  const tetuConverterAddress = getConverterAddress();
  const states: {[poolId: string]: IState[]} = {};
  const statesParams: {[poolId: string]: IStateParams} = {}

  before(async function() {
    await StrategyTestUtils.deployCoreAndInit(deployInfo, argv.deployCoreContracts);

    const [signer] = await ethers.getSigners();

    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await StrategyTestUtils.deployAndSetCustomSplitter(signer, core);
    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
  });

  after(async function() {
    for (const poolId of Object.keys(states)) {
      const pathOut = `./tmp/balancer-boosted-universal-${poolId}-snapshots.csv`;
      await StateUtils.saveListStatesToCSVColumns(pathOut, states[poolId], statesParams[poolId])
      await StateUtils.outputProfit(states[poolId])
    }
  });

  targets.forEach(t => {
    const strategyName = 'BalancerBoostedStrategy';
    const asset = t[0];
    const reinvestThresholdPercent = 1_000; // 1%
    const params: IUniversalStrategyInputParams = {
      ppfsDecreaseAllowed: false,
      balanceTolerance: 0.000001, // looks like some rounding issues with 6-decimals tokens
      deposit: 100_000,
      loops: 3,
      loopValue: 2000,
      advanceBlocks: true,
      specificTests: [],
      hwParams: {
        compoundRate: 100_000, // 50%
      },
      stateRegistrar: async(title, h) => {
        const strategy = h.strategy as unknown as BalancerBoostedStrategy
        const poolId = await strategy.poolId()
        if (!states[poolId]) {
          states[poolId] = []
        }
        states[poolId].push(await StateUtils.getState(
          h.signer,
          h.user,
          strategy,
          h.vault,
          title,
        ));
      },
      strategyInit: async(strategy: IStrategyV2, vault: TetuVaultV2, user: SignerWithAddress) => {
        await StrategyTestUtils.setThresholds(
          strategy as unknown as IStrategyV2,
          user,
          { reinvestThresholdPercent },
        );
        await ConverterUtils.addToWhitelist(user, tetuConverterAddress, strategy.address);
      },
    };

    const deployer = async(signer: SignerWithAddress) => UniversalTestUtils.makeStrategyDeployer(
      signer,
      core,
      asset,
      tetuConverterAddress,
      strategyName,
      async(strategyProxy: string, signerOrProvider: Signer | Provider, splitterAddress: string) => {
        const strategy = BalancerBoostedStrategy__factory.connect(strategyProxy, signer);
        await strategy.init(core.controller, splitterAddress, tetuConverterAddress, t[1]);
        const mainAssetSymbol = await IERC20Metadata__factory.connect(t[0], signer).symbol()
        statesParams[await strategy.poolId()] = {
          mainAssetSymbol,
        }
        return strategy as unknown as IStrategyV2;
      },
      {
        vaultName: 'tetu' + await IERC20Metadata__factory.connect(t[0], signer).symbol(),
      },
    );

    /* tslint:disable:no-floating-promises */
    startDefaultStrategyTest(
      strategyName,
      asset,
      asset,
      deployInfo,
      deployer,
      params,
    );
  })

});