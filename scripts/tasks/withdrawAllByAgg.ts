import {ethers} from "hardhat";
import {IStateNum, StateUtilsNum} from "../../test/baseUT/utils/StateUtilsNum";
import fs from "fs";
import {IEventsSet} from "../../test/baseUT/strategies/CaptureEvents";
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
import {HardhatUtils} from "../../test/baseUT/utils/HardhatUtils";

/**
 * to run the script:
 *      npx hardhat run scripts/tasks/withdrawAllByAgg.ts
 */
async function main() {
  const STRATEGY = "0x792bcc2f14fdcb9faf7e12223a564e7459ea4201";
  const pathOut = "./tmp/withdrawAllByAgg-states.csv";

  // await HardhatUtils.switchToBlock(47961845);

  const operator =  (await ethers.getSigners())[0];
  // const operator =  await Misc.impersonate("0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94");

  const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
  const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
  const splitter = StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator);
  const vault = TetuVaultV2__factory.connect(await splitter.vault(), operator);

  // let's save states after each action to CSV
  const states: IStateNum[] = [];
  if (fs.existsSync(pathOut)) {
    fs.rmSync(pathOut);
  }
  const saver = async (title: string, e?: IEventsSet) => {
    const state = await StateUtilsNum.getState(operator, operator, converterStrategyBase, vault, title, {eventsSet: e});
    states.push(state);
    StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
  };

  // await injectStrategy(operator, STRATEGY, "KyberConverterStrategy");

  await saver("b");

  // use PLAN_SWAP_REPAY to withdraw all to underlying
  await makeFullWithdraw(strategyAsOperator, {
    entryToPool: ENTRY_TO_POOL_DISABLED,
    planEntryDataGetter: async () => defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]),
    saveStates: saver,
    maxAmountToSwap: "30000",
    isCompleted: async (completed: boolean) => {
      if (completed) {
        // The strategy sets flag "completed" ON when there are no debts anymore and only last swap of assets on balance is required.
        // But we limit max amount to swap, to that last swap can become to sequences of several swaps.
        // So, we need to check "completed" AND check zero not-underlying balance of the strategy
        const state = await StateUtilsNum.getState(operator, operator, converterStrategyBase, vault, "state to check completion");
        console.log(state);
        return state.strategy.borrowAssetsBalances.findIndex(x => x > 1) === -1;
      } else {
        return false;
      }
    }
  })

  // make rebalance at the end if necessary
  // const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategyAsOperator);
  // await saver("a", eventsSet);
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
