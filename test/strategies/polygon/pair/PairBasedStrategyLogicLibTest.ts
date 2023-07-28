import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock,
  PairBasedStrategyLogicLibFacade, MockController, IERC20Metadata__factory
} from "../../../../typechain";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {BigNumber} from "ethers";
import {PairBasedStrategyLib} from "../../../../typechain/contracts/test/facades/PairBasedStrategyLogicLibFacade";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Misc} from "../../../../scripts/utils/Misc";

describe('PairBasedStrategyLogicLibTest', () => {
//region Constants and variables
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;

  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;

  let snapshotBefore: string;
  let governance: SignerWithAddress;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let bal: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let liquidator: MockTetuLiquidatorSingleCall;
  let forwarder: MockForwarder;
  let facade: PairBasedStrategyLogicLibFacade;
  let converter: MockTetuConverter;
  let priceOracleMock: PriceOracleMock;
  let controller: MockController;
//endregion Constants and variables

  //region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    governance = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    bal = await DeployerUtils.deployMockToken(signer, 'BAL');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);

    liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
    forwarder = await MockHelper.createMockForwarder(signer);
    facade = await MockHelper.createPairBasedStrategyLogicLibFacade(signer);

    controller = await MockHelper.createMockController(signer);
    converter = await MockHelper.createMockTetuConverter(signer);
    priceOracleMock = await MockHelper.createPriceOracle(
      signer,
      [usdc.address, usdt.address, tetu.address],
      [parseUnits("1", 18), parseUnits("1", 18), parseUnits("1", 18)]
    );
    const tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracleMock.address);
    await converter.setController(tetuConverterController.address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  describe("needStrategyRebalance", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IUniv3State {
      tokenA: MockToken;
      tokenB: MockToken;
      fuseAB: {
        status: number;
        thresholds: string[];
      }[];

      pool?: string;
      isStablePool?: boolean;
      depositorSwapTokens?: boolean;
      totalLiquidity?: number;
      strategyProfitHolder?: string;
    }
    interface INeedStrategyRebalanceParams {
      state: IUniv3State;
      pricesAB: string[];
      poolNeedsRebalance: boolean;
    }
    interface INeedStrategyRebalanceResults {
      needRebalance: boolean;
      fuseStatusChangedAB: [boolean, boolean];
      fuseStatusAB: [number, number];
    }
    async function callNeedStrategyRebalance(p: INeedStrategyRebalanceParams): Promise<INeedStrategyRebalanceResults> {
      const tick = p.poolNeedsRebalance ? 9 : 11;
      const tickSpacing = 10;
      const lowerTick = 10;
      const upperTick = 20;
      const rebalanceTickRange = 0;

      await priceOracleMock.changePrices(
        [p.state.tokenA.address, p.state.tokenB.address],
        [parseUnits(p.pricesAB[0], 18), parseUnits(p.pricesAB[1], 18)]
      );

      await facade.setPairState(
        [p.state.tokenA.address, p.state.tokenB.address],
        p.state.pool || ethers.Wallet.createRandom().address,
        p.state.isStablePool || true,
        [tickSpacing, lowerTick, upperTick, rebalanceTickRange],
        p.state.depositorSwapTokens || false,
        p.state.totalLiquidity || 0,
        p.state.strategyProfitHolder || ethers.Wallet.createRandom().address,
        [
          {
            status: p.state.fuseAB[0].status,
            thresholds: [
              parseUnits(p.state.fuseAB[0].thresholds[0], 18),
              parseUnits(p.state.fuseAB[0].thresholds[1], 18),
              parseUnits(p.state.fuseAB[0].thresholds[2], 18),
              parseUnits(p.state.fuseAB[0].thresholds[3], 18),
            ]
          },
          {
            status: p.state.fuseAB[1].status,
            thresholds: [
              parseUnits(p.state.fuseAB[1].thresholds[0], 18),
              parseUnits(p.state.fuseAB[1].thresholds[1], 18),
              parseUnits(p.state.fuseAB[1].thresholds[2], 18),
              parseUnits(p.state.fuseAB[1].thresholds[3], 18),
            ]
          },
        ],
        0 // withdrawDone
      );
      const ret = await facade.needStrategyRebalance(
        converter.address,
        tick
      );
      return {
        needRebalance: ret.needRebalance,
        fuseStatusAB: ret.fuseStatusAB,
        fuseStatusChangedAB: ret.fuseStatusChangedAB
      }
    }

    describe("pool requires rebalance", () => {
      describe("fuse is triggered ON", () => {
        describe("fuse changes its status", () => {
          it("should return true, fuse A", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.8", // (!) price exceeds 0.7, fuse is triggerred OFF
                "1.0" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
          it("should return true, fuse B", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                ]
              },
              pricesAB: [
                "1.0", // price is ok
                "0.8", // (!) price exceeds 0.7, fuse is triggerred OFF
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
        });
        describe("fuse doesn't change its status, it's still triggered ON", () => {
          it("should return false, fuse A", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.69", // (!) price is less than 0.7, fuse is still triggerred ON
                "1.0" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(false);
          });
          it("should return false, fuse B", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                ]
              },
              pricesAB: [
                "1.0", // price is ok
                "0.69", // (!) price is less than 0.7, fuse is still triggerred ON
              ]
            });

            expect(ret.needRebalance).eq(false);
          });
        });
      });
      describe("fuse is not triggered", () => {
        describe("fuse changes its status", () => {
          it("should return true, fuse A", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.49", // (!) price is less than 0.5, fuse is triggerred ON
                "1.0" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
          it("should return true, fuse B", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                ]
              },
              pricesAB: [
                "1.0", // price is ok
                "0.49", // (!) price is less than 0.5, fuse is triggerred ON
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
        });
        describe("fuse doesn't change its status, it's still triggered OFF", () => {
          it("should return true (pool required a rebalance)", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.51", // price is still ok
                "0.51" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
        });
      });
    });
    describe("pool doesn't require rebalance", () => {
      describe("fuse is triggered ON", () => {
        describe("fuse changes its status", () => {
          it("should return true, fuse A", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.8", // (!) price exceeds 0.7, fuse is triggerred OFF
                "1.0" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
          it("should return true, fuse B", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                ]
              },
              pricesAB: [
                "1.0", // price is ok
                "0.8", // (!) price exceeds 0.7, fuse is triggerred OFF
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
        });
        describe("fuse doesn't change its status, it's still triggered ON", () => {
          it("should return false, fuse A", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.69", // (!) price is less than 0.7, fuse is still triggerred ON
                "1.0" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(false);
          });
          it("should return false, fuse B", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_ON_LOWER_LIMIT_2, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                ]
              },
              pricesAB: [
                "1.0", // price is ok
                "0.69", // (!) price is less than 0.7, fuse is still triggerred ON
              ]
            });

            expect(ret.needRebalance).eq(false);
          });
        });
      });
      describe("fuse is not triggered", () => {
        describe("fuse changes its status", () => {
          it("should return true, fuse A", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.49", // (!) price is less than 0.5, fuse is triggerred ON
                "1.0" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
          it("should return true, fuse B", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                ]
              },
              pricesAB: [
                "1.0", // price is ok
                "0.49", // (!) price is less than 0.5, fuse is triggerred ON
              ]
            });

            expect(ret.needRebalance).eq(true);
          });
        });
        describe("fuse doesn't change its status, it's still triggered OFF", () => {
          it("should return false", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: false,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                fuseAB: [
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]},
                  {status: FUSE_OFF_1, thresholds: ["0.5", "0.7", "1.5", "1.3"]}
                ]
              },
              pricesAB: [
                "0.51", // price is still ok
                "0.51" // price is ok
              ]
            });

            expect(ret.needRebalance).eq(false);
          });
        });
      });
    });
  });

  describe("updateFuseStatus", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IUpdateFuseStatusParams {
      isStablePool: boolean;
      initialFuseStatusAB: number[],
      fuseStatusChangedAB: boolean[],
      fuseStatusAB: number[];
      withdrawDone: number;
    }

    interface IUpdateFuseStatusResults {
      fuseStatusAB: number[];
      withdrawDone: number;
    }

    async function callUpdateFuseStatus(p: IUpdateFuseStatusParams): Promise<IUpdateFuseStatusResults> {
      await facade.setPairState(
        [usdc.address, usdt.address],
        ethers.Wallet.createRandom().address,
        p.isStablePool,
        [1, 2, 3, 4],
        true,
        0,
        ethers.Wallet.createRandom().address,
        [{
          status: p.initialFuseStatusAB[0],
          thresholds: [0, 0, 0, 0]
        }, {
          status: p.initialFuseStatusAB[1],
          thresholds: [0, 0, 0, 0]
        }],
        p.withdrawDone
      );

      await facade.updateFuseStatus(
        [p.fuseStatusChangedAB[0], p.fuseStatusChangedAB[1]],
        [p.fuseStatusAB[0], p.fuseStatusAB[1]],
      )

      const pairStateData = await facade.getPairState();
      return {
        fuseStatusAB: [pairStateData.fuseParams[0].toNumber(), pairStateData.fuseParams[5].toNumber()],
        withdrawDone: pairStateData.withdrawDone.toNumber()
      }
    }

    it("should change both fuse status, stable pool", async () => {
      const ret = await callUpdateFuseStatus({
        initialFuseStatusAB: [1, 1],
        fuseStatusChangedAB: [true, true],
        fuseStatusAB: [2, 2],
        isStablePool: true,
        withdrawDone: 1
      });
      expect(ret.fuseStatusAB.join()).eq([2, 2].join());
      expect(ret.withdrawDone).eq(0);
    });

    it("should change both fuse status, not stable pool", async () => {
      const ret = await callUpdateFuseStatus({
        initialFuseStatusAB: [1, 1],
        fuseStatusChangedAB: [true, true],
        fuseStatusAB: [2, 2],
        isStablePool: false,
        withdrawDone: 1
      });
      expect(ret.fuseStatusAB.join()).eq([2, 2].join());
      expect(ret.withdrawDone).eq(0);
    });

    it("should change both fuse A only", async () => {
      const ret = await callUpdateFuseStatus({
        initialFuseStatusAB: [1, 1],
        fuseStatusChangedAB: [true, false],
        fuseStatusAB: [2, 2],
        isStablePool: true,
        withdrawDone: 1
      });
      expect(ret.fuseStatusAB.join()).eq([2, 1].join());
      expect(ret.withdrawDone).eq(0);
    });

    it("should change both fuse B only", async () => {
      const ret = await callUpdateFuseStatus({
        initialFuseStatusAB: [1, 1],
        fuseStatusChangedAB: [false, true],
        fuseStatusAB: [2, 2],
        isStablePool: true,
        withdrawDone: 1
      });
      expect(ret.fuseStatusAB.join()).eq([1, 2].join());
      expect(ret.withdrawDone).eq(0);
    });

    it("should not change any fuse status", async () => {
      const ret = await callUpdateFuseStatus({
        initialFuseStatusAB: [1, 1],
        fuseStatusChangedAB: [false, false],
        fuseStatusAB: [2, 2],
        isStablePool: false,
        withdrawDone: 1
      });
      expect(ret.fuseStatusAB.join()).eq([1, 1].join());
      expect(ret.withdrawDone).eq(1);
    });
  });

  describe("setInitialDepositorValues", () => {
    interface ISetValuesParams {
      pool: string;
      asset: string;
      token0: string;
      token1: string;

      tickSpacing: number;
      lowerTick: number;
      upperTick: number;
      rebalanceTickRange: number;

      isStablePool: boolean;
      fuseThresholdsA: number[];
      fuseThresholdsB: number[];
    }
    interface ISetValuesResults {
      init: ISetValuesParams;

      tokenA: string;
      tokenB: string;
      depositorSwapTokens: boolean;

      pool: string;
      isStablePool: boolean;

      tickSpacing: number;
      lowerTick: number;
      upperTick: number;
      rebalanceTickRange: number;

      totalLiquidity: BigNumber;
      strategyProfitHolder: string;

      fuseA: PairBasedStrategyLib.FuseStateParamsStruct;
      fuseB: PairBasedStrategyLib.FuseStateParamsStruct;

      withdrawDone: number;
    }
    async function callSetInitialDepositorValues(p: ISetValuesParams): Promise<ISetValuesResults> {
      console.log("isStablePool", p.isStablePool);
      await facade.setInitialDepositorValues(
        [p.pool, p.asset, p.token0, p.token1],
        [p.tickSpacing, p.lowerTick, p.upperTick, p.rebalanceTickRange],
        p.isStablePool,
        [p.fuseThresholdsA[0], p.fuseThresholdsA[1], p.fuseThresholdsA[2], p.fuseThresholdsA[3]],
        [p.fuseThresholdsB[0], p.fuseThresholdsB[1], p.fuseThresholdsB[2], p.fuseThresholdsB[3]],
      );

      const pairStateData = await facade.getPairState();
      return {
        init: p,

        tokenA: pairStateData.tokensAB[0],
        tokenB: pairStateData.tokensAB[1],
        depositorSwapTokens: pairStateData.depositorSwapTokens,

        pool: pairStateData.pool,
        isStablePool: pairStateData.isStablePool,

        tickSpacing: pairStateData.tickParams[0],
        lowerTick: pairStateData.tickParams[1],
        upperTick:  pairStateData.tickParams[2],
        rebalanceTickRange:  pairStateData.tickParams[3],

        totalLiquidity: pairStateData.totalLiquidity,
        strategyProfitHolder: pairStateData.strategyProfitHolder,

        fuseA: {
          status: pairStateData.fuseParams[0],
          thresholds: [pairStateData.fuseParams[1], pairStateData.fuseParams[2], pairStateData.fuseParams[3], pairStateData.fuseParams[4]]
        },
        fuseB: {
          status: pairStateData.fuseParams[5],
          thresholds: [pairStateData.fuseParams[6], pairStateData.fuseParams[7], pairStateData.fuseParams[8], pairStateData.fuseParams[9]]
        },

        withdrawDone: pairStateData.withdrawDone.toNumber()
      }
    }

    describe("Good paths", () => {
      describe("stable pool, not swapped tokens", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function setInitialDepositorValuesTest(): Promise<ISetValuesResults> {
          const asset = ethers.Wallet.createRandom().address;
          return callSetInitialDepositorValues({
            isStablePool: true,
            pool: ethers.Wallet.createRandom().address,

            token0: asset,
            token1: ethers.Wallet.createRandom().address,

            tickSpacing: 1,
            lowerTick: 2,
            upperTick: 3,
            rebalanceTickRange: 4,

            asset,

            fuseThresholdsA: [11, 12, 14, 13],
            fuseThresholdsB: [21, 22, 24, 23]
          });
        }

        it("should return expected pool params", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.pool).eq(ret.init.pool);
          expect(ret.isStablePool).eq(true);
        });
        it("should return expected tokens", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.tokenA).eq(ret.init.token0);
          expect(ret.tokenB).eq(ret.init.token1);
          expect(ret.depositorSwapTokens).eq(false);
        });
        it("should return expected ticks", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.tickSpacing, ret.lowerTick, ret.upperTick, ret.rebalanceTickRange].join()).eq([1, 2, 3, 4].join());
        });
        it("should return expected zero params", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.totalLiquidity.toString(), ret.strategyProfitHolder.toString(), ret.withdrawDone.toString()].join()).eq(["0", Misc.ZERO_ADDRESS, "0"].join());
        });
        it("should return fuse status", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.fuseA.status, ret.fuseB.status].join()).eq([FUSE_OFF_1, FUSE_OFF_1].join());
        });
        it("should return fuse A thresholds", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.fuseA.thresholds.join()).eq([11, 12, 14, 13].join());
        });
        it("should return fuse B thresholds", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.fuseB.thresholds.join()).eq([21, 22, 24, 23].join());
        });
      });
      describe("not stable pool, not swapped tokens", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function setInitialDepositorValuesTest(): Promise<ISetValuesResults> {
          const asset = ethers.Wallet.createRandom().address;
          return callSetInitialDepositorValues({
            isStablePool: false,
            pool: ethers.Wallet.createRandom().address,

            token0: asset,
            token1: ethers.Wallet.createRandom().address,

            tickSpacing: 1,
            lowerTick: 2,
            upperTick: 3,
            rebalanceTickRange: 4,

            asset,

            fuseThresholdsA: [11, 12, 14, 13], // (!) not used in NOT stable pool
            fuseThresholdsB: [21, 22, 24, 23] // (!) not used in NOT stable pool
          });
        }

        it("should return expected pool params", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.pool).eq(ret.init.pool);
          expect(ret.isStablePool).eq(false);
        });
        it("should return expected tokens", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.tokenA).eq(ret.init.token0);
          expect(ret.tokenB).eq(ret.init.token1);
          expect(ret.depositorSwapTokens).eq(false);
        });
        it("should return expected ticks", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.tickSpacing, ret.lowerTick, ret.upperTick, ret.rebalanceTickRange].join()).eq([1, 2, 3, 4].join());
        });
        it("should return expected zero params", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.totalLiquidity.toString(), ret.strategyProfitHolder.toString(), ret.withdrawDone.toString()].join()).eq(["0", Misc.ZERO_ADDRESS, "0"].join());
        });
        it("should return fuse status", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.fuseA.status, ret.fuseB.status].join()).eq([FUSE_DISABLED_0, FUSE_DISABLED_0].join());
        });
        it("should return fuse A thresholds", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.fuseA.thresholds.join()).eq([0, 0, 0, 0].join());
        });
        it("should return fuse B thresholds", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.fuseB.thresholds.join()).eq([0, 0, 0, 0].join());
        });

      });
      describe("swapped tokens", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function setInitialDepositorValuesTest(): Promise<ISetValuesResults> {
          const asset = ethers.Wallet.createRandom().address;
          return callSetInitialDepositorValues({
            isStablePool: true,
            pool: ethers.Wallet.createRandom().address,

            token0: ethers.Wallet.createRandom().address,
            token1: asset, // (!) asset is second token (swapped tokens)

            tickSpacing: 1,
            lowerTick: 2,
            upperTick: 3,
            rebalanceTickRange: 4,

            asset,

            fuseThresholdsA: [11, 12, 14, 13],
            fuseThresholdsB: [21, 22, 24, 23]
          });
        }

        it("should return expected pool params", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.pool).eq(ret.init.pool);
          expect(ret.isStablePool).eq(true);
        });
        it("should return expected tokens", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.tokenA).eq(ret.init.token1);
          expect(ret.tokenB).eq(ret.init.token0);
          expect(ret.depositorSwapTokens).eq(true);
        });
        it("should return expected ticks", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.tickSpacing, ret.lowerTick, ret.upperTick, ret.rebalanceTickRange].join()).eq([1, 2, 3, 4].join());
        });
        it("should return expected zero params", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.totalLiquidity.toString(), ret.strategyProfitHolder.toString(), ret.withdrawDone.toString()].join()).eq(["0", Misc.ZERO_ADDRESS, "0"].join());
        });
        it("should return fuse status", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect([ret.fuseA.status, ret.fuseB.status].join()).eq([FUSE_OFF_1, FUSE_OFF_1].join());
        });
        it("should return fuse A thresholds", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.fuseA.thresholds.join()).eq([11, 12, 14, 13].join());
        });
        it("should return fuse B thresholds", async () => {
          const ret = await loadFixture(setInitialDepositorValuesTest);
          expect(ret.fuseB.thresholds.join()).eq([21, 22, 24, 23].join());
        });
      });
    });

    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should revert if asset are different from both pool tokens", async () => {
        await expect(callSetInitialDepositorValues({
          isStablePool: true,
          pool: ethers.Wallet.createRandom().address,

          asset: ethers.Wallet.createRandom().address, // (!) asset != token1 and asset != token0
          token0: ethers.Wallet.createRandom().address,
          token1: ethers.Wallet.createRandom().address,

          tickSpacing: 1,
          lowerTick: 2,
          upperTick: 3,
          rebalanceTickRange: 4,

          fuseThresholdsA: [11, 12, 14, 13],
          fuseThresholdsB: [21, 22, 24, 23]
        })).revertedWith("PBS-5 Incorrect asset"); // INCORRECT_ASSET
      });
    });
  });

  describe("initWithdrawLocal", () => {
    interface IInitWithdrawLocalParams {
      tokens: MockToken[];
      asset: MockToken;
      liquidationThresholds: string[];
      planEntryData: string;

      dontSetSignerAsOperator?: boolean;
    }

    interface IInitWithdrawLocalResults {
      tokens: string[];
      controller: string;
      liquidationThresholds: number[];
      planKind: number;
      propNotUnderlying18: BigNumber;
    }

    async function callInitWithdrawLocal(p: IInitWithdrawLocalParams): Promise<IInitWithdrawLocalResults> {
      if (!p.dontSetSignerAsOperator) {
        await controller.setOperator(signer.address, true);
      }

      for (let i = 0; i < p.tokens.length; ++i) {
        await facade.setLiquidationThreshold(
          p.tokens[i].address,
          parseUnits(p.liquidationThresholds[i], await p.tokens[i].decimals())
        );
      }

      const ret = await facade.callStatic.initWithdrawLocal(
        [p.tokens[0].address, p.tokens[1].address],
        p.asset.address,
        p.planEntryData,
        controller.address
      );

      return {
        tokens: ret.tokens,
        controller: ret.controller,
        liquidationThresholds: await Promise.all(ret.liquidationThresholds.map(
          async (x, index) => +formatUnits(
            x,
            await IERC20Metadata__factory.connect(ret.tokens[index], signer).decimals()
          )
        )),
        planKind: ret.planKind.toNumber(),
        propNotUnderlying18: ret.propNotUnderlying18
      }
    }

    describe("Good paths", () => {
      describe("PLAN_SWAP_REPAY", () => {
        describe("Asset is token 0", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function initWithdrawLocalTest(): Promise<IInitWithdrawLocalResults> {
            const planEntryData = defaultAbiCoder.encode(
              ['uint256', 'uint256'],
              [PLAN_SWAP_REPAY, Misc.ONE18.div(10)]
            );
            return callInitWithdrawLocal({
              tokens: [usdc, weth],
              asset: usdc,
              liquidationThresholds: ["1", "2"],
              planEntryData,
            });
          }

          it("should return expected tokens", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect(ret.tokens.join()).eq([usdc.address, weth.address].join());
          });
          it("should return expected controller", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect(ret.controller).eq(controller.address);
          });
          it("should return expected liquidationThresholds", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect(ret.liquidationThresholds.join()).eq([1, 2].join());
          });
          it("should return expected plan and prop", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect([ret.planKind, ret.propNotUnderlying18].toString()).eq([PLAN_SWAP_REPAY, Misc.ONE18.div(10)].join());
          });
        });
        describe("Asset is token 1", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function initWithdrawLocalTest(): Promise<IInitWithdrawLocalResults> {
            const planEntryData = defaultAbiCoder.encode(
              ['uint256', 'uint256'],
              [PLAN_SWAP_REPAY, Misc.ONE18.div(10)]
            );
            return callInitWithdrawLocal({
              tokens: [usdc, weth],
              asset: weth,
              liquidationThresholds: ["1", "2"],
              planEntryData,
            });
          }

          it("should return expected tokens", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect(ret.tokens.join()).eq([weth.address, usdc.address].join());
          });
          it("should return expected controller", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect(ret.controller).eq(controller.address);
          });
          it("should return expected liquidationThresholds", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect(ret.liquidationThresholds.join()).eq([2, 1].join());
          });
          it("should return expected plan and prop", async () => {
            const ret = await loadFixture(initWithdrawLocalTest);
            expect([ret.planKind, ret.propNotUnderlying18].toString()).eq([PLAN_SWAP_REPAY, Misc.ONE18.div(10)].join());
          });
        });
      });
      describe("PLAN_REPAY_SWAP_REPAY", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        function initWithdrawLocalTest(): Promise<IInitWithdrawLocalResults> {
          const planEntryData = defaultAbiCoder.encode(['uint256'], [PLAN_REPAY_SWAP_REPAY]);
          return callInitWithdrawLocal({
            tokens: [usdc, weth],
            asset: weth,
            liquidationThresholds: ["1", "2"],
            planEntryData,
          });
        }

        it("should return expected tokens", async () => {
          const ret = await loadFixture(initWithdrawLocalTest);
          expect(ret.tokens.join()).eq([weth.address, usdc.address].join());
        });
        it("should return expected controller", async () => {
          const ret = await loadFixture(initWithdrawLocalTest);
          expect(ret.controller).eq(controller.address);
        });
        it("should return expected liquidationThresholds", async () => {
          const ret = await loadFixture(initWithdrawLocalTest);
          expect(ret.liquidationThresholds.join()).eq([2, 1].join());
        });
        it("should return expected plan and prop", async () => {
          const ret = await loadFixture(initWithdrawLocalTest);
          expect([ret.planKind, ret.propNotUnderlying18].toString()).eq([PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT].join());
        });
      });
    });
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should revert if not operator", async () => {
        await expect(callInitWithdrawLocal({
          tokens: [usdc, weth],
          asset: weth,
          liquidationThresholds: ["1", "2"],
          planEntryData: "0x",
          dontSetSignerAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    })
  });
//endregion Unit tests
});