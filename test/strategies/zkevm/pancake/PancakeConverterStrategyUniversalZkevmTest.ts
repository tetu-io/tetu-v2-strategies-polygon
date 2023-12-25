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
  PancakeConverterStrategy,
  PancakeConverterStrategy__factory,
  PancakeLib,
  TetuVaultV2,
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
import {HardhatUtils, ZKEVM_NETWORK_ID} from '../../../baseUT/utils/HardhatUtils';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";
import {KeomUtils} from "../../../baseUT/utils/protocols/KeomUtils";

// const {expect} = chai;
chai.use(chaiAsPromised);


describe('PancakeConverterStrategyUniversalZkevmTest', async () => {
  const COUNT_ITERATIONS_IN_MOVING_PRICE = 2;
  const SWAP_AMOUNT_1 = "20000";
  const SWAP_AMOUNT_2 = "15000";

  // [asset, pool, tickRange, rebalanceTickRange]
  const targets: [string, string, number, number][] = [
    [ZkevmAddresses.USDC_TOKEN, ZkevmAddresses.PANCAKE_POOL_USDT_USDC_LP, 0, 0],
  ]
  const tetuConverterAddress = ethers.utils.getAddress(ZkevmAddresses.TETU_CONVERTER)
  const states: {[poolId: string]: IState[]} = {};
  const statesParams: {[poolId: string]: IStateParams} = {}

  let snapshotBefore: string;
  const deployInfo: DeployInfo = new DeployInfo();
  let core: CoreAddresses;
  let pancakeLib: PancakeLib;

  before(async function() {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    await StrategyTestUtils.deployCoreAndInit(deployInfo);
    core = Addresses.CORE.get(Misc.getChainId()) as CoreAddresses;

    const [signer] = await ethers.getSigners();
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer, core, tetuConverterAddress);
    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);

    await KeomUtils.disableHeartbeatZkEvm(signer, ZkevmAddresses.KEOM_COMPTROLLER);

    const pools = [
      {
        pool: ZkevmAddresses.PANCAKE_POOL_CAKE_WETH_10000,
        swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
        tokenIn: ZkevmAddresses.PANCAKE_SWAP_TOKEN,
        tokenOut: ZkevmAddresses.WETH_TOKEN
      },
    ]
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const operator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(operator).addLargestPools(pools, true);

    await StrategyTestUtils.deployAndSetCustomSplitter(signer, core);
    pancakeLib = await DeployerUtils.deployContract(signer, 'PancakeLib') as PancakeLib;
  });

  after(async function() {
    for (const poolId of Object.keys(states)) {
      const pathOut = `./tmp/pancake-universal-${poolId}-snapshots.csv`;
      await StateUtils.saveListStatesToCSVColumns(pathOut, states[poolId], statesParams[poolId])
      await StateUtils.outputProfit(states[poolId])
    }
    await TimeUtils.rollback(snapshotBefore);
  });

  targets.forEach(t => {
    const strategyName = 'PancakeConverterStrategy';
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
        const strategy = h.strategy as unknown as PancakeConverterStrategy
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
      },
      swap1: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const pancakeStrategy = strategy as unknown as PancakeConverterStrategy
        const state = await PackedData.getDefaultState(pancakeStrategy);
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits(SWAP_AMOUNT_1, 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))

        await PairBasedStrategyPrepareStateUtils.movePriceBySteps(
          swapUser,
          {
            strategy: IRebalancingV2Strategy__factory.connect(pancakeStrategy.address, strategy.signer),
            quoter: ZkevmAddresses.PANCAKE_QUOTER_V2,
            lib: pancakeLib,
            pool: t[1],
            swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER
          },
          true,
          state,
          swapAmount,
          undefined,
          COUNT_ITERATIONS_IN_MOVING_PRICE // swapAmountPortion.gte(swapAmount) ? 1 : swapAmount.div(swapAmountPortion).toNumber()
        );

      },
      swap2: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const pancakeStrategy = strategy as unknown as PancakeConverterStrategy
        const state = await PackedData.getDefaultState(pancakeStrategy);
        const tokenBPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenB)
        const tokenBDecimals = await IERC20Metadata__factory.connect(state.tokenB, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits(SWAP_AMOUNT_2, 8)).div(tokenBPrice).mul(parseUnits('1', tokenBDecimals))

        await PairBasedStrategyPrepareStateUtils.movePriceBySteps(
          swapUser,
          {
            strategy: IRebalancingV2Strategy__factory.connect(pancakeStrategy.address, strategy.signer),
            quoter: ZkevmAddresses.PANCAKE_QUOTER_V2,
            lib: pancakeLib,
            pool: t[1],
            swapper: ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER
          },
          false,
          state,
          swapAmount,
          undefined,
          COUNT_ITERATIONS_IN_MOVING_PRICE
        );
      },
      rebalancingStrategy: true,
      makeVolume: async(strategy: IStrategyV2, swapUser: SignerWithAddress) => {
        const pancakeStrategy = strategy as unknown as PancakeConverterStrategy
        const state = await PackedData.getDefaultState(pancakeStrategy);
        const tokenAPrice = await PriceOracleImitatorUtils.getPrice(swapUser, state.tokenA)
        const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, swapUser).decimals()
        const swapAmount = BigNumber.from(parseUnits('10000', 8)).div(tokenAPrice).mul(parseUnits('1', tokenADecimals))
        await UniversalUtils.makePoolVolume(
          swapUser,
          state,
          ZkevmAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
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
        const strategy = PancakeConverterStrategy__factory.connect(strategyProxy, signer);
        await strategy.init(core.controller, splitterAddress, tetuConverterAddress, t[1], t[2], t[3], [0, 0, Misc.MAX_UINT, 0], ZkevmAddresses.PANCAKE_MASTER_CHEF_V3);
        const mainAssetSymbol = await IERC20Metadata__factory.connect(asset, signer).symbol()
        statesParams[t[1]] = {
          mainAssetSymbol,
        }
        const state = await PackedData.getDefaultState(strategy);
        const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [state.tokenA, state.tokenB, ZkevmAddresses.PANCAKE_SWAP_TOKEN])
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
