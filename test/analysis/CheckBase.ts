import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {
  ControllerV2__factory,
  ConverterStrategyBase__factory, IPairBasedStrategyReaderAccess__factory,
  IRebalancingV2Strategy__factory, ITetuConverter__factory, PairBasedStrategyReader__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory
} from '../../typechain';
import {InjectUtils} from '../baseUT/strategies/InjectUtils';
import {IStateNum, StateUtilsNum} from '../baseUT/utils/StateUtilsNum';
import {CaptureEvents, IEventsSet} from '../baseUT/strategies/CaptureEvents';
import fs from 'fs';
import {ENTRY_TO_POOL_IS_ALLOWED} from '../baseUT/AppConstants';
import {BaseAddresses} from '../../scripts/addresses/BaseAddresses';
import {buildEntryData1} from '../baseUT/utils/EntryDataUtils';
import {
  AGGREGATOR_ONE_INCH,
  AGGREGATOR_OPEN_OCEAN,
  AGGREGATOR_TETU_LIQUIDATOR,
  AggregatorUtils
} from '../baseUT/utils/AggregatorUtils';
import {PackedData} from '../baseUT/utils/PackedData';
import {MockHelper} from '../baseUT/helpers/MockHelper';
import {Misc} from "../../scripts/utils/Misc";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MockAggregatorUtils} from "../baseUT/mocks/MockAggregatorUtils";
import {BigNumber} from "ethers";

