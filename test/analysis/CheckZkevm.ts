import {BASE_NETWORK_ID, HardhatUtils, ZKEVM_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {
  ControllerV2__factory,
  ConverterStrategyBase__factory, IPairBasedStrategyReaderAccess__factory,
  IRebalancingV2Strategy__factory, PairBasedStrategyReader__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory
} from '../../typechain';
import {InjectUtils} from '../baseUT/strategies/InjectUtils';
import {IStateNum, StateUtilsNum} from '../baseUT/utils/StateUtilsNum';
import {CaptureEvents, IEventsSet} from '../baseUT/strategies/CaptureEvents';
import fs from 'fs';
import {ENTRY_TO_POOL_IS_ALLOWED} from '../baseUT/AppConstants';
import {buildEntryData1} from '../baseUT/utils/EntryDataUtils';
import {AggregatorUtils} from '../baseUT/utils/AggregatorUtils';
import {PackedData} from '../baseUT/utils/PackedData';
import {MockHelper} from '../baseUT/helpers/MockHelper';
import {ethers} from "hardhat";
import {Misc} from "../../scripts/utils/Misc";
import {ZkevmAddresses} from "../../scripts/addresses/ZkevmAddresses";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {parseUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory} from "../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";

async function injectStrategy() {
  // await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
  // await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
}

describe("Check actions on zkEVM @skip-on-coverage", () => {
  const BLOCK = 8859887;
  const STRATEGY = "0x6A4436f1D062Ee73F7bE2ebE7395CE6346586101";
  const CONTROLLER = "0x33b27e0a2506a4a2fbc213a01c51d0451745343a";
  const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
  const VAULT = "0x3650823873F34a019533db164f492e09365cfa7E";
  // const SPLITTER = "";

  let snapshotBefore: string;
  beforeEach(async function () {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID, BLOCK);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  it("try to rebalance", async () => {
    const pathOut = "./tmp/checkPolygon-rebalance.csv";
    const signer = await DeployerUtilsLocal.impersonate(SENDER);
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
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: ZkevmAddresses.USDC_TOKEN});
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

  it("try withdrawByAgg", async () => {
    const pathOut = "./tmp/checkPolygon-withdrawByAgg.csv";
    const signer = await DeployerUtilsLocal.impersonate(SENDER);

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
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: ZkevmAddresses.USDC_TOKEN});
      return states[states.length - 1];
    };

    await injectStrategy();

    const aggregator = ZkevmAddresses.AGG_OPENOCEAN_ROUTER;

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

    const swapData = await AggregatorUtils.buildSwapTransactionDataForOpenOcean(
      signer,
      ZKEVM_NETWORK_ID,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
      quote.amountToSwap,
      strategyAsOperator.address,
    );

    const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
      strategyAsOperator,
      quote.tokenToSwap,
      aggregator,
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
    const pathOut = "./tmp/checkPolygon-hardwork.csv";
    const states: IStateNum[] = [];

    console.log("-------------------------------- prepare saver");
    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const saver = async (title: string, e?: IEventsSet) => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: ZkevmAddresses.USDC_TOKEN});
    };

    // const signer = await DeployerUtilsLocal.impersonate(SENDER);
    const signer = (await ethers.getSigners())[0];


    console.log("-------------------------------- get addresses");
    const operator = await Misc.impersonate((await ControllerV2__factory.connect(CONTROLLER, signer).operatorsList())[0]);
    const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
      signer
    );
    const splitter = await vault.splitter();


    console.log("-------------------------------- inject strategy");
    await injectStrategy();


    console.log("-------------------------------- make hardwork");
    await saver("b");
    const strategyAsSplitter = converterStrategyBase.connect(await DeployerUtilsLocal.impersonate(splitter));
    if (await strategyAsOperator.needRebalance()) {
      console.log("makeRebalanceNoSwap");
      await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
    }

    console.log("makeHardwork");
    const eventsSet = await CaptureEvents.makeHardwork(strategyAsSplitter);
    await saver("a", eventsSet);
  });

  it("Try to deposit", async () => {
    const signer = (await ethers.getSigners())[0];

    const asset = IERC20Metadata__factory.connect(ZkevmAddresses.USDC_TOKEN, signer);
    await asset.approve(VAULT, Misc.MAX_UINT);
    await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
    await TetuVaultV2__factory.connect(VAULT, signer).deposit(parseUnits('1000', 6), signer.address);
    console.log(await TetuVaultV2__factory.connect(VAULT, signer).maxWithdraw(signer.address));
  });
});