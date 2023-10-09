import {ConverterStrategyBase__factory, IRebalancingV2Strategy} from "../../typechain";
import {CaptureEvents, IEventsSet} from "../../test/baseUT/strategies/CaptureEvents";
import {PackedData} from "../../test/baseUT/utils/PackedData";
import {BigNumber, BytesLike} from "ethers";
import {Misc} from "./Misc";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {AggregatorUtils} from "../../test/baseUT/utils/AggregatorUtils";
import {IERC20Metadata__factory} from "../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {PLAN_SWAP_REPAY} from "../../test/baseUT/AppConstants";
import {RunHelper} from "./RunHelper";
import {ethers} from "hardhat";

export interface IMakeFullWithdraw {
  entryToPool: number;

  planEntryDataGetter?: () => Promise<string>;
  singleIteration?: boolean; // false by default (make iterations until completed won't be received)
  aggregator?: string; // AGG_ONEINCH_V5 or TETU_LIQUIDATOR,  AGG_ONEINCH_V5 by default
  saveStates?: (title: string, eventsSet?: IEventsSet) => Promise<void>;
  maxAmountToSwap?: string; // 30000 by default
  swapSlippage?: number; // 5000 by default
  isCompleted?: (completed: boolean) => Promise<boolean>;
}

/**
 * Call withdrawAllByAgg and close all debts.
 */
export async function makeFullWithdraw(strategyAsOperator: IRebalancingV2Strategy, p: IMakeFullWithdraw) {
  const state = await PackedData.getDefaultState(strategyAsOperator);
  const aggregator = p?.aggregator || MaticAddresses.AGG_ONEINCH_V5;

  let step = 0;
  while (true) {
    const planEntryData = p?.planEntryDataGetter
      ? await p?.planEntryDataGetter()
      : defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]);

    console.log(`=========================== ${step} =====================`);
    const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
    console.log("makeFullWithdraw.quote", quote);
    const decimalsAsset = await IERC20Metadata__factory.connect(
      await ConverterStrategyBase__factory.connect(strategyAsOperator.address, strategyAsOperator.signer).asset(),
      strategyAsOperator.signer
    ).decimals();

    let swapData: BytesLike = "0x";
    const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;

    const maxAmountToSwap = parseUnits(p.maxAmountToSwap || "30000", decimalsAsset);
    const amountToSwap = quote.amountToSwap.eq(0)
      ? BigNumber.from(0)
      : quote.amountToSwap.gt(maxAmountToSwap)
        ? maxAmountToSwap
        : quote.amountToSwap;
    console.log("amountToSwap", amountToSwap);

    if (tokenToSwap !== Misc.ZERO_ADDRESS) {
      if (aggregator === MaticAddresses.AGG_ONEINCH_V5) {
        console.log("1inch is in use");
        swapData = await AggregatorUtils.buildSwapTransactionData(
          quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
          quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
          amountToSwap,
          strategyAsOperator.address,
        );
      } else if (aggregator === MaticAddresses.TETU_LIQUIDATOR) {
        console.log("TETU Liquidator is in use");
        swapData = AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
          tokenIn: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
          tokenOut: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
          amount: amountToSwap,
          slippage: BigNumber.from(p.swapSlippage ?? 5_000)
        });
      }
    }
    console.log("makeFullWithdraw.withdrawByAggStep.execute --------------------------------");
    const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
      tokenToSwap,
      aggregator,
      amountToSwap,
      swapData,
      planEntryData,
      p.entryToPool,
      {gasLimit: 9_000_000}
    );
    await RunHelper.runAndWait(
      () => strategyAsOperator.withdrawByAggStep(tokenToSwap, aggregator, amountToSwap, swapData, planEntryData, p.entryToPool)
    );

    // const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
    //   strategyAsOperator,
    //   tokenToSwap,
    //   aggregator,
    //   amountToSwap,
    //   swapData,
    //   planEntryData,
    //   p.entryToPool,
    // );
    // console.log(`makeFullWithdraw.withdrawByAggStep.FINISH --------------------------------`);

    if (p.saveStates) {
      await p?.saveStates(`w${step++}`);
    }

    if (p?.singleIteration) break;
    if (p.isCompleted) {
      if (await p.isCompleted(completed)) break;
    } else {
      if (completed) break;
    }
  }
}
