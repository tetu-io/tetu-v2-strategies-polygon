import {
  ControllerV2__factory,
  ConverterStrategyBase__factory, IERC20__factory, IRebalancingV2Strategy,
  IRebalancingV2Strategy__factory, StrategySplitterV2__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from '../baseUT/utils/HardhatUtils';
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {PackedData} from "../baseUT/utils/PackedData";
import {AggregatorUtils} from "../baseUT/utils/AggregatorUtils";
import {ENTRY_TO_POOL_DISABLED, ENTRY_TO_POOL_IS_ALLOWED, PLAN_SWAP_REPAY} from "../baseUT/AppConstants";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import hre, {ethers} from "hardhat";
import {CaptureEvents, IEventsSet} from "../baseUT/strategies/CaptureEvents";
import fs from "fs";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {makeFullWithdraw} from "../../scripts/utils/WithdrawAllByAggUtils";
import {PLATFORM_KYBER} from "../baseUT/strategies/AppPlatforms";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {Misc} from "../../scripts/utils/Misc";

describe("Scb807-899 @skip-on-coverage", () => {
  let snapshotBefore: string;
  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  describe("SCB-807: rebalanceNoSwaps, reproduce TS-23", () => {
    const BLOCK = 47962547;
    const STRATEGY = "0x4b8bd2623d7480850e406b9f2960305f44c7adeb";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";
    const pathOut = "./tmp/ts23-rebalanceNoSwaps.csv";
    const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
    const aggregator = "0x1111111254EEB25477B68fb85Ed929f73A960582";

    async function tryWithdrawByAgg(
      signer: SignerWithAddress,
      strategy: IRebalancingV2Strategy,
      saveStates: (title: string, eventsSet?: IEventsSet) => void,
    ) {
      const state = await PackedData.getDefaultState(strategy);
      const operator = await DeployerUtilsLocal.impersonate(OPERATOR);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const planEntryData = "0x0000000000000000000000000000000000000000000000000000000000000001ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      const swapData = await AggregatorUtils.buildSwapTransactionData(
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
      saveStates("w", eventsSet);
    }

    it("try rebalanceNoSwaps", async () => {

      const states: IStateNum[] = [];

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };

      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];
      // await HardhatUtils.switchToBlock(BLOCK - 2);
      await HardhatUtils.switchToMostCurrentBlock();

      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
        signer
      );

      await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategy");

      await saver("b");

      await makeFullWithdraw(strategyAsOperator, {
        entryToPool: ENTRY_TO_POOL_DISABLED,
        planEntryDataGetter: async () => defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]),
        saveStates: saver
      })
      // await tryWithdrawByAgg(signer, strategy, saver);

      const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      await saver("a", eventsSet);
    });
  });

  describe("SCB-807: reproduce direct and reverse debts at the same time", () => {
    // SCB-807: There is single reverse borrow in 47821752, there are two borrows (reverse + debt) in the block 47821753
    const BLOCK = 47821752;
    const pathOut = "./tmp/debts-two-directions.csv";

    const STRATEGY = "0x4b8bd2623d7480850e406b9f2960305f44c7adeb";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";
    const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
    const aggregator = "0x1111111254EEB25477B68fb85Ed929f73A960582";

    it("try to make action", async () => {
      await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
      await HardhatUtils.switchToBlock(BLOCK);

      const states: IStateNum[] = [];

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };

      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];

      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const splitter = StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator);
      const vault = TetuVaultV2__factory.connect(await splitter.vault(), signer);

      await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategy");

      await saver("b");

      await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(MaticAddresses.USDC_TOKEN, signer.address, parseUnits('1000', 6));
      await vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

      await saver("d");

      // const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      // await saver("a", eventsSet);
    });

    it("check events", async () => {
      await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
      await HardhatUtils.switchToMostCurrentBlock();

      const b = await hre.ethers.provider.getBlockWithTransactions(BLOCK);
      let counter = 0;
      for (const tx of b.transactions) {
        console.log("counter", counter++);
        try {
          const cr = await tx.wait();
          const hr = await CaptureEvents.handleReceipt(cr, 6, PLATFORM_KYBER);
          console.log("blockHash", tx.blockHash);
          console.log("hr", hr);
        } catch (e) {
          console.log(e);
        }
      }
    })
  });

  describe("rebalanceNoSwaps, reproduce high loss", () => {
    const BLOCK = 48635757;
    const STRATEGY = "0x792bcc2f14fdcb9faf7e12223a564e7459ea4201";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";
    const pathOut = "./tmp/rebalanceNoSwaps-high-loss.csv";
    const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

    it("rebalanceNoSwaps", async () => {

      const states: IStateNum[] = [];

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };

      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];
      await HardhatUtils.switchToBlock(BLOCK - 1);
      // await HardhatUtils.switchToMostCurrentBlock();

      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
        signer
      );

      // await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategy");

      await saver("b");

      const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      await saver("a", eventsSet);
    });
  });

  describe("send amount to insurance twice", () => {
    const BLOCK = 48662469;
    const STRATEGY = "0x792bcc2f14fdcb9faf7e12223a564e7459ea4201";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";
    const pathOut = "./tmp/hardwork-insurance-twice.csv";
    const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

    it("doHardWork", async () => {

      const states: IStateNum[] = [];

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };

      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];
      await HardhatUtils.switchToBlock(BLOCK - 1);
      // await HardhatUtils.switchToMostCurrentBlock();

      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
        signer
      );
      const splitter = await vault.splitter();

      await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategy");

      await saver("b");
      const strategyAsSplitter = converterStrategyBase.connect(await DeployerUtilsLocal.impersonate(splitter));
      const eventsSet = await CaptureEvents.makeHardwork(strategyAsSplitter);
      await saver("a", eventsSet);
    });
  });

  describe("SCB-818: rebalanceNoSwaps, reproduce TS-23", () => {
    const BLOCK = 48773278;
    const STRATEGY = "0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";
    const pathOut = "./tmp/rebalanceNoSwaps-ts23.csv";
    const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

    it("rebalanceNoSwaps", async () => {

      const states: IStateNum[] = [];

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };

      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];
      await HardhatUtils.switchToBlock(BLOCK - 1);
      // await HardhatUtils.switchToMostCurrentBlock();

      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
        signer
      );

      await InjectUtils.injectTetuConverter(signer);
      await InjectUtils.injectStrategy(signer, STRATEGY, "AlgebraConverterStrategy");

      await saver("b");

      const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      await saver("a", eventsSet);
    });
  });
});
