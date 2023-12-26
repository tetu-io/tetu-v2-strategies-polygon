/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  IERC20__factory,
  ConverterStrategyBase__factory,
} from "../../../typechain";
import {Misc} from "../../../scripts/utils/Misc";
import {parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../baseUT/utils/StateUtilsNum";
import {UniversalUtils} from "../../baseUT/strategies/UniversalUtils";
import {expect} from "chai";
import {IDefaultState, PackedData} from "../../baseUT/utils/PackedData";
import {IBuilderResults} from "../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_PANCAKE, PLATFORM_UNIV3} from "../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../baseUT/strategies/pair/PairStrategyFixtures";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {PairBasedStrategyPrepareStateUtils} from "../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../baseUT/utils/HardhatUtils";
import {
  FUSE_IDX_LOWER_LIMIT_OFF,
  FUSE_IDX_LOWER_LIMIT_ON,
  FUSE_IDX_UPPER_LIMIT_OFF,
  FUSE_IDX_UPPER_LIMIT_ON,
  FUSE_OFF_1, FUSE_ON_LOWER_LIMIT_2,
  FUSE_ON_UPPER_LIMIT_3
} from "../../baseUT/AppConstants";
import {InjectUtils} from "../../baseUT/strategies/InjectUtils";
import {ConverterUtils} from "../../baseUT/utils/ConverterUtils";

/**
 * Check how fuse triggered ON/OFF because of price changing.
 */
describe('PairBasedFuseAutoTurnOffOnIntTest', function () {
//region Constants
  const DEFAULT_SWAP_AMOUNT_RATIO = 1.01;
  const CHAINS_IN_ORDER_EXECUTION: number[] = [ZKEVM_NETWORK_ID, BASE_NETWORK_ID, POLYGON_NETWORK_ID];
//endregion Constants

//region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region Utils
  interface IPriceFuseStatus {
    price: number;
    fuseStatus: number;
  }

  interface IMovePriceParams {
    pathOut: string;
    maxCountRebalances: number;
    /** up-down OR down-up */
    movePricesUpDown: boolean;
    swapAmountRatio?: number;
  }

  interface IMovePriceResults {
    states: IStateNum[];
    rebalanceFuseOn?: IPriceFuseStatus;
    rebalanceFuseOff?: IPriceFuseStatus;
    thresholds: number[];
  }

  async function movePriceToChangeFuseStatus(
    b: IBuilderResults,
    movePricesUpDown: boolean,
    maxCountRebalances: number,
    state: IDefaultState,
    states: IStateNum[],
    pathOut: string,
    swapAmountRatio?: number
  ): Promise<IPriceFuseStatus | undefined> {
    const COUNT_ITERATIONS = 5;
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const currentFuse = states.length === 0
      ? FUSE_OFF_1
      : states[states.length - 1].fuseStatus;

    for (let i = 0; i < maxCountRebalances; ++i) {
      const totalSwapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
        signer,
        b,
        state.tokenA,
        state.tokenB,
        movePricesUpDown,
        swapAmountRatio ?? DEFAULT_SWAP_AMOUNT_RATIO
      );
      console.log("movePriceToChangeFuseStatus.swapAmount", totalSwapAmount);
      await UniversalUtils.makePoolVolume(signer, state, b.swapper, totalSwapAmount);

      const swapAmount = totalSwapAmount.div(COUNT_ITERATIONS);
      for (let j = 0; j < COUNT_ITERATIONS; ++j) {
        if (movePricesUpDown) {
          await UniversalUtils.movePoolPriceUp(signer, state, b.swapper, swapAmount, 40000);
        } else {
          await UniversalUtils.movePoolPriceDown(signer, state, b.swapper, swapAmount, 40000);
        }

        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fw${i}`, {lib: b.lib}));
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        if ((await b.strategy.needRebalance())) {
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 9_000_000});
          const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r${i}`, {lib: b.lib});
          states.push(stateAfterRebalance);
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          console.log("currentFuse", currentFuse);
          console.log("stateAfterRebalance.fuseStatus", stateAfterRebalance.fuseStatus);
          console.log("stateAfterRebalance.converterDirect.borrowAssetsPrices[1]", stateAfterRebalance.converterDirect.borrowAssetsPrices[1]);
          console.log("stateAfterRebalance.converterDirect.borrowAssetsPrices[0]", stateAfterRebalance.converterDirect.borrowAssetsPrices[0]);
          if (stateAfterRebalance.fuseStatus !== currentFuse) {
            return {
              fuseStatus: stateAfterRebalance.fuseStatus || 0,
              price: stateAfterRebalance.converterDirect.borrowAssetsPrices[1] / stateAfterRebalance.converterDirect.borrowAssetsPrices[0]
            };
          }
        }
      }
    }
  }

  async function movePriceUpDown(b: IBuilderResults, p: IMovePriceParams): Promise<IMovePriceResults> {
    const states: IStateNum[] = [];
    const pathOut = p.pathOut;
    let rebalanceFuseOn: IPriceFuseStatus | undefined;
    let rebalanceFuseOff: IPriceFuseStatus | undefined;

    if ((await b.strategy.needRebalance())) {
      console.log("movePriceToChangeFuseStatus.rebalanceNoSwaps");
      await b.strategy.rebalanceNoSwaps(true, {gasLimit: 9_000_000});
    }

    console.log('deposit...');
    await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(b.asset, signer.address, parseUnits('1000', 6));
    await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

    if ((await b.strategy.needRebalance())) {
      console.log("movePriceToChangeFuseStatus.rebalanceNoSwaps");
      await b.strategy.rebalanceNoSwaps(true, {gasLimit: 9_000_000});
    }

    const state = await PackedData.getDefaultState(b.strategy);
    console.log("=========================== there");
    rebalanceFuseOn = await movePriceToChangeFuseStatus(
      b,
      p.movePricesUpDown,
      p.maxCountRebalances,
      state,
      states,
      pathOut,
      p.swapAmountRatio
    );

    console.log("=========================== back");

    rebalanceFuseOff = await movePriceToChangeFuseStatus(
      b,
      !p.movePricesUpDown,
      p.maxCountRebalances,
      state,
      states,
      pathOut,
      p.swapAmountRatio
    );

    console.log("=========================== done");

    return {
      states,
      rebalanceFuseOn,
      rebalanceFuseOff,
      thresholds: state.fuseThresholds,
    };
  }

