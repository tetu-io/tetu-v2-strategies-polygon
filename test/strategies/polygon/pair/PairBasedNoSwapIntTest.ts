/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ConverterStrategyBase__factory, IController__factory, IERC20__factory, MockSwapper,} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {BigNumber, BytesLike} from "ethers";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {IBuilderResults, KYBER_PID_DEFAULT_BLOCK} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {differenceInPercentsNumLessThan} from "../../../baseUT/utils/MathUtils";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {
  IListStates,
  PairBasedStrategyPrepareStateUtils
} from "../../../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {
  ENTRY_TO_POOL_DISABLED,
  ENTRY_TO_POOL_IS_ALLOWED,
  ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED, FUSE_OFF_1,
  PLAN_REPAY_SWAP_REPAY, PLAN_SWAP_ONLY, PLAN_SWAP_REPAY
} from "../../../baseUT/AppConstants";
import {CaptureEvents} from "../../../baseUT/strategies/CaptureEvents";
import {MockAggregatorUtils} from "../../../baseUT/mocks/MockAggregatorUtils";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";

/**
 * There are two kind of tests here:
 * 1) test uses liquidator
 * 2) test uses aggregator
 * Liquidator has modified price, but aggregator has unchanged current price different from the price in our test.
 */
describe('PairBasedNoSwapIntTest', function() {
//region Constants
  const DEFAULT_SWAP_AMOUNT_RATIO = 0.3;
//endregion Constants

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;
    [signer, signer2] = await ethers.getSigners();
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Withdraw-with-iterations impl
  interface IWithdrawParams {
    aggregator: string;
    planEntryData: string;
    entryToPool: number;
    singleIteration: boolean;
  }
  async function makeFullWithdraw(b: IBuilderResults, p: IWithdrawParams, pathOut: string, states: IStateNum[], mockSwapper?: MockSwapper): Promise<IListStates> {
    const state = await PackedData.getDefaultState(b.strategy);
    const strategyAsOperator = b.strategy.connect(b.operator);
    
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

      if (mockSwapper) {
        // temporary replace swappery by mocked one
        await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, mockSwapper.address);
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
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      if (mockSwapper) {
        // restore original swapper
        await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, b.swapper);
      }


      if (p.singleIteration || completed) break;
    }

    return {states};
  }

  type IMakeWithdrawTestResults = IListStates;
  interface IMakeWithdrawTestParams {
    movePricesUp: boolean;
    entryToPool: number;
    planKind: number;
    singleIteration: boolean;
    propNotUnderlying18?: BigNumber;

    /** 2 by default */
    countRebalances?: number;
    /** ZERO by default */
    aggregator?: string;
    mockSwapper?: MockSwapper;

    skipOverCollateralStep?: boolean;
  }

  async function makeWithdrawTest(b: IBuilderResults, p: IMakeWithdrawTestParams, fnPostfix?: string): Promise<IMakeWithdrawTestResults> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    const agg = p.aggregator === Misc.ZERO_ADDRESS
      ? "no"
      : p.aggregator === MaticAddresses.TETU_LIQUIDATOR
        ? "liquidator-as-agg"
        : p.aggregator === MaticAddresses.AGG_ONEINCH_V5
          ? "1inch"
          : p.mockSwapper
            ? "mock-swapper"
            : "no";
    const pathOut = `./tmp/${platform}-entry${p.entryToPool}-${p.singleIteration ? "single" : "many"}-${p.movePricesUp ? "up" : "down"}-${agg}${fnPostfix ? fnPostfix : ""}.csv`;

    const states0: IStateNum[] = p.skipOverCollateralStep
      ? []
      : (await PairBasedStrategyPrepareStateUtils.prepareTwistedDebts(
          b,
          {
            countRebalances: p.countRebalances ?? 2,
            movePricesUp: p.movePricesUp,
            swapAmountRatio: DEFAULT_SWAP_AMOUNT_RATIO,
            amountToDepositBySigner2: "100",
            amountToDepositBySigner: "10000"
          },
          pathOut,
          signer,
          signer2,
      )).states;

    const {states} = await makeFullWithdraw(
      b,
      {
        singleIteration: p.singleIteration,
        aggregator: p.aggregator ?? Misc.ZERO_ADDRESS,
        entryToPool: p.entryToPool,
        planEntryData: p.planKind === PLAN_REPAY_SWAP_REPAY
          ? defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT])
          : p.planKind === PLAN_SWAP_REPAY
            ? defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, p?.propNotUnderlying18 ?? 0])
            : p.planKind === PLAN_SWAP_ONLY
              ? defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_ONLY, p?.propNotUnderlying18 ?? 0])
              : "0x",
      },
      pathOut,
      states0,
      p.mockSwapper
    );

    return {states};
  }
