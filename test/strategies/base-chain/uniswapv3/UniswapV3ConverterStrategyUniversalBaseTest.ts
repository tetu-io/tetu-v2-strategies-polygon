/* tslint:disable:no-trailing-whitespace */
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {Misc} from "../../../../scripts/utils/Misc";
import {IState, IStateParams, StateUtils} from "../../../baseUT/universalTestUtils/StateUtils";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {ethers} from "hardhat";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {IUniversalStrategyInputParams} from "../../base/UniversalStrategyTest";
import {
  ControllerV2__factory,
  IERC20Metadata__factory,
  IPairBasedDefaultStateProvider__factory,
  IRebalancingV2Strategy__factory,
  IStrategyV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory, UniswapV3Lib,
} from '../../../../typechain';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {BigNumber, Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {parseUnits} from "ethers/lib/utils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {BASE_NETWORK_ID, HardhatUtils} from '../../../baseUT/utils/HardhatUtils';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";

// const {expect} = chai;
chai.use(chaiAsPromised);


describe('UniswapV3ConverterStrategyUniversalBaseTest', async () => {

  // [asset, pool, tickRange, rebalanceTickRange]
  const targets: [string, string, number, number][] = [
    [BaseAddresses.USDbC_TOKEN, BaseAddresses.UNISWAPV3_USDC_USDbC_100, 0, 0],
    [BaseAddresses.USDbC_TOKEN, BaseAddresses.UNISWAPV3_DAI_USDbC_100, 0, 0],
  ]
  const tetuConverterAddress = ethers.utils.getAddress(BaseAddresses.TETU_CONVERTER)
  const states: {[poolId: string]: IState[]} = {};
  const statesParams: {[poolId: string]: IStateParams} = {}

  let snapshotBefore: string;
  const deployInfo: DeployInfo = new DeployInfo();
  let core: CoreAddresses;

  before(async function() {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    await StrategyTestUtils.deployCoreAndInit(deployInfo);
    core = Addresses.CORE.get(Misc.getChainId()) as CoreAddresses;

    const [signer] = await ethers.getSigners();
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer, core, tetuConverterAddress);
    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);

    const pools = [
      {
        pool: BaseAddresses.AERODROME_WETH_WELL_VOLATILE_AMM,
        swapper: BaseAddresses.TETU_LIQUIDATOR_DYSTOPIA_SWAPPER,
        tokenIn: BaseAddresses.WELL_TOKEN,
        tokenOut: BaseAddresses.WETH_TOKEN
      },
    ]
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const operator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(operator).addLargestPools(pools, true);

    await StrategyTestUtils.deployAndSetCustomSplitter(signer, core);
  });

  after(async function() {
    for (const poolId of Object.keys(states)) {
      const pathOut = `./tmp/uniswapv3-universal-${poolId}-snapshots.csv`;
      await StateUtils.saveListStatesToCSVColumns(pathOut, states[poolId], statesParams[poolId])
      await StateUtils.outputProfit(states[poolId])
    }
    await TimeUtils.rollback(snapshotBefore);
  });

  targets.forEach(t => {
    const strategyName = 'UniswapV3ConverterStrategy';
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
        const state = await PackedData.getDefaultState(IPairBasedDefaultStateProvider__factory.connect(strategy.address, strategy.provider))
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, user).decimals()
        const tokenBDecimals = await IERC20Metadata__factory.connect(state.tokenB, user).decimals()
        await StrategyTestUtils.setThresholds(
          strategy,
          user,
          {
            reinvestThresholdPercent,
            rewardLiquidationThresholds: [
              {
                asset: state.tokenA,
                threshold: parseUnits('0.0001', tokenADecimals),
              },
              {
                asset: state.tokenB,
                threshold: parseUnits('0.0001', tokenBDecimals),
              },
            ]
          },
        );
        await ConverterUtils.addToWhitelist(user, tetuConverterAddress, strategy.address);

        // await PriceOracleImitatorUtils.uniswapV3(user, t[1], t[0])
      },
      swap1: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const univ3Strategy = strategy as unknown as UniswapV3ConverterStrategy
        const state = await PackedData.getDefaultState(univ3Strategy);
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('20000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        // const swapAmountPortion = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
        //   swapUser,
        //   {
        //     strategy: IRebalancingV2Strategy__factory.connect(univ3Strategy.address, strategy.signer),
        //     quoter: MaticAddresses.UNISWAPV3_QUOTER,
        //     lib: await DeployerUtils.deployContract(swapUser, 'UniswapV3Lib') as UniswapV3Lib,
        //     pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        //     swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER
        //   },
        //   state.tokenA,
        //   state.tokenB,
        //   true,
        // );
        await PairBasedStrategyPrepareStateUtils.movePriceBySteps(
          swapUser,
          {
            strategy: IRebalancingV2Strategy__factory.connect(univ3Strategy.address, strategy.signer),
            quoter: BaseAddresses.UNISWAPV3_QUOTER_V2,
            lib: await DeployerUtils.deployContract(swapUser, 'UniswapV3Lib') as UniswapV3Lib,
            pool: t[1],
            swapper: BaseAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER
          },
          true,
          state,
          swapAmount,
          undefined,
          3 // swapAmountPortion.gte(swapAmount) ? 1 : swapAmount.div(swapAmountPortion).toNumber()
        );
        // await UniversalUtils.movePoolPriceUp(
        //   swapUser,
        //   state,
        //   MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        //   swapAmount,
        // );
      },
      swap2: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const univ3Strategy = strategy as unknown as UniswapV3ConverterStrategy
        const state = await PackedData.getDefaultState(univ3Strategy);
        const tokenBPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenB)
        const tokenBDecimals = await IERC20Metadata__factory.connect(state.tokenB, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('20000', 8)).div(tokenBPrice).mul(parseUnits('1', tokenBDecimals))
        // const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
        //   swapUser,
        //   {
        //     strategy: IRebalancingV2Strategy__factory.connect(univ3Strategy.address, strategy.signer),
        //     quoter: MaticAddresses.UNISWAPV3_QUOTER,
        //     lib: await DeployerUtils.deployContract(swapUser, 'UniswapV3Lib') as UniswapV3Lib,
        //     pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        //     swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER
        //   },
        //   state.tokenA,
        //   state.tokenB,
        //   false,
        // );
        await PairBasedStrategyPrepareStateUtils.movePriceBySteps(
          swapUser,
          {
            strategy: IRebalancingV2Strategy__factory.connect(univ3Strategy.address, strategy.signer),
            quoter: BaseAddresses.UNISWAPV3_QUOTER_V2,
            lib: await DeployerUtils.deployContract(swapUser, 'UniswapV3Lib') as UniswapV3Lib,
            pool: t[1],
            swapper: BaseAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER
          },
          false,
          state,
          swapAmount,
          undefined,
          3
        );
        // await UniversalUtils.movePoolPriceDown(
        //   swapUser,
        //   state,
        //   MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        //   swapAmount,
        // );
      },
      rebalancingStrategy: true,
      makeVolume: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const univ3Strategy = strategy as unknown as UniswapV3ConverterStrategy
        const state = await PackedData.getDefaultState(univ3Strategy);
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('10000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        await UniversalUtils.makePoolVolume(
          swapUser,
          state,
          BaseAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
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
        await strategy.init(core.controller, splitterAddress, tetuConverterAddress, t[1], t[2], t[3], [0, 0, Misc.MAX_UINT, 0]);
        const mainAssetSymbol = await IERC20Metadata__factory.connect(asset, signer).symbol()
        statesParams[t[1]] = {
          mainAssetSymbol,
        }
        const state = await PackedData.getDefaultState(strategy);
        const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [state.tokenA, state.tokenB])
        const controllerV2 = await ControllerV2__factory.connect(core.controller, await DeployerUtilsLocal.getControllerGovernance(signer));
        if (! await controllerV2.isOperator(signer.address)) {
          await controllerV2.registerOperator(signer.address);
        }
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
