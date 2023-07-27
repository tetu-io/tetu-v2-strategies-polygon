/* tslint:disable:no-trailing-whitespace */
import {config as dotEnvConfig} from "dotenv";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {getConverterAddress, getDForcePlatformAdapter, Misc} from "../../../../scripts/utils/Misc";
import {IState, IStateParams, StateUtils} from "../../../StateUtils";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import hre, {ethers} from "hardhat";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {IUniversalStrategyInputParams} from "../../base/UniversalStrategyTest";
import {
  IERC20Metadata__factory,
  IStrategyV2, KyberConverterStrategy, KyberConverterStrategy__factory,
  TetuVaultV2,
} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {BigNumber, Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {parseUnits} from "ethers/lib/utils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {UniversalUtils} from "../../../UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";


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

describe('KyberConverterStrategyUniversalTest', async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  // [asset, pool, tickRange, rebalanceTickRange, incentiveKey]
  const targets: [string, string, number, number, number][] = [
    [MaticAddresses.USDC_TOKEN, MaticAddresses.KYBER_USDC_USDT, 0, 0, 5],
  ]

  const deployInfo: DeployInfo = new DeployInfo();
  const core = Addresses.getCore();
  const tetuConverterAddress = getConverterAddress();
  const states: {[poolId: string]: IState[]} = {};
  const statesParams: {[poolId: string]: IStateParams} = {}

  before(async function() {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: 44366000,
          },
        },
      ],
    });

    await StrategyTestUtils.deployCoreAndInit(deployInfo, argv.deployCoreContracts);

    const [signer] = await ethers.getSigners();

    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await StrategyTestUtils.deployAndSetCustomSplitter(signer, core);
    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));

    const pools = [
      // for production
      {
        pool: MaticAddresses.KYBER_KNC_USDC,
        swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
        tokenIn: MaticAddresses.KNC_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },

      // only for test to prevent 'TS-16 price impact'
      {
        pool: MaticAddresses.KYBER_USDC_USDT,
        swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
        tokenIn: MaticAddresses.USDC_TOKEN,
        tokenOut: MaticAddresses.USDT_TOKEN,
      },
    ]
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const operator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(operator).addLargestPools(pools, true);
    await tools.liquidator.connect(operator).addBlueChipsPools(pools, true);
  });

  after(async function() {
    for (const poolId of Object.keys(states)) {
      const pathOut = `./tmp/kyber-universal-${poolId}-snapshots.csv`;
      await StateUtils.saveListStatesToCSVColumns(pathOut, states[poolId], statesParams[poolId])
      await StateUtils.outputProfit(states[poolId])
    }
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: parseInt(process.env.TETU_MATIC_FORK_BLOCK || '', 10) || undefined,
          },
        },
      ],
    });
  });

  targets.forEach(t => {
    const strategyName = 'KyberConverterStrategy';
    const asset = t[0];
    const reinvestThresholdPercent = 1_000; // 1%
    const params: IUniversalStrategyInputParams = {
      ppfsDecreaseAllowed: false,
      balanceTolerance: 0.000002, // looks like some rounding issues with 6-decimals tokens
      deposit: 10_000,
      loops: 4, // an even number of iterations triggers the same number of swap1 and swap2
      loopValue: 2000,
      advanceBlocks: true,
      specificTests: [],
      hwParams: {
        compoundRate: 100_000,
      },
      stateRegistrar: async(title, h) => {
        const strategy = h.strategy as unknown as KyberConverterStrategy
        const poolId = t[1]
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
        await PriceOracleImitatorUtils.kyber(user, t[1], t[0])
      },
      swap1: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const kyberStrategy = strategy as unknown as KyberConverterStrategy
        const state = await PackedData.getDefaultState(kyberStrategy);
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('100000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        await UniversalUtils.movePoolPriceUp(
          swapUser,
          state.pool,
          state.tokenA,
          state.tokenB,
          MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
          swapAmount,
        );
      },
      swap2: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const kyberStrategy = strategy as unknown as KyberConverterStrategy
        const state = await PackedData.getDefaultState(kyberStrategy);
        const tokenBPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenB)
        const tokenBDecimals = await IERC20Metadata__factory.connect(state.tokenB, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('100000', 8)).div(tokenBPrice).mul(parseUnits('1', tokenBDecimals))
        await UniversalUtils.movePoolPriceDown(
          swapUser,
          state.pool,
          state.tokenA,
          state.tokenB,
          MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
          swapAmount,
        );
      },
      rebalancingStrategy: true,
      makeVolume: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const kyberStrategy = strategy as unknown as KyberConverterStrategy
        const state = await PackedData.getDefaultState(kyberStrategy);
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('5000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        await UniversalUtils.makePoolVolume(
          swapUser,
          state.pool,
          state.tokenA,
          state.tokenB,
          MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
          swapAmount
        )
      },
    };

    const deployer = async(signer: SignerWithAddress) => UniversalTestUtils.makeStrategyDeployer(
      signer,
      core,
      asset,
      tetuConverterAddress,
      strategyName,
      async(strategyProxy: string, signerOrProvider: Signer | Provider, splitterAddress: string) => {
        const strategy = KyberConverterStrategy__factory.connect(strategyProxy, signer);
        await strategy.init(
          core.controller,
          splitterAddress,
          tetuConverterAddress,
          t[1],
          t[2],
          t[3],
          true,
          t[4]
        );
        const mainAssetSymbol = await IERC20Metadata__factory.connect(asset, signer).symbol()
        statesParams[t[1]] = {
          mainAssetSymbol,
        }
        const state = await PackedData.getDefaultState(kyberStrategy);
        const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [state.tokenA, state.tokenB, MaticAddresses.KNC_TOKEN])
        await strategy.setStrategyProfitHolder(profitHolder.address)
        // await strategy.setFuseThreshold(parseUnits('5', 16)); // 5%
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
})