import {PairBasedStrategyPrepareStateUtils} from "../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {ConverterStrategyBase__factory, IRebalancingV2Strategy__factory, StrategySplitterV2__factory, TetuVaultV2__factory, UniswapV3ConverterStrategy__factory} from "../../typechain";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../baseUT/utils/HardhatUtils';
import {defaultAbiCoder} from "ethers/lib/utils";
import {PackedData} from "../baseUT/utils/PackedData";
import {Misc} from "../../scripts/utils/Misc";
import {BigNumber, BytesLike} from "ethers";
import {AggregatorUtils} from "../baseUT/utils/AggregatorUtils";
import {ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY} from "../baseUT/AppConstants";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {ethers} from "hardhat";
import {CaptureEvents} from "../baseUT/strategies/CaptureEvents";
import fs from "fs";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";

describe("Scb777, scb779-reproduce @skip-on-coverage", () => {
  describe("SCB-777: withdrawByAgg, TC-29", () => {
    const BLOCK = 46387161;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

    let snapshotBefore: string;
    before(async function () {
      await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
      snapshotBefore = await TimeUtils.snapshot();
      await HardhatUtils.switchToBlock(BLOCK);
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
      await HardhatUtils.restoreBlockFromEnv();
    });

    it("try to reproduce", async () => {
      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      await InjectUtils.injectTetuConverter(signer);

      await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
        strategy,
        MaticAddresses.TETU_LIQUIDATOR,
          () => true // single iteration
      );
    });
  });

  describe("SCB-779: withdraw, sb too high", () => {
    const BLOCK = 46387104;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SPLITTER = "0xA31cE671A0069020F7c87ce23F9cAAA7274C794c";
    const AMOUNT = "181.211847";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
      await HardhatUtils.switchToBlock(BLOCK);
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
      await HardhatUtils.restoreBlockFromEnv();
    });

    it("try to reproduce", async () => {
      const [signer] = await ethers.getSigners();
      const splitterSigner = await DeployerUtilsLocal.impersonate(SPLITTER);
      const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, splitterSigner);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(SPLITTER, signer)).vault(),
        signer
      );
      const pathOut = "./tmp/scb-779.csv";

      await InjectUtils.injectStrategy(splitterSigner, STRATEGY, "UniswapV3ConverterStrategy");
      await InjectUtils.injectTetuConverter(splitterSigner);

      const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy.address, splitterSigner);
      // await converterStrategyBase.withdrawToSplitter(parseUnits(AMOUNT, 6));

      const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'before');
      await converterStrategyBase.withdrawAllToSplitter();
      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'after');
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [stateBefore, stateAfter], {mainAssetSymbol: "uscd"}, true);
    });
  });

  describe("SCB-778: withdrawByAgg, not enough balance", () => {
    const DELTA = 2;
    const BLOCK = 46405849;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("try to reproduce", async () => {
      await HardhatUtils.switchToBlock(BLOCK - DELTA);

      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
      const aggregator = MaticAddresses.TETU_LIQUIDATOR;

      // await PairBasedStrategyPrepareStateUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      const state = await PackedData.getDefaultState(strategyAsOperator);

      const planEntryData = defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]
      );

      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      await TimeUtils.advanceNBlocks(DELTA);

      let swapData: BytesLike = "0x";
      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

      if (tokenToSwap !== Misc.ZERO_ADDRESS) {
        if (aggregator === MaticAddresses.AGG_ONEINCH_V5) {
          swapData = await AggregatorUtils.buildSwapTransactionData(
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            quote.amountToSwap,
            strategyAsOperator.address,
          );
        } else if (aggregator === MaticAddresses.TETU_LIQUIDATOR) {
          swapData = AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
            tokenIn: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            tokenOut: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            amount: quote.amountToSwap,
            slippage: BigNumber.from(5_000)
          });
          console.log("swapData for tetu liquidator", swapData);
        }
      }
      console.log("unfoldBorrows.withdrawByAggStep.callStatic --------------------------------", quote);
      console.log("tokenToSwap", tokenToSwap);
      console.log("AGGREGATOR", aggregator) ;
      console.log("amountToSwap", amountToSwap);
      console.log("swapData", swapData);
      console.log("planEntryData", planEntryData);

      const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
        {gasLimit: 19_000_000}
      );

      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------", quote);
      await strategyAsOperator.withdrawByAggStep(
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
        {gasLimit: 19_000_000}
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");

      await HardhatUtils.restoreBlockFromEnv();
    });
  });

  describe("SCB-782: withdraw all, overflowed", () => {
    const BLOCK = 46568814;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SPLITTER = "0xA31cE671A0069020F7c87ce23F9cAAA7274C794c";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
      await HardhatUtils.switchToBlock(BLOCK);
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
      await HardhatUtils.restoreBlockFromEnv();
    });

    it("try to reproduce", async () => {
      const [signer] = await ethers.getSigners();
      const splitterSigner = await DeployerUtilsLocal.impersonate(SPLITTER);
      const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, splitterSigner);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(SPLITTER, signer)).vault(),
        signer
      );
      const pathOut = "./tmp/scb-779.csv";

      await InjectUtils.injectStrategy(splitterSigner, STRATEGY, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(splitterSigner);

      const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy.address, splitterSigner);

      const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'before');
      await converterStrategyBase.withdrawAllToSplitter();
      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'after');
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [stateBefore, stateAfter], {mainAssetSymbol: "uscd"}, true);
    });
  });

  describe("SCB-785: withdrawByAggStep enters to the pool with incorrect amoutns", () => {
    const BLOCK_DEPLOYED = 46650123;
    const BLOCK = 46689308;
    const STRATEGY = "0x4b8bd2623d7480850e406b9f2960305f44c7adeb";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("try to reproduce", async () => {
      // await HardhatUtils.switchToBlock(BLOCK_DEPLOYED);
      await HardhatUtils.switchToBlock(BLOCK - 1);
      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);

      const tokenToSwap = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
      const aggregator = "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64";
      const amountToSwap = "127677787";
      const swapData = "0x90411a32000000000000000000000000fe9a934a8607ef020adf22d4431d6ce6005aa4d3000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f000000000000000000000000fe9a934a8607ef020adf22d4431d6ce6005aa4d30000000000000000000000004b8bd2623d7480850e406b9f2960305f44c7adeb00000000000000000000000000000000000000000000000000000000079c355b0000000000000000000000000000000000000000000000000000000007930f6900000000000000000000000000000000000000000000000000000000079ccde10000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000104e5b07cdb0000000000000000000000007b925e617aefd7fb3a93abe3a701135d7a1ba710000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000079c355b000000000000000000000000fe9a934a8607ef020adf22d4431d6ce6005aa4d300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000002e2791bca1f2de4661ed88a30c99a7a9449aa84174000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000648a6a1e85000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f000000000000000000000000353c1f0bc78fbbc245b3c93ef77b1dcc5b77d2a027100000000000000000000000000000000000000000000000000000079ccde100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000001a49f865422000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000000000001000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000004400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000064d1660f99000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000004b8bd2623d7480850e406b9f2960305f44c7adeb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
      const planEntryData = "0x0000000000000000000000000000000000000000000000000000000000000001ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      const entryToPool = 1;

      // await PairBasedStrategyPrepareStateUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);
      // console.log("Injected");
      // const block = (await ethers.provider.getBlock("latest")).number;
      // await TimeUtils.advanceNBlocks(block - BLOCK);

      // for (let i = 0; i < 2; ++i) {
      //   const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      //   console.log("quote", BLOCK - 2 + i, quote);
      //   await TimeUtils.advanceNBlocks(1);
      // }

      const converterStrategyBase = await ConverterStrategyBase__factory.connect(STRATEGY, signer);
      const strategy = await IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
      const vault = TetuVaultV2__factory.connect(
        await ISplitter__factory.connect(await converterStrategyBase.splitter(), signer).vault(),
        signer
      );

      const state = await PackedData.getDefaultState(strategyAsOperator);
      const stateBefore = await StateUtilsNum.getStatePair(signer, signer, strategy, vault, `b`);

      console.log('block', (await ethers.provider.getBlock("latest")).number);
      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------");
      await strategyAsOperator.withdrawByAggStep(
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        entryToPool,
        {gasLimit: 19_000_000}
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
      const stateAfter = await StateUtilsNum.getStatePair(signer, signer, strategy, vault, `a`);

      await StateUtilsNum.saveListStatesToCSVColumns(
        "./tmp/test.csv",
        [stateBefore, stateAfter],
        {mainAssetSymbol: "usdc"},
        true
      );

      await HardhatUtils.restoreBlockFromEnv();
    });
  });

  describe("Kyber dai-usdc, decimals", () => {
    const BLOCK = 46725290;
    const STRATEGY = "0x8ec9134046740f83bded78d6ddcadaec42fc61b0";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("try to reproduce", async () => {
      // await HardhatUtils.switchToBlock(BLOCK_DEPLOYED);
      await HardhatUtils.switchToBlock(BLOCK - 1);
      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);

      const planEntryData = defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]
      );

      const block = (await ethers.provider.getBlock("latest")).number;
      console.log("block", block);

      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
      await TimeUtils.advanceNBlocks(1);

      await HardhatUtils.restoreBlockFromEnv();
    });
  });

  describe("SCB-787: hardwork out of gas", () => {
    const BLOCK = 46728471;
    const SPLITTER = "0xa31ce671a0069020f7c87ce23f9caaa7274c794c";
    const SENDER = "0xcc16d636dd05b52ff1d8b9ce09b09bc62b11412b";
    const STRATEGY = "0x4b8bd2623d7480850e406b9f2960305f44c7adeb";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
      await HardhatUtils.switchToBlock(BLOCK);
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
      await HardhatUtils.restoreBlockFromEnv();
    });

    it("try to reproduce", async () => {
      const [signer] = await ethers.getSigners();
      const sender = await DeployerUtilsLocal.impersonate(SENDER);
      const splitter = StrategySplitterV2__factory.connect(SPLITTER, sender);
      await splitter.doHardWork();

      await InjectUtils.injectStrategy(sender, SPLITTER, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(splitterSigner);
    });
  });

  describe("SCB-789: withdrawByAgg, not enough balance (quoteRepay without debt-gap)", () => {
    const DELTA = 0;
    const BLOCK = 46872907;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
    const pathOut = "./tmp/scb-778.csv";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("show quote", async () => {
      await HardhatUtils.switchToBlock(BLOCK - DELTA);
      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
      const aggregator = MaticAddresses.TETU_LIQUIDATOR;
      const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
    });

    it("try to reproduce", async () => {
      await HardhatUtils.switchToBlock(BLOCK - DELTA);

      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
      const aggregator = MaticAddresses.TETU_LIQUIDATOR;
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
        signer
      );

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      await InjectUtils.injectTetuConverter(signer);

      const state = await PackedData.getDefaultState(strategyAsOperator);

      const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);

      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      await TimeUtils.advanceNBlocks(DELTA);

      let swapData: BytesLike = "0x";
      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

      if (tokenToSwap !== Misc.ZERO_ADDRESS) {
        if (aggregator === MaticAddresses.AGG_ONEINCH_V5) {
          swapData = await AggregatorUtils.buildSwapTransactionData(
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            quote.amountToSwap,
            strategyAsOperator.address,
          );
        } else if (aggregator === MaticAddresses.TETU_LIQUIDATOR) {
          swapData = AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
            tokenIn: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            tokenOut: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            amount: quote.amountToSwap,
            slippage: BigNumber.from(5_000)
          });
          console.log("swapData for tetu liquidator", swapData);
        }
      }
      console.log("unfoldBorrows.withdrawByAggStep.callStatic --------------------------------", quote);
      console.log("tokenToSwap", tokenToSwap);
      console.log("AGGREGATOR", aggregator) ;
      console.log("amountToSwap", amountToSwap);
      console.log("swapData", swapData);
      console.log("planEntryData", planEntryData);


      const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'after');
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [stateBefore], {mainAssetSymbol: "uscd"}, true);

      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------");
      await strategyAsOperator.withdrawByAggStep(
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
        {gasLimit: 19_000_000}
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");

      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'after');
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [stateBefore, stateAfter], {mainAssetSymbol: "uscd"}, true);

      await HardhatUtils.restoreBlockFromEnv();
    });
  });

  describe("Rebalance: too high covered loss - kyber", () => {
    const DELTA = 0;
    const BLOCK = 46968028 - 1;
    const STRATEGY = "0x4B8bD2623d7480850E406B9f2960305f44c7aDeb"; // kyber
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
    const pathOut = "./tmp/high-cover-loss-kyber.csv";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("try to rebalance", async () => {
      await HardhatUtils.switchToBlock(BLOCK - DELTA);

      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
      const vault = TetuVaultV2__factory.connect(
          await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
          signer
      );

      await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      const state = await PackedData.getDefaultState(strategyAsOperator);

      const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'before');
      const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'after', {eventsSet});

      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [stateBefore, stateAfter], {mainAssetSymbol: "usdc"}, true);

      await HardhatUtils.restoreBlockFromEnv();
    });
  });

  describe("withdrawByAggStep: too high covered loss - univ3", () => {
    const DELTA = 0;
    const BLOCK = 46932234 - 1;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e"; // kyber
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
    const pathOut = "./tmp/high-cover-loss-univ3.csv";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("try withdrawByAgg", async () => {
      await HardhatUtils.switchToBlock(BLOCK - DELTA);

      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
        signer
      );

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      const tokenToSwap = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
      const aggregator = "0x1111111254EEB25477B68fb85Ed929f73A960582";
      const amountToSwap = "258147969684";
      const swapData = "0x12aa3caf000000000000000000000000ce9cc1fa6df298854f77e92042fd2a3e7fb27eff000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000ce9cc1fa6df298854f77e92042fd2a3e7fb27eff0000000000000000000000006565e8136cd415f053c81ff3656e72574f726a5e0000000000000000000000000000000000000000000000000000003c1ad16a940000000000000000000000000000000000000000000000000000003bca9545da000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006850000000000000000000000000000000000000000000006670006390005ef00a0c9e75c4800000000001e0d0402010000000000000000000000000000000005c10005720004560004070003b900a0860a32ec0000000000000000000000000000000000000000000000000000000133bc822100039051008c42cf13fbea2ac15b0fe5a5f3cf35eec65d7d7dc2132d05d31c914a87c6611c10748aeb04b58e8f0064c7cd974800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000120000000000000000000000000ce9cc1fa6df298854f77e92042fd2a3e7fb27eff0000000000000000000000000000000000000000000000000000000133bc8221000000000000000000000000000000000000000000000000000000000000000000000000000000000000000067297ee4eb097e072b4ab6f1620268061ae804640000000000000000000000002397d2fde31c5704b02ac1ec9b770f23d70d8ec4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000001490000000000000000000000000000000000000000000000000017f35b29a2e1512008b6c3d07b061a84f790c035c2f6dc11a0be70d5473f6fb73422f416f01e096eefcc5af9894b71ce9cc1fa6df298854f77e92042fd2a3e7fb27eff2791bca1f2de4661ed88a30c99a7a9449aa84174c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000000000000000000000000000000000000133b032830000000000000000000000000000000000000000000000000000000133bc82210000000000000000000000000000000000000000000000000000000064ef1816ce9cc1fa6df298854f77e92042fd2a3e7fb27eff2231253ee4b44d6ca871473ac74522a08154a765177cc29970aaa3f91668bd33c255fd9e1e6500daa0820afb55ac4237519e380e671b852cabd50766fe14e63feb4f9ff354ba8fd9c53ec5a15539da091b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041a32bf2fb6f5e5c09934fb932585af2ae8abc1417764cdddf1b85423fef088556484dc9108b71786236bf6c176a81f2eb7d53cd424dabada6eb03cc54566538ce1c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004800cdc878c037625afe3a98e14fcc56e169f0b5b411c2132d05d31c914a87c6611c10748aeb04b58e8fbd6015b4000000000000000000000000ce9cc1fa6df298854f77e92042fd2a3e7fb27eff02a000000000000000000000000000000000000000000000000000000004c26be87dee63c1e5007b925e617aefd7fb3a93abe3a701135d7a1ba710c2132d05d31c914a87c6611c10748aeb04b58e8f4310879664ce5a919727b3ed4035cf12f7f740e8df000000000000000000000000000000000000000000000000000000000f77ae06bc002424b31a0c000000000000000000000000ce9cc1fa6df298854f77e92042fd2a3e7fb27eff00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000fffd8963efd1fc6a506488495d951d5263988d2500000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f02a000000000000000000000000000000000000000000000000000000023b1c05649ee63c1e500dac8a8e6dbf8c690ec6815e0ff03491b2770255dc2132d05d31c914a87c6611c10748aeb04b58e8f00a0f2fa6b662791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000003c178027550000000000000000000000000098930e80a06c4eca272791bca1f2de4661ed88a30c99a7a9449aa841741111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000b829cf72";
      const planEntryData = "0x0000000000000000000000000000000000000000000000000000000000000001ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'before');
      const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
        strategyAsOperator,
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, 'after', {eventsSet});

      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [stateBefore, stateAfter], {mainAssetSymbol: "usdc"}, true);

      console.log(stateAfter);
      await HardhatUtils.restoreBlockFromEnv();
    });
  });

  describe("withdrawByAggStep: loss don't match to profit", () => {
    const BLOCK = 47029602;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";
    const pathOut = "./tmp/profitable-swap.csv";

    let snapshotBefore: string;
    before(async function () {
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("try withdrawByAgg", async () => {
      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];

      const states: IStateNum[] = [];

      await HardhatUtils.switchToBlock(BLOCK - 2);

      const strategy = UniswapV3ConverterStrategy__factory.connect(STRATEGY, signer);
      console.log("strategy", strategy.address);

      const state = await PackedData.getDefaultState(strategy);
      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const vault = TetuVaultV2__factory.connect(
          await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
          signer
      );

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      const aggregator = "0x1111111254EEB25477B68fb85Ed929f73A960582";
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

      const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, `b`);
      states.push(stateBefore);

      const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
          strategyAsOperator,
          quote.tokenToSwap,
          aggregator,
          quote.amountToSwap,
          swapData,
          planEntryData,
          ENTRY_TO_POOL_IS_ALLOWED,
      );
      console.log("eventsSet", eventsSet);
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, `a`, {eventsSet});
      states.push(stateAfter);

      console.log(stateAfter);

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});

    });
  });
});
