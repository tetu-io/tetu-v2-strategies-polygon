/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  ConverterStrategyBase__factory,
  IERC20__factory, StrategyBaseV2__factory,
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {depositToVault, printVaultState} from "../../../StrategyTestUtils";
import {BigNumber, BytesLike} from "ethers";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {IBuilderResults, PairBasedStrategyBuilder} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {areAlmostEqual, differenceInPercentsNumLessThan} from "../../../baseUT/utils/MathUtils";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

/**
 * There are two kind of tests here:
 * 1) test uses liquidator
 * 2) test uses aggregator
 * Liquidator has modified price, but aggregator has unchanged current price different from the price in our test.
 */
describe('PairBasedNoSwapIntTest', function() {
  const ENTRY_TO_POOL_DISABLED = 0;
  const ENTRY_TO_POOL_IS_ALLOWED = 1;
  const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
  })

  after(async function() {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: parseInt(process.env.TETU_MATIC_FORK_BLOCK || '', 10) || undefined,
          },
        },
      ],
    });
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Fixtures
  async function buildStrategy(strategyName: string): Promise<IBuilderResults> {
    switch (strategyName) {
      case PLATFORM_UNIV3: return buildUniv3();
      case PLATFORM_ALGEBRA: return buildAlgebra();
      case PLATFORM_KYBER: return buildKyber();
      default: throw Error(`buildStrategy doesn't support ${strategyName}`);
    }
  }
  async function buildUniv3(): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildUniv3({
      signer,
      signer2,
      gov: MaticAddresses.GOV_ADDRESS,
      pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
      asset: MaticAddresses.USDC_TOKEN,
      vaultName: 'TetuV2_UniswapV3_USDC-USDT-0.01%',
      converter: MaticAddresses.TETU_CONVERTER,
      profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN],
      swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
      liquidatorPools: [{
        pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDC_TOKEN,
        tokenOut: MaticAddresses.USDT_TOKEN,
      },]

    });
  }

  async function buildAlgebra(): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildAlgebra({
      signer,
      signer2,
      gov: MaticAddresses.GOV_ADDRESS,
      pool: MaticAddresses.ALGEBRA_USDC_USDT,
      asset: MaticAddresses.USDC_TOKEN,
      vaultName: 'TetuV2_Algebra_USDC_USDT',
      converter: MaticAddresses.TETU_CONVERTER,
      profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.dQUICK_TOKEN, MaticAddresses.WMATIC_TOKEN,],
      swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
      liquidatorPools: [
        // for production
        {
          pool: MaticAddresses.ALGEBRA_dQUICK_QUICK,
          swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
          tokenIn: MaticAddresses.dQUICK_TOKEN,
          tokenOut: MaticAddresses.QUICK_TOKEN,
        },
        {
          pool: MaticAddresses.ALGEBRA_USDC_QUICK,
          swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
          tokenIn: MaticAddresses.QUICK_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },

        // only for test to prevent 'TS-16 price impact'
        {
          pool: MaticAddresses.ALGEBRA_USDC_USDT,
          swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
          tokenIn: MaticAddresses.USDC_TOKEN,
          tokenOut: MaticAddresses.USDT_TOKEN,
        },
      ]
    });
  }

  async function buildKyber(): Promise<IBuilderResults> {
    return PairBasedStrategyBuilder.buildKyber({
      signer,
      signer2,
      gov: MaticAddresses.GOV_ADDRESS,
      pool: MaticAddresses.KYBER_USDC_USDT,
      asset: MaticAddresses.USDC_TOKEN,
      vaultName: 'TetuV2_Kyber_USDC_USDT',
      converter: MaticAddresses.TETU_CONVERTER,
      profitHolderTokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN,],
      swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
      liquidatorPools: [
        {
          pool: MaticAddresses.KYBER_KNC_USDC,
          swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
          tokenIn: MaticAddresses.KNC_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },
      ]
    });
  }
//endregion Fixtures

