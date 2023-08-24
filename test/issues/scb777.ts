import {PairBasedStrategyPrepareStateUtils} from "../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy__factory,
<<<<<<< Updated upstream
  StrategySplitterV2__factory,
=======
  ISplitter__factory,
>>>>>>> Stashed changes
  TetuVaultV2__factory
} from "../../typechain";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {PackedData} from "../baseUT/utils/PackedData";
import {Misc} from "../../scripts/utils/Misc";
import {BigNumber, BytesLike} from "ethers";
import {AggregatorUtils} from "../baseUT/utils/AggregatorUtils";
import {ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY} from "../baseUT/AppConstants";
<<<<<<< Updated upstream
import {StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {ethers} from "hardhat";
=======
import {ethers} from "hardhat";
import {StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {ISplitter__factory} from "../../typechain";

>>>>>>> Stashed changes

describe("Scb777, scb779-reproduce @skip-on-coverage", () => {
  describe("SCB-777: withdrawByAgg, TC-29", () => {
    const BLOCK = 46387161;
    const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
    const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

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
      const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);

      await PairBasedStrategyPrepareStateUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
        strategy,
        MaticAddresses.TETU_LIQUIDATOR,
        true
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

      await PairBasedStrategyPrepareStateUtils.injectStrategy(splitterSigner, STRATEGY, "UniswapV3ConverterStrategy");
      await PairBasedStrategyPrepareStateUtils.injectTetuConverter(splitterSigner);

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

      await PairBasedStrategyPrepareStateUtils.injectStrategy(splitterSigner, STRATEGY, "UniswapV3ConverterStrategy");
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
});