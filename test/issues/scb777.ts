import {PairBasedStrategyPrepareStateUtils} from "../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {IRebalancingV2Strategy__factory} from "../../typechain";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {HardhatUtils} from "../baseUT/utils/HardhatUtils";

describe("Scb777", () => {
  const BLOCK = 46387161;
  const STRATEGY = "0x6565e8136cd415f053c81ff3656e72574f726a5e";
  const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

  let snapshotBefore: string;

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.switchToBlock(BLOCK);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  it("try to reproduce", async () => {
    const strategy = IRebalancingV2Strategy__factory.connect(
      STRATEGY,
      await DeployerUtilsLocal.impersonate(SENDER)
    );

    await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
      strategy,
      MaticAddresses.TETU_LIQUIDATOR,
      true
    );
  });
});