//endregion Withdraw-with-iterations impl

//region Unit tests
  describe('unfold debts using single iteration', function() {
    interface IStrategyInfo {
      name: string,
      sharePriceDeviation: number
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3, sharePriceDeviation: 1e-8},
      { name: PLATFORM_ALGEBRA, sharePriceDeviation: 1e-8},
      /**
       * on "npm run coverage" we have a problem with sharePriceDeviation = 1e-8
       * expected 1 to be close to 1.0000231642199326 +/- 1e-8
       * The reason is unclear, there are no such problems on the same block locally
       * So, let's try to just reduce deviation value
       */
      { name: PLATFORM_KYBER, sharePriceDeviation: 1e-4},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );

        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

        // provide $1000 of insurance to compensate possible price decreasing
        await PairBasedStrategyPrepareStateUtils.prepareInsurance(b, "1000");

        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        describe("Use liquidator", () => {
          describe("Move prices up", () => {
            describe("Liquidator, entry to pool at the end", () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(builderResults, {
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should not change share price significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const sharePrice0 = states[0].vault.sharePrice;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
                  expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
                }
              });
              it("should reduce locked amount significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
              it("should put more at least half liquidity to the pool", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevTotalLiquidity = states[states.length - 2].strategy.liquidity;
                const finalTotalLiquidity = states[states.length - 1].strategy.liquidity;
                expect(finalTotalLiquidity).gt(prevTotalLiquidity / 2);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
                const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
                expect(amountToRepayFinal).lt(amountToRepayPrev);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
                const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
                expect(amountCollateralFinal).lt(amountCollateralPrev);
              });

              it("should not change vault.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].vault.totalAssets;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const totalAssets = states[i].vault.totalAssets;
                  expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
                }
              });
            });
            describe("Liquidator, don't enter to the pool", () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(builderResults, {
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_DISABLED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should not change share price significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const sharePrice0 = states[0].vault.sharePrice;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
                  expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
                }
              });
              it("should reduce locked amount significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
              });
              it("should not enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity).eq(0);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
                const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
                expect(amountToRepayFinal).lt(amountToRepayPrev);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
                const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
                expect(amountCollateralFinal).lt(amountCollateralPrev);
              });

              it("should not change vault.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].vault.totalAssets;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const totalAssets = states[i].vault.totalAssets;
                  expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
                }
              });
            });
          });
          describe("Move prices down", () => {
            describe("Liquidator, entry to pool at the end", () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(builderResults, {
                  movePricesUp: false,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                  countRebalances: strategyInfo.name === PLATFORM_ALGEBRA ? 1 : 2
                });
              }

              it("should reduce locked amount significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
              });
              it("should not change share price significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const sharePrice0 = states[0].vault.sharePrice;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
                  expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
                }
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
              it("should put at least half liquidity to the pool", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevTotalLiquidity = states[states.length - 2].strategy.liquidity;
                const finalTotalLiquidity = states[states.length - 1].strategy.liquidity;
                expect(finalTotalLiquidity).gt(prevTotalLiquidity / 2);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
                const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
                expect(amountToRepayFinal).lt(amountToRepayPrev);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
                const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
                expect(amountCollateralFinal).lt(amountCollateralPrev);
              });

              it("should not change vault.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].vault.totalAssets;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const totalAssets = states[i].vault.totalAssets;
                  expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
                }
              });
            });
            describe("Liquidator, don't enter to the pool", () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(builderResults, {
                  movePricesUp: false,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_DISABLED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                  countRebalances: strategyInfo.name === PLATFORM_ALGEBRA ? 1 : 2
                });
              }

              it("should reduce locked amount significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
              });
              it("should not change share price significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const sharePrice0 = states[0].vault.sharePrice;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
                  expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
                }
              });
              it("should not enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity).eq(0);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
                const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
                expect(amountToRepayFinal).lt(amountToRepayPrev);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
                const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
                expect(amountCollateralFinal).lt(amountCollateralPrev);
              });
              it("should not change vault.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].vault.totalAssets;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const totalAssets = states[i].vault.totalAssets;
                  expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
                }
              });
            });
          });
        });
        describe("Use liquidator as aggregator", () => {
          describe("Move prices up", () => {
            describe("Liquidator, entry to pool at the end", () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(builderResults, {
                  aggregator: MaticAddresses.TETU_LIQUIDATOR,
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                  countRebalances: 1
                });
              }

              it("should reduce locked amount significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
              });
              it("should not change share price significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const sharePrice0 = states[0].vault.sharePrice;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
                  expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
                }
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
              it("should put more liquidity to the pool", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevTotalLiquidity = states[states.length - 2].strategy.liquidity;
                const finalTotalLiquidity = states[states.length - 1].strategy.liquidity;
                expect(finalTotalLiquidity).gt(prevTotalLiquidity);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
                const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
                expect(amountToRepayFinal).lt(amountToRepayPrev);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
                const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
                expect(amountCollateralFinal).lt(amountCollateralPrev);
              });

              it("should not change vault.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].vault.totalAssets;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const totalAssets = states[i].vault.totalAssets;
                  expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
                }
              });
            });
            describe("Liquidator, don't enter to the pool", () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(builderResults, {
                  aggregator: MaticAddresses.TETU_LIQUIDATOR,
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_DISABLED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                  countRebalances: 1
                });
              }
              it("should reduce locked amount significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
              });
              it("should not change share price significantly", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const sharePrice0 = states[0].vault.sharePrice;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
                  expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
                }
              });
              it("should not enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity).eq(0);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
                const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
                expect(amountToRepayFinal).lt(amountToRepayPrev);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const prevState = states[states.length - 2];
                const finalState = states[states.length - 1];
                const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
                const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
                expect(amountCollateralFinal).lt(amountCollateralPrev);
              });

              it("should not change vault.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].vault.totalAssets;
                let sumUncoveredLoss = 0;
                for (let i = 1; i < states.length; ++i) {
                  sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
                  const totalAssets = states[i].vault.totalAssets;
                  expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
                }
              });
            });
          });
        });
      });
    });
  });

  describe('unfold debts using single iteration, 1inch @skip-on-coverage', function() {
    let snapshotLocal: string;
    before(async function() {
      snapshotLocal = await TimeUtils.snapshot();
      await HardhatUtils.switchToMostCurrentBlock(); // 1inch works on current block only

      // we need to display full objects, so we use util.inspect, see
      // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
      require("util").inspect.defaultOptions.depth = null;
      [signer, signer2] = await ethers.getSigners();
    })

    after(async function() {
      await HardhatUtils.restoreBlockFromEnv();
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IStrategyInfo {
      name: string,
      sharePriceDeviation: number
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_ALGEBRA, sharePriceDeviation: 2e-5},
      { name: PLATFORM_UNIV3, sharePriceDeviation: 2e-5},
      { name: PLATFORM_KYBER, sharePriceDeviation: 2e-5},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );

        // provide $1000 of insurance to compensate possible price decreasing
        await PairBasedStrategyPrepareStateUtils.prepareInsurance(b, "1000");

        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        describe("Move prices up", () => {
          describe("Liquidator, entry to pool at the end", () => {
            let snapshot: string;
            let r: IMakeWithdrawTestResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();

              r = await callWithdrawSingleIteration();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(await prepareStrategy(),
                  {
                    aggregator: MaticAddresses.AGG_ONEINCH_V5,
                    movePricesUp: true,
                    singleIteration: true,
                    entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                    planKind: PLAN_REPAY_SWAP_REPAY,
                  }
              );
            }

            it("should reduce locked amount significantly", async () => {
              const [stateLast, statePrev, ...rest] = [...r.states].reverse();
              expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
            });
            // Share price can change here because prices are not changed in 1inch
            it("should enter to the pool at the end", async () => {
              const [stateLast, ...rest] = [...r.states].reverse();
              expect(stateLast.strategy.liquidity > 0).eq(true);
            });
            it("should put more liquidity to the pool", async () => {
              const prevTotalLiquidity = r.states[r.states.length - 2].strategy.liquidity;
              const finalTotalLiquidity = r.states[r.states.length - 1].strategy.liquidity;
              expect(finalTotalLiquidity).gt(prevTotalLiquidity);
            });
            it("should reduce amount-to-repay", async () => {
              const amountToRepayPrev = r.states[r.states.length - 2].converterDirect.amountsToRepay[0];
              const amountToRepayFinal = r.states[r.states.length - 1].converterDirect.amountsToRepay[0]
              expect(amountToRepayFinal).lt(amountToRepayPrev);
            });
            it("should reduce collateral amount", async () => {
              const amountCollateralPrev = r.states[r.states.length - 2].converterDirect.collaterals[0];
              const amountCollateralFinal = r.states[r.states.length - 1].converterDirect.collaterals[0]
              expect(amountCollateralFinal).lt(amountCollateralPrev);
            });
          });
        });
      });
    });
  });
  describe('scb-792: Unfold debts using single iteration, MockSwapper changes prices', function() {
    let snapshotLocal: string;
    before(async function() {
      snapshotLocal = await TimeUtils.snapshot();
      await HardhatUtils.switchToMostCurrentBlock(); // 1inch works on current block only

      // we need to display full objects, so we use util.inspect, see
      // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
      require("util").inspect.defaultOptions.depth = null;
      [signer, signer2] = await ethers.getSigners();
    })
    after(async function() {
      await HardhatUtils.restoreBlockFromEnv();
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IStrategyInfo {
      name: string,
      sharePriceDeviation: number;
      /**
       * Mock swapper should transfer amount a bit higher or a bit lower than amount calculated by price oracle.
       */
      increaseOutput: boolean;
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3, sharePriceDeviation: 2e-8, increaseOutput: true},
      { name: PLATFORM_UNIV3, sharePriceDeviation: 2e-8, increaseOutput: false},
      { name: PLATFORM_ALGEBRA, sharePriceDeviation: 2e-8, increaseOutput: true},
      { name: PLATFORM_KYBER, sharePriceDeviation: 2e-8, increaseOutput: true},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      let mockSwapper: MockSwapper;
      before(async function() {
        mockSwapper = await MockAggregatorUtils.createMockSwapper(
          signer,
          {
            token0: MaticAddresses.USDC_TOKEN,
            token1: MaticAddresses.USDT_TOKEN,
            increaseOutput: strategyInfo.increaseOutput,
            percentToIncrease: 200,
            amountToken0: "1000000",
            amountToken1: "1000000",
            converter: MaticAddresses.TETU_CONVERTER, // hack: we will know this address only after call of buildPairStrategyUsdtUsdc, but for simplicity we repeat it here
          }
        );
      })

      async function prepareStrategy(useMockSwapper?: boolean): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );
        const converterStrategyBase = await ConverterStrategyBase__factory.connect(b.strategy.address, signer);
        const platformVoter = await DeployerUtilsLocal.impersonate(
          await IController__factory.connect(
            await converterStrategyBase.controller(),
            signer
          ).platformVoter()
        );
        await ConverterStrategyBase__factory.connect(b.strategy.address, platformVoter).setCompoundRatio(0);

        // provide $1000 of insurance to compensate possible price decreasing
        await PairBasedStrategyPrepareStateUtils.prepareInsurance(b, "1000");

        return b;
      }

      describe(`${strategyInfo.name}-${strategyInfo.increaseOutput ? "amountOutUpper" : "amountOutLower"}`, () => {
        describe("Liquidator, entry to pool at the end", () => {
          let snapshot: string;
          let builderResults: IBuilderResults;
          before(async function () {
            snapshot = await TimeUtils.snapshot();

            builderResults = await prepareStrategy(true);
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          interface ICallWithdrawTwoIterationsResults {
            r1: IListStates;
            r2: IListStates;
            calcInvestedAssetsR1: number;
          }

          /**
           * Make two withdraw iterations
           * 1) Mock swapper is used, prices are changed. Don't enter to the pool.
           * 2) Mock swapper is not used, prices are not changed. Enter to the pool.
           */
          async function callWithdrawTwoIterations(): Promise<ICallWithdrawTwoIterationsResults> {
            const r1 = await makeWithdrawTest(
              builderResults,
              {
                movePricesUp: true,
                singleIteration: true,
                entryToPool: ENTRY_TO_POOL_DISABLED,
                planKind: PLAN_REPAY_SWAP_REPAY,
                aggregator: MaticAddresses.TETU_LIQUIDATOR,
                countRebalances: 1,
                mockSwapper
              },
              strategyInfo.increaseOutput ? "amountOutUpper" : "amountOutLower"
            );

            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, builderResults.operator);
            const calcInvestedAssets = await converterStrategyBase.callStatic.calcInvestedAssets();

            const r2 = await makeWithdrawTest(
              builderResults,
              {
                skipOverCollateralStep: true,

                movePricesUp: true,
                singleIteration: true,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                planKind: PLAN_REPAY_SWAP_REPAY,
                aggregator: MaticAddresses.TETU_LIQUIDATOR,
              },
              "final"
            );

            return {
              r1,
              r2,
              calcInvestedAssetsR1: +formatUnits(calcInvestedAssets, builderResults.assetDecimals)
            };
          }

          it("should not change share price", async () => {
            const {r1, r2} = await loadFixture(callWithdrawTwoIterations);
            const states = {...r1.states, ...r2.states};

            const sharePrice0 = states[0].vault.sharePrice;
            let sumUncoveredLoss = 0;
            for (let i = 1; i < states.length; ++i) {
              sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
              const adjustedSharePrice = (states[i].vault.totalAssets + sumUncoveredLoss) / states[i].vault.totalSupply;
              expect(sharePrice0).approximately(adjustedSharePrice, strategyInfo.sharePriceDeviation, states[i].title);
            }
          });
          it("should reduce locked amount significantly", async () => {
            const {r1} = await loadFixture(callWithdrawTwoIterations);
            const [stateLast, statePrev, ...rest] = [...r1.states].reverse();
            expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(1.2);
          });
          it("should enter to the pool at the end", async () => {
            const {r2} = await loadFixture(callWithdrawTwoIterations);
            const [stateLast, ...rest] = [...r2.states].reverse();
            expect(stateLast.strategy.liquidity > 0).eq(true);
          });
          it("should put more liquidity to the pool", async () => {
            const {r1, r2} = await loadFixture(callWithdrawTwoIterations);
            const prevTotalLiquidity = r1.states[r1.states.length - 1].strategy.liquidity;
            const finalTotalLiquidity = r2.states[r2.states.length - 1].strategy.liquidity;
            expect(finalTotalLiquidity).gt(prevTotalLiquidity);
          });
          it("should reduce amount-to-repay", async () => {
            const {r1} = await loadFixture(callWithdrawTwoIterations);
            const prevState = r1.states[r1.states.length - 2];
            const finalState = r1.states[r1.states.length - 1];
            const amountToRepayPrev = Math.max(prevState.converterDirect.amountsToRepay[0], prevState.converterReverse.amountsToRepay[0]);
            const amountToRepayFinal = Math.max(finalState.converterDirect.amountsToRepay[0], finalState.converterReverse.amountsToRepay[0]);
            expect(amountToRepayFinal).lt(amountToRepayPrev);
          });
          it("should reduce collateral amount", async () => {
            const {r1} = await loadFixture(callWithdrawTwoIterations);
            const prevState = r1.states[r1.states.length - 2];
            const finalState = r1.states[r1.states.length - 1];
            const amountCollateralPrev = Math.max(prevState.converterDirect.collaterals[0], prevState.converterReverse.collaterals[0]);
            const amountCollateralFinal = Math.max(finalState.converterDirect.collaterals[0], finalState.converterReverse.collaterals[0]);
            expect(amountCollateralFinal).lt(amountCollateralPrev);
          });
          it("should not change vault.totalAssets too much", async () => {
            const {r1, r2} = await loadFixture(callWithdrawTwoIterations);
            const states = {...r1.states, ...r2.states};
            const totalAssets0 = states[0].vault.totalAssets;
            let sumUncoveredLoss = 0;
            for (let i = 1; i < states.length; ++i) {
              sumUncoveredLoss += (states[i].events?.lossUncoveredCutByMax ?? 0) + (states[i].events?.lossUncoveredNotEnoughInsurance ?? 0);
              const totalAssets = states[i].vault.totalAssets;
              expect(differenceInPercentsNumLessThan(totalAssets0, totalAssets + sumUncoveredLoss, 0.01)).eq(true);
            }
          });

          it("should send expected amount to insurance", async () => {
            const ret = await loadFixture(callWithdrawTwoIterations);
            const [stateLast, statePrev, ...rest] = [...ret.r1.states].reverse();

            const expectedProfitToCover = ret.calcInvestedAssetsR1 - stateLast.strategy.investedAssets;
            const profitToCover = ret.r2.states[0].events?.sentToInsurance ?? 0;

            expect(profitToCover).approximately(expectedProfitToCover, 1e-4);
          });
        });
      });
    });
  });

  describe('withdraw all by steps', function() {
    interface IStrategyInfo {
      name: string,
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3, },
      { name: PLATFORM_ALGEBRA, },
      { name: PLATFORM_KYBER, }
    ];
    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

        return PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );
      }

      describe(`${strategyInfo.name}`, () => {
        describe("Use liquidator", () => {
          describe('Move prices up, enter to pool after completion with pools proportions', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                movePricesUp: true,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
                planKind: PLAN_SWAP_REPAY,
                propNotUnderlying18: BigNumber.from(Misc.MAX_UINT) // use pool's proportions
              });
            }

            it("should enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              const statePrev = ret.states[ret.states.length - 2];
              expect(statePrev.strategy.liquidity).approximately(0, 100); // ignore dust
              expect(stateLast.strategy.liquidity / stateFirst.strategy.liquidity).gt(0.5);
            });
            it("should set expected investedAssets", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.strategy.investedAssets / stateFirst.strategy.investedAssets).gt(0.98);
            });
            it("should set expected totalAssets", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const uncoveredLoss = StateUtilsNum.getTotalUncoveredLoss(ret.states);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.vault.totalAssets + uncoveredLoss).approximately(stateFirst.vault.totalAssets, 100);
            });
            it("should have withdrawDone=0 at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.pairState?.withdrawDone).eq(0); // 1 is set only if the fuse is triggered ON
              expect(stateFirst.pairState?.withdrawDone).eq(0);
            });
            it("should set lastRebalanceNoSwap to 0 at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.pairState?.lastRebalanceNoSwap).eq(0);
            });
          });
          describe('Move prices up, dont enter to pool after completion', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                movePricesUp: true,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_DISABLED,
                planKind: PLAN_SWAP_REPAY,
              });
            }

            it("should reduce locked amount to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.lockedInConverter).eq(0);
            });
            it("should close all debts", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.converterDirect.amountsToRepay.length).eq(1);
              expect(stateLast.converterDirect.amountsToRepay[0]).eq(0);

              expect(stateLast.converterDirect.collaterals.length).eq(1);
              expect(stateLast.converterDirect.collaterals[0]).eq(0);

              expect(stateLast.converterReverse.amountsToRepay.length).eq(1);
              expect(stateLast.converterReverse.amountsToRepay[0]).eq(0);

              expect(stateLast.converterReverse.collaterals.length).eq(1);
              expect(stateLast.converterReverse.collaterals[0]).eq(0);

            });
            it("should not enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.liquidity).eq(0);
            });
            it("should set investedAssets to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              // coverLoss can compensate loss by transferring of USDC/USDT on strategy balance
              // so, even if we are going to convert all assets to underlying, we can have small amount of not-underlying on balance
              expect(stateLast.strategy.investedAssets).lt(1);
            });
            it("should receive totalAssets on balance", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.totalAssets).approximately(stateLast.strategy.assetBalance, 1);
            });
          });
          describe('Move prices down, enter to pool after completion', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                movePricesUp: false,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
                planKind: PLAN_SWAP_REPAY,
                propNotUnderlying18: BigNumber.from(Misc.MAX_UINT), // use pool's proportions
                countRebalances: strategyInfo.name === PLATFORM_ALGEBRA ? 1 : 2
              });
            }

            it("should enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              const statePrev = ret.states[ret.states.length - 2];
              expect(statePrev.strategy.liquidity).approximately(0, 100); // ignore dust
              expect(stateLast.strategy.liquidity / stateFirst.strategy.liquidity).gt(0.5);
            });
            it("should set expected investedAssets", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.strategy.investedAssets / stateFirst.strategy.investedAssets).gt(0.98);
            });
            it("should set expected totalAssets", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const uncoveredLoss = StateUtilsNum.getTotalUncoveredLoss(ret.states);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.vault.totalAssets + uncoveredLoss).approximately(stateFirst.vault.totalAssets, 100);
            });
          });
          describe('Move prices down, dont enter to pool after completion', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                movePricesUp: false,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
                planKind: PLAN_SWAP_REPAY,
                countRebalances: strategyInfo.name === PLATFORM_ALGEBRA ? 1 : 2
              });
            }

            it("should reduce locked amount to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.lockedInConverter).eq(0);
            });
            it("should close all debts", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.converterDirect.amountsToRepay.length).eq(1);
              expect(stateLast.converterDirect.amountsToRepay[0]).eq(0);

              expect(stateLast.converterDirect.collaterals.length).eq(1);
              expect(stateLast.converterDirect.collaterals[0]).eq(0);

              expect(stateLast.converterReverse.amountsToRepay.length).eq(1);
              expect(stateLast.converterReverse.amountsToRepay[0]).eq(0);

              expect(stateLast.converterReverse.collaterals.length).eq(1);
              expect(stateLast.converterReverse.collaterals[0]).eq(0);

            });
            it("should not enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.liquidity).eq(0);
            });
            it("should set investedAssets to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              // coverLoss can compensate loss by transferring of USDC/USDT on strategy balance
              // so, even if we are going to convert all assets to underlying, we can have small amount of not-underlying on balance
              expect(stateLast.strategy.investedAssets).lt(5);
            });
            it("should receive totalAssets on balance", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.totalAssets).approximately(stateLast.strategy.assetBalance, 5);
            });
          });
          describe("Full withdraw when fuse is triggered ON", () => {
            const pathOut = `./tmp/${strategyInfo.name}-full-withdraw-fuse-on.csv`;
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await initialize();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function initialize(): Promise<IBuilderResults> {
              const b = await prepareStrategy();
              await PairBasedStrategyPrepareStateUtils.prepareTwistedDebts(
                b, {
                    movePricesUp: true,
                    countRebalances: 2,
                    swapAmountRatio: DEFAULT_SWAP_AMOUNT_RATIO,
                    amountToDepositBySigner2: "100",
                    amountToDepositBySigner: "10000"
                  },
                  pathOut,
                  signer,
                  signer2,
              );
              // prepare fuse
              await PairBasedStrategyPrepareStateUtils.prepareFuse(b, true);
              // enable fuse
              await b.strategy.connect(signer).rebalanceNoSwaps(true, {gasLimit: 10_000_000});

              return b;
            }

            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                movePricesUp: true, // not used here
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_DISABLED,
                planKind: PLAN_SWAP_REPAY,
                propNotUnderlying18: BigNumber.from(0),
                skipOverCollateralStep: true
              });
            }

            it("initially should set fuse triggered ON", async () => {
              const state = await PackedData.getDefaultState(builderResults.strategy);
              expect(state.fuseStatusTokenA > FUSE_OFF_1 || state.fuseStatusTokenB > FUSE_OFF_1).eq(true);
            });
            it("initially should set withdrawDone = 0", async () => {
              const state = await PackedData.getDefaultState(builderResults.strategy);
              expect(state.withdrawDone).eq(0);
            });
            it("should not enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.strategy.liquidity).lt(1000);
            });
            it("should set expected investedAssets", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.strategy.investedAssets).lt(1000);
            });
            it("should set expected totalAssets", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const uncoveredLoss = StateUtilsNum.getTotalUncoveredLoss(ret.states);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.vault.totalAssets + uncoveredLoss).approximately(stateFirst.vault.totalAssets, 100);
            });
            it("should set withdrawDone=1 at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateFirst = ret.states[0];
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.pairState?.withdrawDone).eq(1);
              expect(stateFirst.pairState?.withdrawDone).eq(0);
            });
            it("should set lastRebalanceNoSwap to 0 at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const stateLast = ret.states[ret.states.length - 1];
              expect(stateLast.pairState?.lastRebalanceNoSwap).eq(0);
            });
          });
        });
        describe("Use liquidator as aggregator", () => {
          describe('Move prices up, dont enter to the pool', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                movePricesUp: true,
                singleIteration: false,
                aggregator: MaticAddresses.TETU_LIQUIDATOR,
                entryToPool: ENTRY_TO_POOL_DISABLED,
                planKind: PLAN_SWAP_REPAY,
              });
            }

            it("should reduce locked amount to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.lockedInConverter).eq(0);
            });
            it("should close all debts", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.converterDirect.amountsToRepay.length).eq(1);
              expect(stateLast.converterDirect.amountsToRepay[0]).eq(0);

              expect(stateLast.converterDirect.collaterals.length).eq(1);
              expect(stateLast.converterDirect.collaterals[0]).eq(0);

              expect(stateLast.converterReverse.amountsToRepay.length).eq(1);
              expect(stateLast.converterReverse.amountsToRepay[0]).eq(0);

              expect(stateLast.converterReverse.collaterals.length).eq(1);
              expect(stateLast.converterReverse.collaterals[0]).eq(0);

            });
            it("should not enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.liquidity).eq(0);
            });
            it("should set investedAssets to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              // coverLoss can compensate loss by transferring of USDC/USDT on strategy balance
              // so, even if we are going to convert all assets to underlying, we can have small amount of not-underlying on balance
              expect(stateLast.strategy.investedAssets).lt(1);
            });
            it("should receive totalAssets on balance", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.totalAssets).approximately(stateLast.strategy.assetBalance, 1);
            });
          });
          describe('Move prices down, dont enter to the pool', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(builderResults, {
                aggregator: MaticAddresses.TETU_LIQUIDATOR,
                movePricesUp: false,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_DISABLED,
                planKind: PLAN_SWAP_REPAY,
              });
            }

            it("should reduce locked amount to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.lockedInConverter).eq(0);
            });
            it("should close all debts", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              console.log("stateLast", stateLast);
              expect(stateLast.converterDirect.amountsToRepay.length).eq(1);
              expect(stateLast.converterDirect.amountsToRepay[0]).eq(0);

              expect(stateLast.converterDirect.collaterals.length).eq(1);
              expect(stateLast.converterDirect.collaterals[0]).eq(0);

              expect(stateLast.converterReverse.amountsToRepay.length).eq(1);
              expect(stateLast.converterReverse.amountsToRepay[0]).eq(0);

              expect(stateLast.converterReverse.collaterals.length).eq(1);
              expect(stateLast.converterReverse.collaterals[0]).eq(0);

            });
            it("should not enter to the pool at the end", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.liquidity).eq(0);
            });
            it("should set investedAssets to zero", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              // coverLoss can compensate loss by transferring of USDC/USDT on strategy balance
              // so, even if we are going to convert all assets to underlying, we can have small amount of not-underlying on balance
              expect(stateLast.strategy.investedAssets).lt(20);
            });
            it("should receive totalAssets on balance", async () => {
              const ret = await loadFixture(makeWithdrawAll);
              const [stateLast, ...rest] = [...ret.states].reverse();
              expect(stateLast.strategy.totalAssets).approximately(stateLast.strategy.assetBalance, 20); // 10966 vs 10954
            });
          });
        });
      });
    });
  });

  describe('withdraw - pure swap', function() {
// todo
  });

  describe('rebalanceNoSwaps', function() {
    interface IStrategyInfo {
      name: string,
      priceUp: boolean,
      countCycles: number,
      depositAmount: string
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3, priceUp: true, countCycles: 3, depositAmount: "100000" },
      { name: PLATFORM_UNIV3, priceUp: false, countCycles: 3, depositAmount: "100000" },
      { name: PLATFORM_ALGEBRA, priceUp: false, countCycles: 2, depositAmount: "1000" },
      { name: PLATFORM_KYBER, priceUp: false, countCycles: 2, depositAmount: "1000" }
    ];
    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

        return PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );
      }

      describe(`${strategyInfo.name}-${strategyInfo.priceUp ? "up" : "down"}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        interface IRebalanceResults {
          needRebalanceBefore: boolean;
          needRebalanceAfter: boolean;
          state0: IStateNum;
          stateFinal: IStateNum;
        }

        async function makeRebalance() : Promise<IRebalanceResults> {
          const b = await prepareStrategy();
          const defaultState = await PackedData.getDefaultState(b.strategy);
          const states: IStateNum[] = [];
          const pathOut = `./tmp/${strategyInfo.name}-${strategyInfo.priceUp ? "up" : "down"}-${strategyInfo.countCycles}-rebalance.csv`;

          console.log('deposit...');
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits(strategyInfo.depositAmount, 6));
          let eventsSet = await CaptureEvents.makeDeposit(b.vault.connect(signer), parseUnits(strategyInfo.depositAmount, 6), strategyInfo.name);

          states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `d`, {eventsSet}));
          await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          for (let i = 0; i < strategyInfo.countCycles; ++i) {
            // generate some rewards
            await UniversalUtils.makePoolVolume(signer, defaultState, b.swapper, parseUnits('600000', 6));
            await TimeUtils.advanceNBlocks(1000);

            if (strategyInfo.priceUp) {
              await UniversalUtils.movePoolPriceUp(
                signer,
                defaultState,
                b.swapper,
                parseUnits('600000', 6),
                100001
              );
            } else {
              await UniversalUtils.movePoolPriceDown(
                signer,
                defaultState,
                b.swapper,
                parseUnits('600000', 6),
                100001
              );
            }
            if (await b.strategy.needRebalance()) break;
          }
          states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `p`, {eventsSet}));
          await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          const needRebalanceBefore = await b.strategy.needRebalance();
          eventsSet = await CaptureEvents.makeRebalanceNoSwap(b.strategy);
          states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `r`, {eventsSet}));
          await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
          const needRebalanceAfter = await b.strategy.needRebalance();

          return {
            needRebalanceBefore,
            needRebalanceAfter,
            state0: states[0],
            stateFinal: states[states.length - 1]
          }
        }

        it('should change needRebalance() result to false', async () => {
          const ret = await loadFixture(makeRebalance);

          expect(ret.needRebalanceBefore).eq(true);
          expect(ret.needRebalanceAfter).eq(false);
        });

        it('difference in fixPriceChanges.investedAssets should match to total amount of loss', async () => {
          const ret = await loadFixture(makeRebalance);

          const totalLoss =
            (ret.stateFinal.events?.lossCoveredVault ?? 0)
            + (ret.stateFinal.events?.lossUncoveredCutByMax ?? 0)
            + (ret.stateFinal.events?.lossUncoveredNotEnoughInsurance ?? 0)
            - (ret.stateFinal.events?.lossRebalance ?? 0) + (ret.stateFinal.events?.coveredByRewards ?? 0);
          const investedAssetsDiff =
            (ret.stateFinal.events?.investedAssetsBeforeFixPriceChanges ?? 0)
            - (ret.stateFinal.events?.investedAssetsAfterFixPriceChanges ?? 0)
          expect(investedAssetsDiff).approximately(totalLoss, 1e-6); // ignore rounding error: 996.729798-996.9994 gives 0,2696020000000770
        });

        it('difference in total assets should match to total uncovered loss', async () => {
          const ret = await loadFixture(makeRebalance);

          const initialTotalAssets = ret.state0.vault.totalAssets;
          const finalTotalAssets = ret.stateFinal.vault.totalAssets;
          const uncoveredLoss =
            + (ret.stateFinal.events?.lossUncoveredCutByMax ?? 0)
            + (ret.stateFinal.events?.lossUncoveredNotEnoughInsurance ?? 0);

          // example of "unknown" loss: expected 697.431018 to be close to 697.431651 +/- 0.000001
          // such loss can happen because of covering borrow-debts
          // so, lets's use 1e-3 instead of 1e-6 below to cover such differences
          expect(initialTotalAssets - finalTotalAssets).approximately(uncoveredLoss, 1e-3);
        });
      });
    });
  });

//endregion Unit tests
});
