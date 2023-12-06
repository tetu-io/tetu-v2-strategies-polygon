import {HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import fs from "fs";
import {CaptureEvents, IEventsSet} from "../baseUT/strategies/CaptureEvents";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";

describe("Scb866 @skip-on-coverage", () => {
  const STRATEGY = "0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C";
  const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

  let snapshotBefore: string;
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  describe("ST error in Algebra (not enough dQUICK on balance). We need to implement try/catch", () => {
    const BLOCK = 50779886;
    const STRATEGY = "0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD";
    const SENDER = "0xddddd5541d5d8c5725765352793c8651a06f5b09";
    const pathOut = "./tmp/scb-866.csv";

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

      await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
      await InjectUtils.injectStrategy(signer, STRATEGY, "AlgebraConverterStrategy");

      // await saver("b");
      const strategyAsSplitter = converterStrategyBase.connect(await DeployerUtilsLocal.impersonate(splitter));
      await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
      const eventsSet = await CaptureEvents.makeHardwork(strategyAsSplitter);
      // await saver("a", eventsSet);
    });
  });
});