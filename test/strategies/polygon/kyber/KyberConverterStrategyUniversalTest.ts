/* tslint:disable:no-trailing-whitespace */
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {getConverterAddress, getDForcePlatformAdapter, Misc} from "../../../../scripts/utils/Misc";
import {IState, IStateParams, StateUtils} from "../../../baseUT/universalTestUtils/StateUtils";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import hre, {ethers} from "hardhat";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {IUniversalStrategyInputParams} from "../../base/UniversalStrategyTest";
import {IERC20Metadata__factory, IStrategyV2, KyberConverterStrategy, KyberConverterStrategy__factory, TetuVaultV2,} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {BigNumber, Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {parseUnits} from "ethers/lib/utils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {
  KYBER_PID_DEFAULT_BLOCK,
  KYBER_USDC_DAI_PID_DEFAULT_BLOCK
} from '../../../baseUT/strategies/pair/PairBasedStrategyBuilder';
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";

// const {expect} = chai;
chai.use(chaiAsPromised);

/// Kyber is not used after security incident nov-2023
describe.skip('KyberConverterStrategyUniversalTest', async () => {
  // [asset, pool, tickRange, rebalanceTickRange, incentiveKey]
  const targets: [string, string, number, number, number][] = [
    [MaticAddresses.USDC_TOKEN, MaticAddresses.KYBER_USDC_USDT, 0, 0, KYBER_PID_DEFAULT_BLOCK],
    [MaticAddresses.USDC_TOKEN, MaticAddresses.KYBER_USDC_DAI, 0, 0, KYBER_USDC_DAI_PID_DEFAULT_BLOCK],
  ]

  const deployInfo: DeployInfo = new DeployInfo();
  const core = Addresses.getCore();
  const tetuConverterAddress = getConverterAddress();
  const states: {[poolId: string]: IState[]} = {};
  const statesParams: {[poolId: string]: IStateParams} = {}

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    await StrategyTestUtils.deployCoreAndInit(deployInfo);

    const [signer] = await ethers.getSigners();

    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await StrategyTestUtils.deployAndSetCustomSplitter(signer, core);
    // Disable DForce (as it reverts on repay after block advance)
    // await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));

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
    await HardhatUtils.restoreBlockFromEnv();
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
          state,
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
          state,
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
          state,
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
          t[4],
            [0, 0, Misc.MAX_UINT, 0],
        );
        const mainAssetSymbol = await IERC20Metadata__factory.connect(asset, signer).symbol()
        statesParams[t[1]] = {
          mainAssetSymbol,
        }
        const state = await PackedData.getDefaultState(strategy);
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
