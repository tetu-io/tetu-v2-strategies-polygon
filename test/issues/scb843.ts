import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";
import {ConverterStrategyBase__factory} from "../../typechain";

describe("Base chain issues @skip-on-coverage", () => {

  describe("SCB-843: profit too high", () => {
    const BLOCK =  6574536 - 63;
    const SPLITTER = "0xA01ac87f8Fc03FA2c497beFB24C74D538958DAbA";
    const STRATEGY = "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e";

    let snapshotBefore: string;
    before(async function () {
      await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID, BLOCK);
      snapshotBefore = await TimeUtils.snapshot();
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
      await HardhatUtils.restoreBlockFromEnv();
    });

    it("try to reproduce", async () => {
      const [signer] = await ethers.getSigners();
      const splitter = await DeployerUtilsLocal.impersonate(SPLITTER);
      const strategy = ConverterStrategyBase__factory.connect(STRATEGY, splitter);

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");

      console.log("Start hardwork");
      await strategy.doHardWork();

    });
  });


});
