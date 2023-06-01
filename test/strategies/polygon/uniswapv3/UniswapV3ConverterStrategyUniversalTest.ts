/* tslint:disable:no-trailing-whitespace */
import {config as dotEnvConfig} from "dotenv";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {getConverterAddress, getDForcePlatformAdapter} from "../../../../scripts/utils/Misc";
import {IState, IStateParams, StateUtils} from "../../../StateUtils";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {ethers} from "hardhat";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {IUniversalStrategyInputParams} from "../../base/UniversalStrategyTest";
import {
  IERC20Metadata__factory,
  IStrategyV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {BigNumber, Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {parseUnits} from "ethers/lib/utils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";


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


describe('UniswapV3ConverterStrategyUniversalTest', async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  // [asset, pool, tickRange, rebalanceTickRange]
  const targets: [string, string, number, number][] = [
    [MaticAddresses.USDC_TOKEN, MaticAddresses.UNISWAPV3_USDC_USDT_100, 0, 0],
    [MaticAddresses.USDC_TOKEN, MaticAddresses.UNISWAPV3_USDC_WETH_500, 1200, 40],
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
    await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));
  });

  after(async function() {
    for (const poolId of Object.keys(states)) {
      const pathOut = `./tmp/uniswapv3-universal-${poolId}-snapshots.csv`;
      await StateUtils.saveListStatesToCSVColumns(pathOut, states[poolId], statesParams[poolId])
      await StateUtils.outputProfit(states[poolId])
    }
  });

  targets.forEach(t => {
    const strategyName = 'UniswapV3ConverterStrategy';
    const asset = t[0];
    const reinvestThresholdPercent = 1_000; // 1%
    const params: IUniversalStrategyInputParams = {
      ppfsDecreaseAllowed: false,
      balanceTolerance: 0.000001, // looks like some rounding issues with 6-decimals tokens
      deposit: 100_000,
      loops: 4, // an even number of iterations triggers the same number of swap1 and swap2
      loopValue: 2000,
      advanceBlocks: true,
      specificTests: [],
      hwParams: {
        compoundRate: 100_000, // 50%
      },
      stateRegistrar: async(title, h) => {
        const strategy = h.strategy as unknown as UniswapV3ConverterStrategy
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
        await PriceOracleImitatorUtils.uniswapV3(user, t[1], t[0])
      },
      swap1: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const univ3Strategy = strategy as unknown as UniswapV3ConverterStrategy
        const state = await univ3Strategy.getState()
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('500000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        await UniswapV3StrategyUtils.movePriceUp(
          swapUser,
          strategy.address,
          MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          swapAmount,
        );
      },
      swap2: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const univ3Strategy = strategy as unknown as UniswapV3ConverterStrategy
        const state = await univ3Strategy.getState()
        const tokenBPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenB)
        const tokenBDecimals = await IERC20Metadata__factory.connect(state.tokenB, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('500000', 8)).div(tokenBPrice).mul(parseUnits('1', tokenBDecimals))
        await UniswapV3StrategyUtils.movePriceDown(
          swapUser,
          strategy.address,
          MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          swapAmount,
        );
      },
      rebalancingStrategy: true,
      makeVolume: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const univ3Strategy = strategy as unknown as UniswapV3ConverterStrategy
        const state = await univ3Strategy.getState()
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('500000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        await UniswapV3StrategyUtils.makeVolume(
          swapUser,
          strategy.address,
          MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
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
        const strategy = UniswapV3ConverterStrategy__factory.connect(strategyProxy, signer);
        await strategy.init(core.controller, splitterAddress, tetuConverterAddress, t[1], t[2], t[3]);
        const mainAssetSymbol = await IERC20Metadata__factory.connect(asset, signer).symbol()
        statesParams[t[1]] = {
          mainAssetSymbol,
        }
        const state = await strategy.getState()
        const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [state.tokenA, state.tokenB])
        await strategy.setStrategyProfitHolder(profitHolder.address)
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