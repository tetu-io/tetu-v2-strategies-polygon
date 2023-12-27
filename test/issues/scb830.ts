import {
  ControllerV2__factory,
  ConverterStrategyBase__factory, IERC20__factory, IERC20Metadata__factory, IRebalancingV2Strategy,
  IRebalancingV2Strategy__factory, StrategySplitterV2__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from '../baseUT/utils/HardhatUtils';
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {PackedData} from "../baseUT/utils/PackedData";
import {AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR, AggregatorUtils} from "../baseUT/utils/AggregatorUtils";
import {ENTRY_TO_POOL_DISABLED, ENTRY_TO_POOL_IS_ALLOWED, PLAN_SWAP_REPAY_0} from "../baseUT/AppConstants";
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
import {PairBasedStrategyPrepareStateUtils} from "../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {MockHelper} from "../baseUT/helpers/MockHelper";

describe("Scb830 @skip-on-coverage", () => {
  const BLOCK = 49049236;
  const STRATEGY = "0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C";
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

  it("call withdraByAgg several time to reduce locked amount to the required value", async () => {
    const signer = await DeployerUtilsLocal.impersonate(SENDER);
    const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const states: IStateNum[] = [];
    const pathOut = "./tmp/scb-830.csv";
    const REQUIRED_LOCKED_PERCENT = 0.03;

    const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy.address, signer);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
      signer
    );
    const stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer).symbol()
    }
    const reader = await MockHelper.createPairBasedStrategyReader(signer);

    await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
    await InjectUtils.injectTetuConverter(signer);

    await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
      POLYGON_NETWORK_ID,
      strategy,
      MaticAddresses.TETU_LIQUIDATOR,
      AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR,
      function isWithdrawCompleted(lastState?: IStateNum) {
        return !lastState || lastState?.lockedPercent < REQUIRED_LOCKED_PERCENT;
      },

      async (stateTitle, eventsSet): Promise<IStateNum> => {
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, stateTitle, {eventsSet}));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
        return states[states.length - 1];
      },

      async () => {
        const state0 = states.length === 0
          ? await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault)
          : states[states.length - 1];
        const requiredAmountToReduceDebt = await PairBasedStrategyPrepareStateUtils.getRequiredAmountToReduceDebt(
            signer, state0, reader, REQUIRED_LOCKED_PERCENT, MaticAddresses.USDC_TOKEN
        );
        return requiredAmountToReduceDebt.mul(110).div(100);
      }
    );
  });
});