//endregion Utils
  CHAINS_IN_ORDER_EXECUTION.forEach(function (chainId) {
    describe(`chain ${chainId}`, function () {
      before(async function () {
        await HardhatUtils.setupBeforeTest(chainId);
        snapshotBefore = await TimeUtils.snapshot();
        [signer, signer2] = await ethers.getSigners();

        await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
      })

      after(async function () {
        await HardhatUtils.restoreBlockFromEnv();
        await TimeUtils.rollback(snapshotBefore);
      });

      describe('Increase price N steps, decrease price N steps, default swapAmountRatio (1.01)', function () {
        interface IStrategyInfo {
          name: string,
          chainId: number;
        }

        const strategies: IStrategyInfo[] = [
          {name: PLATFORM_PANCAKE, chainId: ZKEVM_NETWORK_ID},
          {name: PLATFORM_PANCAKE, chainId: BASE_NETWORK_ID},
          {name: PLATFORM_UNIV3, chainId: POLYGON_NETWORK_ID},
          {name: PLATFORM_ALGEBRA, chainId: POLYGON_NETWORK_ID},
        ];

        strategies.forEach(function (strategyInfo: IStrategyInfo) {
          if (strategyInfo.chainId === chainId) {
            async function prepareStrategy(): Promise<IBuilderResults> {
              const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(chainId, strategyInfo.name, signer, signer2);

              await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
              return b;
            }

            describe(`${strategyInfo.name}`, () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              describe("Use liquidator", () => {
                describe('Move tokenB prices up, down', function () {
                  async function makeTest(): Promise<IMovePriceResults> {
                    const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-up-down.csv`;
                    return movePriceUpDown(builderResults, {
                      maxCountRebalances: 25,
                      pathOut,
                      movePricesUpDown: true,
                      swapAmountRatio: DEFAULT_SWAP_AMOUNT_RATIO
                    });
                  }

                  it("should trigger fuse to FUSE_ON_UPPER_LIMIT_3", async () => {
                    const ret = await loadFixture(makeTest);
                    expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_UPPER_LIMIT_3);
                    expect(ret.rebalanceFuseOn?.price || 0).gte(ret.thresholds[FUSE_IDX_UPPER_LIMIT_ON]);
                  });
                  it("should trigger fuse OFF at the end", async () => {
                    const ret = await loadFixture(makeTest);
                    const status = ret.rebalanceFuseOff?.fuseStatus || 0;
                    expect(status === FUSE_OFF_1 || status === FUSE_ON_LOWER_LIMIT_2).eq(true);

                    // todo: following check was disabled for ALGEBRA because of pricePool-changes
                    //       after implementation of pricePool, fuse A and B are triggered here, not only fuse B
                    if (strategyInfo.name !== PLATFORM_ALGEBRA) {
                      expect(ret.rebalanceFuseOff?.price || 0).lte(ret.thresholds[FUSE_IDX_UPPER_LIMIT_OFF]);
                    }
                  });
                });
                describe('Move tokenB prices down, up', function () {
                  async function makeTest(): Promise<IMovePriceResults> {
                    const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-down-up.csv`;
                    return movePriceUpDown(builderResults, {
                      maxCountRebalances: 25,
                      pathOut,
                      movePricesUpDown: false,
                    });
                  }

                  it("should trigger fuse ON (FUSE_ON_LOWER_LIMIT_2)", async () => {
                    const ret = await loadFixture(makeTest);
                    expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_LOWER_LIMIT_2);

                    // todo: following check was disabled for Univ3 and Kyber because of pricePool-changes
                    //       after implementation of pricePool, fuse A is triggered here, not fuse B
                    if (strategyInfo.name !== PLATFORM_UNIV3 && strategyInfo.name !== PLATFORM_KYBER) {
                      expect(ret.rebalanceFuseOn?.price || 0).lte(ret.thresholds[FUSE_IDX_LOWER_LIMIT_ON]);
                    }
                  });
                  it("should trigger fuse OFF at the end", async () => {
                    const ret = await loadFixture(makeTest);
                    const status = ret.rebalanceFuseOff?.fuseStatus || 0;
                    expect(status === FUSE_OFF_1 || status === FUSE_ON_UPPER_LIMIT_3).eq(true);
                    expect(ret.rebalanceFuseOff?.price || 0).gte(ret.thresholds[FUSE_IDX_LOWER_LIMIT_OFF]);
                  });
                });
              });
            });
          }
        });
      });

      /**
       * This test is excluded from coverage because it doesn't pass for Univ3:
       * 1) There are some problems with swapping dust-amounts in liquidator
       * 2) Price moving is too slow because of the dust amounts, it's not able to set fuse ON / OFF
       *
       * skipped, it's necessary to study only
       */
      describe.skip('Increase price N steps, decrease price N steps, swapAmountRatio = 1 @skip-on-coverage', function () {
        interface IStrategyInfo {
          name: string,
          chainId: number;
        }

        const strategies: IStrategyInfo[] = [
          {name: PLATFORM_UNIV3, chainId: POLYGON_NETWORK_ID},
          {name: PLATFORM_ALGEBRA, chainId: POLYGON_NETWORK_ID},

          // For Kyber we have error NOT_ALLOWED ('TS-23 not allowed') here
          // It means, that required proportion of one of the assets is too small, almost zero
          // It was decided, that it's ok to have revert in that case
          // We can change this behavior by changing BorrowLib.rebalanceRepayBorrow implementation:
          //      if amount-to-repay passed to _repayDebt is too small to be used,
          //      we should increase it min amount required to make repay successfully (amount must be > threshold)

          // { name: PLATFORM_KYBER,},
        ];

        strategies.forEach(function (strategyInfo: IStrategyInfo) {
          if (strategyInfo.chainId === chainId) {
            async function prepareStrategy(): Promise<IBuilderResults> {
              const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(chainId, strategyInfo.name, signer, signer2);

              await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
              return b;
            }

            describe(`${strategyInfo.name}`, () => {
              let snapshot: string;
              let builderResults: IBuilderResults;
              before(async function () {
                snapshot = await TimeUtils.snapshot();

                builderResults = await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              describe("Use liquidator", () => {
                describe('Move tokenB prices up, down', function () {
                  async function makeTest(): Promise<IMovePriceResults> {
                    const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-up-down.csv`;
                    return movePriceUpDown(builderResults, {
                      maxCountRebalances: 25,
                      pathOut,
                      movePricesUpDown: true,
                      swapAmountRatio: 1
                    });
                  }

                  it("should trigger fuse to FUSE_ON_UPPER_LIMIT_3", async () => {
                    const ret = await loadFixture(makeTest);
                    expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_UPPER_LIMIT_3);
                    expect(ret.rebalanceFuseOn?.price || 0).gte(ret.thresholds[FUSE_IDX_UPPER_LIMIT_ON]);
                  });
                  it("should trigger fuse OFF at the end", async () => {
                    const ret = await loadFixture(makeTest);
                    const status = ret.rebalanceFuseOff?.fuseStatus || 0;
                    expect(status === FUSE_OFF_1 || status === FUSE_ON_LOWER_LIMIT_2).eq(true);
                    expect(ret.rebalanceFuseOff?.price || 0).lte(ret.thresholds[FUSE_IDX_UPPER_LIMIT_OFF]);
                  });
                });
                describe('Move tokenB prices down, up', function () {
                  async function makeTest(): Promise<IMovePriceResults> {
                    const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-down-up.csv`;
                    return movePriceUpDown(builderResults, {
                      maxCountRebalances: 25,
                      pathOut,
                      movePricesUpDown: false,
                      swapAmountRatio: 1
                    });
                  }

                  it("should trigger fuse ON (FUSE_ON_LOWER_LIMIT_2)", async () => {
                    const ret = await loadFixture(makeTest);
                    expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_LOWER_LIMIT_2);
                    expect(ret.rebalanceFuseOn?.price || 0).lte(ret.thresholds[FUSE_IDX_LOWER_LIMIT_ON]);
                  });
                  it("should trigger fuse OFF at the end", async () => {
                    const ret = await loadFixture(makeTest);
                    const status = ret.rebalanceFuseOff?.fuseStatus || 0;
                    expect(status === FUSE_OFF_1 || status === FUSE_ON_UPPER_LIMIT_3).eq(true);
                    expect(ret.rebalanceFuseOff?.price || 0).gte(ret.thresholds[FUSE_IDX_LOWER_LIMIT_OFF]);
                  });
                });
              });
            });
          }
        });
      });
    });
  });
});
