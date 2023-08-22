import {PairBasedStrategyPrepareStateUtils} from "../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy__factory,
  StrategySplitterV2__factory,
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
import {StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {ethers} from "hardhat";

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

});