import {ethers} from "hardhat";
import {IStateNum, StateUtilsNum} from "../../test/baseUT/utils/StateUtilsNum";
import fs from "fs";
import {CaptureEvents, IEventsSet} from "../../test/baseUT/strategies/CaptureEvents";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy__factory, StrategySplitterV2__factory, TetuVaultV2__factory
} from "../../typechain";
import {makeFullWithdraw} from "../utils/WithdrawAllByAggUtils";
import {
  ENTRY_TO_POOL_DISABLED,
  ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
  PLAN_REPAY_SWAP_REPAY,
  PLAN_SWAP_REPAY
} from "../../test/baseUT/AppConstants";
import {defaultAbiCoder} from "ethers/lib/utils";
import {Misc} from "../utils/Misc";

/**
 * to run the script:
 *      npx hardhat run scripts/tasks/withdrawAllByAgg.ts
 */
async function main() {
  const pathOut = "./tmp/withdrawAllByAgg-states.csv";

  const operator = (await ethers.getSigners())[0];
  const states: IStateNum[] = [];

  if (fs.existsSync(pathOut)) {
    fs.rmSync(pathOut);
  }

  const saver = async (title: string, e?: IEventsSet) => {
    const state = await StateUtilsNum.getState(operator, operator, converterStrategyBase, vault, title, {eventsSet: e});
    states.push(state);
    StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
  };

  const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
  const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
  const vault = TetuVaultV2__factory.connect(
    await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
    operator
  );

  // await injectStrategy(operator, STRATEGY, "KyberConverterStrategy");

  await saver("b");
  await makeFullWithdraw(strategyAsOperator, {
    entryToPool: ENTRY_TO_POOL_DISABLED,
    planEntryDataGetter: async () => defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]),
    saveStates: saver
  })
  // await tryWithdrawByAgg(signer, strategy, saver);

  const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
  await saver("a", eventsSet);
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });