/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {IBuilderResults} from "./PairBasedStrategyBuilder";
import {ConverterStrategyBase__factory, MockSwapper} from "../../../../typechain";
import {IListStates, PairBasedStrategyPrepareStateUtils} from "./PairBasedStrategyPrepareStateUtils";
import {IStateNum, StateUtilsNum} from "../../utils/StateUtilsNum";
import {PLAN_REPAY_SWAP_REPAY_1, PLAN_SWAP_ONLY_2, PLAN_SWAP_REPAY_0} from "../../AppConstants";
import {buildEntryData0, buildEntryData1, buildEntryData2} from "../../utils/EntryDataUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {PackedData} from "../../utils/PackedData";
import {BigNumber, BytesLike} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {AggregatorUtils} from "../../utils/AggregatorUtils";
import {MockAggregatorUtils} from "../../mocks/MockAggregatorUtils";
import {CaptureEvents} from "../CaptureEvents";

export const DEFAULT_SWAP_AMOUNT_RATIO = 0.3;

export interface IWithdrawParams {
  aggregator: string;
  planEntryData: string;
  entryToPool: number;
  singleIteration: boolean;

  pathOut?: string;
  states0?: IStateNum[];
  mockSwapper?: MockSwapper;
}

export interface IPrepareWithdrawTestParams {
  pathTag: string;
  movePricesUp: boolean;

  /** 2 by default */
  countRebalances?: number;

  skipOverCollateralStep?: boolean;
}
export interface IPrepareWithdrawTestResults {
  pathOut: string;
  states: IStateNum[];
}

export interface ICompleteWithdrawTestParams {
  entryToPool: number;
  planKind: number;
  singleIteration: boolean;
  propNotUnderlying?: string; // use Number.MAX_SAFE_INTEGER for MAX_UINT
  pathOut: string;
  states0: IStateNum[];

  /** ZERO by default */
  aggregator?: string;
  mockSwapper?: MockSwapper;
}

export class PairWithdrawByAggUtils {
  static async makeFullWithdraw(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    b: IBuilderResults,
    p: IWithdrawParams,
  ): Promise<IListStates> {
    const state = await PackedData.getDefaultState(b.strategy);
    const strategyAsOperator = b.strategy.connect(b.operator);

    const states = p?.states0
      ? [...p.states0]
      : [];

    let step = 0;
    while (true) {
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(p.planEntryData);
      console.log("makeFullWithdraw.quote", quote);

      let swapData: BytesLike = "0x";
      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

      if (tokenToSwap !== Misc.ZERO_ADDRESS) {
        if (p.aggregator === MaticAddresses.AGG_ONEINCH_V5) {
          swapData = await AggregatorUtils.buildSwapTransactionData(
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            quote.amountToSwap,
            strategyAsOperator.address,
          );
        } else if (p.aggregator === MaticAddresses.TETU_LIQUIDATOR) {
          swapData = AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
            tokenIn: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            tokenOut: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            amount: quote.amountToSwap,
            slippage: BigNumber.from(5_000)
          });
          console.log("swapData for tetu liquidator", swapData);
        }
      }
      console.log("makeFullWithdraw.withdrawByAggStep.execute --------------------------------");
      console.log("tokenToSwap", tokenToSwap);
      console.log("AGGREGATOR", p.aggregator);
      console.log("amountToSwap", amountToSwap);
      console.log("swapData", swapData);
      console.log("swapData.length", swapData.length);
      console.log("planEntryData", p.planEntryData);
      console.log("ENTRY_TO_POOL_IS_ALLOWED", p.entryToPool);

      if (p.mockSwapper) {
        // temporary replace swapper by mocked one
        await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, p.mockSwapper.address);
      }

      const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
        tokenToSwap,
        p.aggregator,
        amountToSwap,
        swapData,
        p.planEntryData,
        p.entryToPool,
        {gasLimit: 19_000_000}
      );
      const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
        strategyAsOperator,
        tokenToSwap,
        p.aggregator,
        amountToSwap,
        swapData,
        p.planEntryData,
        p.entryToPool,
      );
      console.log(`unfoldBorrows.withdrawByAggStep.FINISH --------------------------------`);

      states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `u${++step}`, {eventsSet}));
      if (p.pathOut) {
        await StateUtilsNum.saveListStatesToCSVColumns(p?.pathOut, states, b.stateParams, true);
      }

      if (p.mockSwapper) {
        // restore original swapper
        await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, b.swapper);
      }


      if (p.singleIteration || completed) break;
    }

    return {states};
  }

  static async prepareWithdrawTest(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    b: IBuilderResults,
    p: IPrepareWithdrawTestParams
  ): Promise<IPrepareWithdrawTestResults> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    const pathOut = `./tmp/${platform}-${p.pathTag}.csv`;

    const states: IStateNum[] = p.skipOverCollateralStep
      ? []
      : (await PairBasedStrategyPrepareStateUtils.prepareTwistedDebts(
        b,
        {
          countRebalances: p.countRebalances ?? 2,
          movePricesUp: p.movePricesUp,
          swapAmountRatio: DEFAULT_SWAP_AMOUNT_RATIO,
          amountToDepositBySigner2: "100",
          amountToDepositBySigner: "10000",
        },
        pathOut,
        signer,
        signer2,
      )).states;

    return {states, pathOut};
  }

  static async completeWithdrawTest(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    b: IBuilderResults,
    p: ICompleteWithdrawTestParams
  ): Promise<IListStates> {
    const {states} = await this.makeFullWithdraw(
      signer,
      signer2,
      b,
      {
        singleIteration: p.singleIteration,
        aggregator: p.aggregator ?? Misc.ZERO_ADDRESS,
        entryToPool: p.entryToPool,
        planEntryData: p.planKind === PLAN_REPAY_SWAP_REPAY_1
          ? buildEntryData1(BigNumber.from(0), p.propNotUnderlying)
          : p.planKind === PLAN_SWAP_REPAY_0
            ? buildEntryData0(p.propNotUnderlying)
            : p.planKind === PLAN_SWAP_ONLY_2
              ? buildEntryData2(p.propNotUnderlying)
              : "0x",
        pathOut: p.pathOut,
        states0: p.states0,
        mockSwapper: p.mockSwapper
      },
    );

    return {states};
  }
}