//region Utils
  interface IPrepareOverCollateralParams {
    countLoops: number;
    movePricesUp: boolean;
  }
  interface IListStates {
    states: IStateNum[];
  }

  async function prepareOverCollateral(b: IBuilderResults, p: IPrepareOverCollateralParams, pathOut: string) : Promise<IListStates> {
    const states: IStateNum[] = [];

    const defaultState = await PackedData.getDefaultState(b.strategy);
    const strategyAsSigner = StrategyBaseV2__factory.connect(b.strategy.address, signer);

    console.log('deposit...');
    await b.vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(b.asset, signer2.address, parseUnits('1000', 6));
    await b.vault.connect(signer2).deposit(parseUnits('1000', 6), signer2.address);

    const depositAmount1 = parseUnits('10000', b.assetDecimals);
    await TokenUtils.getToken(b.asset, signer.address, depositAmount1.mul(p.countLoops));
    let swapAmount = parseUnits('100000', b.assetDecimals);

    await depositToVault(b.vault, signer, depositAmount1, b.assetDecimals, b.assetCtr, b.insurance);

    for (let i = 0; i < p.countLoops; i++) {
      const sharePriceBefore = await b.vault.sharePrice();
      console.log('------------------ CYCLE', i, '------------------');

      await TimeUtils.advanceNBlocks(300);

      if (p.movePricesUp) {
        await UniversalUtils.movePoolPriceUp(signer2, defaultState.pool, defaultState.tokenA, defaultState.tokenB, b.swapper, swapAmount);
      } else {
        await UniversalUtils.movePoolPriceDown(signer2, defaultState.pool, defaultState.tokenA, defaultState.tokenB, b.swapper, swapAmount);
      }
      states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `p${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      // we suppose the rebalance happens immediately when it needs
      if (await b.strategy.needRebalance()) {
        console.log('------------------ REBALANCE' , i, '------------------');

        await b.strategy.connect(signer).rebalanceNoSwaps(true, {gasLimit: 10_000_000});
        await printVaultState(b.vault, b.splitter, strategyAsSigner, b.assetCtr, b.assetDecimals);

        states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `r${i}`));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
      }

      // decrease swap amount slowly
      swapAmount = swapAmount.mul(12).div(10); // div on 1.1
    }

    return {states};
  }

  interface IWithdrawParams {
    aggregator: string;
    planEntryData: string;
    entryToPool: number;
    singleIteration: boolean;
  }
  async function makeFullWithdraw(b: IBuilderResults, p: IWithdrawParams, pathOut: string, states: IStateNum[]): Promise<IListStates> {
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
          const params = {
            fromTokenAddress: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            toTokenAddress: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            amount: quote.amountToSwap.toString(),
            fromAddress: strategyAsOperator.address,
            slippage: 1,
            disableEstimate: true,
            allowPartialFill: false,
            protocols: 'POLYGON_BALANCER_V2',
          };
          console.log("params", params);

          const swapTransaction = await AggregatorUtils.buildTxForSwap(JSON.stringify(params));
          console.log('Transaction for 1inch swap: ', swapTransaction);
          swapData = swapTransaction.data;
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
      console.log("makeFullWithdraw.withdrawByAggStep.callStatic --------------------------------");
      console.log("tokenToSwap", tokenToSwap);
      console.log("AGGREGATOR", p.aggregator);
      console.log("amountToSwap", amountToSwap);
      console.log("swapData", swapData);
      console.log("swapData.length", swapData.length);
      console.log("planEntryData", p.planEntryData);
      console.log("ENTRY_TO_POOL_IS_ALLOWED", p.entryToPool);
      const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
        tokenToSwap,
        p.aggregator,
        amountToSwap,
        swapData,
        p.planEntryData,
        p.entryToPool
      );

      console.log("makeFullWithdraw.withdrawByAggStep.execute --------------------------------");
      await strategyAsOperator.withdrawByAggStep(
        tokenToSwap,
        p.aggregator,
        amountToSwap,
        swapData,
        p.planEntryData,
        p.entryToPool
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");

      states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `u${++step}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

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

    /** 3 by default */
    countLoops?: number;
    /** ZERO by default */
    aggregator?: string;
  }

  async function makeWithdrawTest(b: IBuilderResults, p: IMakeWithdrawTestParams): Promise<IMakeWithdrawTestResults> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    const agg = p.aggregator === Misc.ZERO_ADDRESS
      ? "no"
      : p.aggregator === MaticAddresses.TETU_LIQUIDATOR
        ? "liquidator-as-agg"
        : p.aggregator === MaticAddresses.AGG_ONEINCH_V5
          ? "1inch"
          : "unknown";
    const pathOut = `${platform}-entry${p.entryToPool}-${p.singleIteration ? "single" : "many"}-${p.movePricesUp ? "up" : "down"}-${agg}.csv`;

    const ret0 = await prepareOverCollateral(
      b,
      {
      countLoops: p.countLoops ?? 3,
      movePricesUp: p.movePricesUp
      },
      pathOut
    );
    const {states} = await makeFullWithdraw(
      b,
      {
        singleIteration: p.singleIteration,
        aggregator: p.aggregator ?? Misc.ZERO_ADDRESS,
        entryToPool: p.entryToPool,
        planEntryData: p.planKind === PLAN_REPAY_SWAP_REPAY
          ? defaultAbiCoder.encode(["uint256"], [PLAN_REPAY_SWAP_REPAY])
          : p.planKind === PLAN_SWAP_REPAY
            ? defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0])
            : p.planKind === PLAN_SWAP_ONLY
              ? defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_ONLY, 0])
              : "0x"
      },
      `./tmp/${pathOut}`,
      ret0.states
    );
    return {states};
  }

