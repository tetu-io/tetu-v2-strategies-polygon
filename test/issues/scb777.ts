import {PairBasedStrategyPrepareStateUtils} from "../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {ConverterStrategyBase__factory, IRebalancingV2Strategy__factory} from "../../typechain";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {parseUnits} from "ethers/lib/utils";

describe("Scb777, scb779-reproduce @skip-on-coverage", () => {
  describe("Scb777: withdrawByAgg, TC-29", () => {
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

  describe("Scb778: withdrawByAgg, not enough balance", () => {
    const BLOCK = 46405849;
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

      // await PairBasedStrategyPrepareStateUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
        strategy,
        MaticAddresses.TETU_LIQUIDATOR,
        true
      );
    });
  });

  describe("Scb779: withdraw, sb too high", () => {
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
      const splitterSigner = await DeployerUtilsLocal.impersonate(SPLITTER);
      const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, splitterSigner);

      await PairBasedStrategyPrepareStateUtils.injectStrategy(splitterSigner, STRATEGY, "UniswapV3ConverterStrategy");
      await PairBasedStrategyPrepareStateUtils.injectTetuConverter(splitterSigner);

      const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy.address, splitterSigner);
      // await converterStrategyBase.withdrawToSplitter(parseUnits(AMOUNT, 6));
      await converterStrategyBase.withdrawAllToSplitter();
    });
  });
});