describe("Check actions on base @skip-on-coverage", () => {
  const BLOCK = 8498893; // 7981926;
  // const BLOCK = 7981927 - 2;
  const STRATEGY = "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e";
  const CONTROLLER = "0x255707B70BF90aa112006E1b07B9AeA6De021424";
  const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
  const SPLITTER = "0xA01ac87f8Fc03FA2c497beFB24C74D538958DAbA";

  let signer: SignerWithAddress;

  let snapshotBefore: string;
  beforeEach(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID, BLOCK);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    // const signer = await DeployerUtilsLocal.impersonate(SENDER);
    signer = await DeployerUtilsLocal.impersonate(SENDER);
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  async function injectStrategy() {
    // await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
    await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
    // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);
  }

  it("try to rebalance", async () => {
    const pathOut = "./tmp/checkBase-rebalance.csv";
    const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
      signer
    );

    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const saver = async (title: string, e?: IEventsSet) => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: BaseAddresses.USDC_TOKEN});
    };

    await injectStrategy();

    await saver("b");
    if (await strategyAsOperator.needRebalance()) {
      const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      await saver("a", eventsSet);
    } else {
      console.log("no rebalance needed");
    }
  });

  it("try withdrawByAgg 1inch", async () => {
    const pathOut = "./tmp/checkBase-withdrawByAgg-1inch.csv";

    const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
      signer
    );

    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const saver = async (title: string, e?: IEventsSet): Promise<IStateNum> => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: BaseAddresses.USDbC_TOKEN});
      return states[states.length - 1];
    };

    await injectStrategy();

    const state = await PackedData.getDefaultState(strategyAsOperator);
    const reader = await MockHelper.createPairBasedStrategyReader(signer);
    // const reader = PairBasedStrategyReader__factory.connect("0xE28E3146306Ff247b00cccE00D7893775B0FB696", signer);
    const requiredAmountToReduceDebt = await reader.getAmountToReduceDebtForStrategy(STRATEGY, 5);
    console.log("requiredAmountToReduceDebt", requiredAmountToReduceDebt);

    const stateBefore = await saver("b");
    console.log("stateBefore", stateBefore);

    const planEntryData = buildEntryData1(requiredAmountToReduceDebt);

    console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
    const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
    console.log("quote", quote);
    console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

    const swapData = await AggregatorUtils.buildSwapData(
      signer,
      BASE_NETWORK_ID,
      AGGREGATOR_ONE_INCH,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
      quote.amountToSwap,
      strategyAsOperator.address,
    );

    const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
      strategyAsOperator,
      quote.tokenToSwap,
      BaseAddresses.AGG_ONEINCH_V5,
      quote.amountToSwap,
      swapData,
      planEntryData,
      ENTRY_TO_POOL_IS_ALLOWED,
    );
    console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
    const stateAfter = await saver("a", eventsSet);
    console.log("stateAfter", stateAfter);
  });

  it("try withdrawByAgg OpenOcean", async () => {
    const pathOut = "./tmp/checkBase-withdrawByAgg-open-ocean.csv";

    const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
      signer
    );

    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const saver = async (title: string, e?: IEventsSet): Promise<IStateNum> => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: BaseAddresses.USDbC_TOKEN});
      return states[states.length - 1];
    };

    await injectStrategy();

    const state = await PackedData.getDefaultState(strategyAsOperator);
    const reader = await MockHelper.createPairBasedStrategyReader(signer);
    // const reader = PairBasedStrategyReader__factory.connect("0xE28E3146306Ff247b00cccE00D7893775B0FB696", signer);
    const requiredAmountToReduceDebt = await reader.getAmountToReduceDebtForStrategy(STRATEGY, 5);
    console.log("requiredAmountToReduceDebt", requiredAmountToReduceDebt);

    const stateBefore = await saver("b");
    console.log("stateBefore", stateBefore);

    const planEntryData = buildEntryData1(requiredAmountToReduceDebt);

    console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
    const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
    console.log("quote", quote);
    console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

    const swapData = await AggregatorUtils.buildSwapData(
      signer,
      BASE_NETWORK_ID,
      AGGREGATOR_OPEN_OCEAN,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
      quote.amountToSwap,
      strategyAsOperator.address,
    );

    const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
      strategyAsOperator,
      quote.tokenToSwap,
      BaseAddresses.AGG_OPENOCEAN,
      quote.amountToSwap,
      swapData,
      planEntryData,
      ENTRY_TO_POOL_IS_ALLOWED,
    );
    console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
    const stateAfter = await saver("a", eventsSet);
    console.log("stateAfter", stateAfter);
  });

  it("try withdrawByAgg MockSwapper", async () => {
    const pathOut = "./tmp/checkBase-withdrawByAgg-mock-swapper.csv";

    const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
      signer
    );

    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const saver = async (title: string, e?: IEventsSet): Promise<IStateNum> => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: BaseAddresses.USDbC_TOKEN});
      return states[states.length - 1];
    };

    await injectStrategy();

    const mockSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
      token0: BaseAddresses.USDC_TOKEN,
      token1: BaseAddresses.USDbC_TOKEN,
      converter: BaseAddresses.TETU_CONVERTER,
      percentToIncrease: 114,
      increaseOutput: false
    });
    await MockAggregatorUtils.injectSwapperToLiquidator(
      BaseAddresses.TETU_LIQUIDATOR,
      [
        {
          pool: "0x06959273E9A65433De71F5A452D529544E07dDD0",
          swapper: mockSwapper.address,
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenOut: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"
        },
      ],
      mockSwapper.address
    );

    const state = await PackedData.getDefaultState(strategyAsOperator);
    const reader = await MockHelper.createPairBasedStrategyReader(signer);
    // const reader = PairBasedStrategyReader__factory.connect("0xE28E3146306Ff247b00cccE00D7893775B0FB696", signer);
    const requiredAmountToReduceDebt = await reader.getAmountToReduceDebtForStrategy(STRATEGY, 5);
    console.log("requiredAmountToReduceDebt", requiredAmountToReduceDebt);

    const stateBefore = await saver("b");
    console.log("stateBefore", stateBefore);

    const planEntryData = buildEntryData1(requiredAmountToReduceDebt);

    console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
    const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
    console.log("quote", quote);
    console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

    const swapData = await AggregatorUtils.buildSwapData(
      signer,
      BASE_NETWORK_ID,
      AGGREGATOR_TETU_LIQUIDATOR,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
      quote.amountToSwap,
      strategyAsOperator.address,
    );

    const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
      strategyAsOperator,
      quote.tokenToSwap,
      Misc.ZERO_ADDRESS,
      quote.amountToSwap,
      swapData,
      planEntryData,
      ENTRY_TO_POOL_IS_ALLOWED,
    );
    console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
    const stateAfter = await saver("a", eventsSet);
    console.log("stateAfter", stateAfter);
  });

  it("doHardWork", async () => {
    const pathOut = "./tmp/checkBase-hardwork.csv";
    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const saver = async (title: string, e?: IEventsSet) => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: BaseAddresses.USDbC_TOKEN});
    };

    const operator = await Misc.impersonate((await ControllerV2__factory.connect(CONTROLLER, signer).operatorsList())[0]);

    const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
      signer
    );
    const splitter = await vault.splitter();

    await injectStrategy();

    await saver("b");
    const strategyAsSplitter = converterStrategyBase.connect(await DeployerUtilsLocal.impersonate(splitter));
    if (await strategyAsOperator.needRebalance()) {
      console.log("makeRebalanceNoSwap");
      const eventsSet0 = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      await saver("nsr", eventsSet0);
    }


    console.log("makeHardwork");
    const eventsSet = await CaptureEvents.makeHardwork(strategyAsSplitter);
    await saver("a", eventsSet);
  });
});