//endregion Utils


//region Unit tests
  describe('unfold debts using single iteration', function() {
    interface IStrategyInfo {
      name: string,
      sharePriceDeviation: number
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3, sharePriceDeviation: 1e-6},
      { name: PLATFORM_ALGEBRA, sharePriceDeviation: 1e-3}, // todo why the deviation is so large?
      { name: PLATFORM_KYBER, sharePriceDeviation: 1e-3} // todo why the deviation is so large?
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      let snapshot: string;
      async function prepareStrategy(): Promise<IBuilderResults> {
        return buildStrategy(strategyInfo.name);
      }

      describe(`${strategyInfo.name}`, () => {
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        describe("Use liquidator", () => {
          describe("Move prices up", () => {
            describe("Liquidator, entry to pool at the end", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy), {
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, strategyInfo.sharePriceDeviation);
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
              it("should put more liquidity to the pool", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const initialTotalLiquidity = states[0].strategy.liquidity;
                const finalTotalLiquidity = states[states.length - 1].strategy.liquidity;
                expect(finalTotalLiquidity).gt(initialTotalLiquidity);
              });
              it("should reduce amount-to-repay", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const amountToRepay0 = states[0].converterDirect.amountsToRepay[0];
                const amountToRepayFinal = states[states.length - 1].converterDirect.amountsToRepay[0]
                expect(amountToRepayFinal).lt(amountToRepay0);
              });
              it("should reduce collateral amount", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const amountCollateral0 = states[0].converterDirect.collaterals[0];
                const amountCollateralFinal = states[states.length - 1].converterDirect.collaterals[0]
                expect(amountCollateralFinal).lt(amountCollateral0);
              });
              it("should not change strategy.totalAssets too much", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const totalAssets0 = states[0].strategy.totalAssets;
                const totalAssetsFinal = states[states.length - 1].strategy.totalAssets;
                expect(differenceInPercentsNumLessThan(totalAssets0, totalAssetsFinal, 0.1)).eq(true);
              });
            });
            describe("Liquidator, don't enter to the pool", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy), {
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_DISABLED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, strategyInfo.sharePriceDeviation);
              });
              it("should not enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                console.log("stateLast", stateLast);
                expect(stateLast.strategy.liquidity).eq(0);
              });
            });
          });
          describe("Move prices down", () => {
            describe("Liquidator, entry to pool at the end", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy), {
                  countLoops: 2,
                  movePricesUp: false,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice,  strategyInfo.sharePriceDeviation);
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
            });
            describe("Liquidator, don't enter to the pool", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy), {
                  countLoops: 2,
                  movePricesUp: false,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_DISABLED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, strategyInfo.sharePriceDeviation);
              });
              it("should not enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                console.log("stateLast", stateLast);
                expect(stateLast.strategy.liquidity).eq(0);
              });
            });
          });
        });
        describe("Use 1inch", () => {
          describe("Move prices up", () => {
            describe("Liquidator, entry to pool at the end", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy),
                  {
                    aggregator: MaticAddresses.AGG_ONEINCH_V5,
                    movePricesUp: true,
                    singleIteration: true,
                    entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                    planKind: PLAN_REPAY_SWAP_REPAY,
                  }
                );
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                // Share price can change here because prices are not changed in 1inch
                // expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, 1e-6);
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
            });
          });
        });
        describe("Use liquidator as aggregator", () => {
          describe("Move prices up", () => {
            describe("Liquidator, entry to pool at the end", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy), {
                  aggregator: MaticAddresses.TETU_LIQUIDATOR,
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, 1e-6);
              });
              it("should enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                expect(stateLast.strategy.liquidity > 0).eq(true);
              });
            });
            describe("Liquidator, don't enter to the pool", () => {
              async function callWithdrawSingleIteration(): Promise<IMakeWithdrawTestResults> {
                return makeWithdrawTest(await loadFixture(prepareStrategy), {
                  aggregator: MaticAddresses.TETU_LIQUIDATOR,
                  movePricesUp: true,
                  singleIteration: true,
                  entryToPool: ENTRY_TO_POOL_DISABLED,
                  planKind: PLAN_REPAY_SWAP_REPAY,
                });
              }

              it("should reduce locked amount at least twice", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, statePrev, ...rest] = [...states].reverse();
                expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
                expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, strategyInfo.sharePriceDeviation);
              });
              it("should not enter to the pool at the end", async () => {
                const {states} = await loadFixture(callWithdrawSingleIteration);
                const [stateLast, ...rest] = [...states].reverse();
                console.log("stateLast", stateLast);
                expect(stateLast.strategy.liquidity).eq(0);
              });
            });
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
        return buildStrategy(strategyInfo.name);
      }

      describe(`${strategyInfo.name}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        describe("Use liquidator", () => {
          describe('Move prices up', function () {
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(await loadFixture(prepareStrategy), {
                movePricesUp: true,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
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
          describe('Move prices down', function () {
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(await loadFixture(prepareStrategy), {
                movePricesUp: false,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
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
        });
        describe("Use liquidator as aggregator", () => {
          describe('Move prices up', function () {
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(await loadFixture(prepareStrategy), {
                movePricesUp: true,
                singleIteration: false,
                aggregator: MaticAddresses.TETU_LIQUIDATOR,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
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
          describe('Move prices down', function () {
            async function makeWithdrawAll(): Promise<IMakeWithdrawTestResults> {
              return makeWithdrawTest(await loadFixture(prepareStrategy), {
                aggregator: MaticAddresses.TETU_LIQUIDATOR,
                movePricesUp: false,
                singleIteration: false,
                entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
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
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3, },
      { name: PLATFORM_ALGEBRA, },
      { name: PLATFORM_KYBER, }
    ];
    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        return buildStrategy(strategyInfo.name);
      }

      describe(`${strategyInfo.name}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it('should change needRebalance() result to false', async () => {
          const b = await prepareStrategy();
          const defaultState = await PackedData.getDefaultState(b.strategy);

          console.log('deposit...');
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('1000', 6));
          await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

          for (let i = 0; i < 3; ++i) {
            await UniversalUtils.movePoolPriceDown(
              signer,
              defaultState.pool,
              defaultState.tokenA,
              defaultState.tokenB,
              b.swapper,
              parseUnits('600000', 6),
              100001
            );
            if (await b.strategy.needRebalance()) break;
          }

          const needRebalanceBefore = await b.strategy.needRebalance();
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 10_000_000});
          const needRebalanceAfter = await b.strategy.needRebalance();

          expect(needRebalanceBefore).eq(true);
          expect(needRebalanceAfter).eq(false);
        });
      });
    });
  });

//endregion Unit tests
});