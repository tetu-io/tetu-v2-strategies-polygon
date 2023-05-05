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
  getDForcePlatformAdapter, Misc,
} from '../../../../scripts/utils/Misc';
import { UniversalTestUtils } from '../../../baseUT/utils/UniversalTestUtils';
import { ethers } from 'hardhat';
import {
  BalancerBoostedStrategy,
  BalancerBoostedStrategy__factory,
  ControllerV2__factory,
  IERC20Metadata__factory,
  IStrategyV2,
  TetuVaultV2
} from '../../../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {IState, IStateParams, StateUtils} from "../../../StateUtils";
import {IUniversalStrategyInputParams, universalStrategyTest} from "../../base/UniversalStrategyTest";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {ICoreContractsWrapper} from "../../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../../ToolsContractsWrapper";
import {IVaultStrategyInfo} from "../../../../scripts/utils/DeployerUtilsLocal";
import {BalancerRewardsHardwork} from "./utils/BalancerRewardsHardwork";
import {BalancerStrategyUtils} from "../../../BalancerStrategyUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";

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

    const controller = ControllerV2__factory.connect(core.controller, signer)
    const operators = await controller.operatorsList();
    const operator = await Misc.impersonate(operators[0]);
    const pools = [
      {
        pool: MaticAddresses.UNISWAPV3_USDC_DAI_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.DAI_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
      {
        pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDT_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
    ]
    await deployInfo.tools?.liquidator.connect(operator).addBlueChipsPools(pools, true)
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
      balanceTolerance: 0.000001, // looks like some rounding issues with 6-decimals tokens
      deposit: 100_000,
      loops: 4,
      loopValue: 2000,
      advanceBlocks: true,
      specificTests: [],
      hwParams: {
        // compoundRate: 100_000, // 100%
        compoundRate: [0, 10_000, 45_000, 100_000], // 0%, 10%, 45%, 100%
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

        await PriceOracleImitatorUtils.balancerBoosted(user, t[1], t[0])
      },
      swap1: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const swapAmountUnits = '10000'
        const boostedStrategy = strategy as unknown as BalancerBoostedStrategy
        const poolId = await boostedStrategy.poolId()
        const otherToken = IERC20Metadata__factory.connect(await BalancerStrategyUtils.getOtherToken(poolId, t[0], MaticAddresses.BALANCER_VAULT, swapUser), swapUser)
        console.log(`${await otherToken.symbol()} price: ${formatUnits(await PriceOracleImitatorUtils.getPrice(swapUser, otherToken.address), 8)}`)
        await BalancerStrategyUtils.bbSwap(poolId.substring(0, 42), t[0], otherToken.address, parseUnits(swapAmountUnits, await IERC20Metadata__factory.connect(t[0], swapUser).decimals()), MaticAddresses.BALANCER_VAULT, swapUser)
        console.log(`${await otherToken.symbol()} price: ${formatUnits(await PriceOracleImitatorUtils.getPrice(swapUser, otherToken.address), 8)}`)
      },
      swap2: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const swapAmountUnits = '10000'
        const boostedStrategy = strategy as unknown as BalancerBoostedStrategy
        const poolId = await boostedStrategy.poolId()
        const otherToken = IERC20Metadata__factory.connect(await BalancerStrategyUtils.getOtherToken(poolId, t[0], MaticAddresses.BALANCER_VAULT, swapUser), swapUser)
        console.log(`${await otherToken.symbol()} price: ${formatUnits(await PriceOracleImitatorUtils.getPrice(swapUser, otherToken.address), 8)}`)
        await BalancerStrategyUtils.bbSwap(poolId.substring(0, 42), otherToken.address, t[0], parseUnits(swapAmountUnits, await otherToken.decimals()), MaticAddresses.BALANCER_VAULT, swapUser)
        console.log(`${await otherToken.symbol()} price: ${formatUnits(await PriceOracleImitatorUtils.getPrice(swapUser, otherToken.address), 8)}`)
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
        const mainAssetDecimals = await IERC20Metadata__factory.connect(t[0], signer).decimals()
        statesParams[await strategy.poolId()] = {
          mainAssetSymbol,
          mainAssetDecimals,
        }
        return strategy as unknown as IStrategyV2;
      },
      {
        vaultName: 'tetu' + await IERC20Metadata__factory.connect(t[0], signer).symbol(),
        depositFee: 300,
        withdrawFee: 300,
      },
    );

    const hwInitiator = (
      _signer: SignerWithAddress,
      _user: SignerWithAddress,
      _core: ICoreContractsWrapper,
      _tools: IToolsContractsWrapper,
      _underlying: string,
      _vault: TetuVaultV2,
      _strategy: IStrategyV2,
      _balanceTolerance: number,
    ) => {
      return new BalancerRewardsHardwork(
        _signer,
        _user,
        _core,
        _tools,
        _underlying,
        _vault,
        _strategy,
        _balanceTolerance,
        0,
      );
    };

    universalStrategyTest(
      strategyName + '_' + t[1],
      deployInfo,
      deployer as (signer: SignerWithAddress) => Promise<IVaultStrategyInfo>,
      hwInitiator,
      params,
    );
  })

});
