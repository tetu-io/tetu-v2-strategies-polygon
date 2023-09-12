import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock,
  PairBasedStrategyLogicLibFacade, MockController, IERC20Metadata__factory, IPairBasedDefaultStateProvider
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
import {IBorrowParamsNum} from "../../../baseUT/mocks/TestDataTypes";
import {setupMockedBorrowEntryKind1} from "../../../baseUT/mocks/MockRepayUtils";
import {IDefaultState, PackedData} from "../../../baseUT/utils/PackedData";
import {
  FUSE_DISABLED_0,
  FUSE_OFF_1,
  FUSE_ON_LOWER_LIMIT_2,
  PLAN_REPAY_SWAP_REPAY,
  PLAN_SWAP_REPAY
} from "../../../baseUT/AppConstants";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';

describe('PairBasedStrategyLogicLibTest', () => {
//region Constants and variables
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
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
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
      [usdc.address, usdt.address, tetu.address, weth.address],
      [parseUnits("1", 18), parseUnits("1", 18), parseUnits("1", 18), parseUnits("1", 18)]
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
      /** Price of the token A in the pool, decimals 18. pricesAB[0] by default */
      poolPriceA?: string;
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
        0,
        0
      );
      const ret = await facade.needStrategyRebalance(
        converter.address,
        tick,
        parseUnits(p?.poolPriceA || p.pricesAB[0], 18)
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
        p.withdrawDone,
        0
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
      describe("PLAN_REPAY_SWAP_REPAY", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        function initWithdrawLocalTest(): Promise<IInitWithdrawLocalResults> {
          const planEntryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
          return callInitWithdrawLocal({
            tokens: [usdc, weth],
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
          liquidationThresholds: ["1", "2"],
          planEntryData: "0x",
          dontSetSignerAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    })
  });

  describe("_beforeDeposit", () => {
    interface IBeforeDepositParams {
      tokenA: MockToken;
      tokenB: MockToken;
      amountA: string;
      propNotUnderlying18: string;
      liquidationThresholdA: string;

      borrows?: IBorrowParamsNum[];
    }

    interface IBeforeDepositResults {
      tokenAmounts: number[];
    }

    async function callBeforeDeposit(p: IBeforeDepositParams): Promise<IBeforeDepositResults> {
      // prepare collateral on balance
      const decimalsA = await p.tokenA.decimals();
      await p.tokenA.mint(facade.address, parseUnits(p.amountA, decimalsA));

      // setup liquidation thresholds
      await facade.setLiquidationThreshold(p.tokenA.address, parseUnits(p.liquidationThresholdA, decimalsA));

      // setup borrows
      const prop0 = parseUnits((1 - +p.propNotUnderlying18).toString(), 18);
      const prop1 = parseUnits((+p.propNotUnderlying18).toString(), 18);
      const entryData1 = defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint256'],
        [1, prop0, prop1]
      );

      if (p.borrows) {
        for (const b of p.borrows) {
          await setupMockedBorrowEntryKind1(converter, facade.address, b, prop0, prop1);
          await b.collateralAsset.connect(await Misc.impersonate(facade.address)).approve(converter.address, Misc.MAX_UINT);
        }
      }

      const tokenAmounts = await facade.callStatic._beforeDeposit(
        converter.address,
        parseUnits(p.amountA, decimalsA),
        p.tokenA.address,
        p.tokenB.address,
        entryData1
      );

      return {
        tokenAmounts: [
          +formatUnits(tokenAmounts[0], decimalsA),
          +formatUnits(tokenAmounts[1], await p.tokenB.decimals())
        ]
      }
    }

    describe("Good paths", () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should return expected token amounts", async () => {
        const ret = await callBeforeDeposit({
          tokenA: weth,
          tokenB: tetu,
          amountA: "3000",
          borrows: [{
            collateralAsset: weth,
            borrowAsset: tetu,
            converter: converter.address,
            collateralAmount: "3000",
            maxTargetAmount: "2000",
            collateralAmountOut: "1800",
            borrowAmountOut: "1200",
          }],
          propNotUnderlying18: "0.5",
          liquidationThresholdA: "1"
        });

        expect(ret.tokenAmounts.join()).eq([1200, 1200].join());
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

      it("should return expected token amounts if amount is less than the threshold ", async () => {
        const ret = await callBeforeDeposit({
          tokenA: weth,
          tokenB: tetu,
          amountA: "3000",
          borrows: [{
            collateralAsset: weth,
            borrowAsset: tetu,
            converter: converter.address,
            collateralAmount: "3000",
            maxTargetAmount: "2000",
            collateralAmountOut: "1800",
            borrowAmountOut: "1200",
          }],
          propNotUnderlying18: "0.5",
          liquidationThresholdA: "3001"
        });

        expect(ret.tokenAmounts.join()).eq([3000, 0].join());
      });
    });
  });

  describe("getDefaultState", () => {
    interface IGetDefaultState {
      state: IDefaultState;
    }
    interface IGetDefaultStateResults {
      init: IDefaultState;
      state: IDefaultState;
    }
    async function callGetDefaultState(p: IGetDefaultState): Promise<IGetDefaultStateResults> {
      await facade.setPairState(
        [p.state.tokenA, p.state.tokenB],
        p.state.pool,
        p.state.isStablePool,
        [p.state.tickSpacing, p.state.lowerTick, p.state.upperTick, p.state.rebalanceTickRange],
        p.state.depositorSwapTokens,
        p.state.totalLiquidity,
        p.state.profitHolder,
        [
          {
            status: p.state.fuseStatusTokenA,
            thresholds: [
              parseUnits(p.state.fuseThresholdsA[0].toString(), 18),
              parseUnits(p.state.fuseThresholdsA[1].toString(), 18),
              parseUnits(p.state.fuseThresholdsA[2].toString(), 18),
              parseUnits(p.state.fuseThresholdsA[3].toString(), 18)
            ]
          },
          {
            status: p.state.fuseStatusTokenB,
            thresholds: [
              parseUnits(p.state.fuseThresholdsB[0].toString(), 18),
              parseUnits(p.state.fuseThresholdsB[1].toString(), 18),
              parseUnits(p.state.fuseThresholdsB[2].toString(), 18),
              parseUnits(p.state.fuseThresholdsB[3].toString(), 18)
            ]
          },
        ],
        p.state.withdrawDone,
        p.state.lastRebalanceNoSwap
      );

      const state = await PackedData.getDefaultState(facade as unknown as IPairBasedDefaultStateProvider);
      console.log(state);
      return {init: p.state, state};
    }

    describe("isStablePool true, depositorSwapTokens false", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function getDefaultStateTest(): Promise<IGetDefaultStateResults> {
        const asset = ethers.Wallet.createRandom().address;
        return callGetDefaultState({
          state: {
            tokenA: usdc.address,
            tokenB: usdt.address,
            pool: weth.address,
            profitHolder: tetu.address,

            tickSpacing: 1,
            lowerTick: 2,
            upperTick: 3,
            rebalanceTickRange: 4,

            totalLiquidity: Misc.ONE18,
            fuseStatusTokenA: 2,
            fuseStatusTokenB: 3,
            withdrawDone: 1000,

            fuseThresholdsA: [11, 12, 14, 13],
            fuseThresholdsB: [21, 22, 24, 23],

            isStablePool: true,
            depositorSwapTokens: false,

            lastRebalanceNoSwap: 0
          }
        });
      }

      it("should return expected pool params", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([ret.state.pool, ret.state.isStablePool].join()).eq([weth.address, true].join());
      });
      it("should return expected tokens", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([ret.state.tokenA, ret.state.tokenB].join()).eq([usdc.address, usdt.address].join());
        expect(ret.state.depositorSwapTokens).eq(false);
      });
      it("should return expected ticks", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([ret.state.tickSpacing, ret.state.lowerTick, ret.state.upperTick, ret.state.rebalanceTickRange].join()).eq([1, 2, 3, 4].join());
      });
      it("should return expected zero params", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([
          ret.state.totalLiquidity.toString(), ret.state.profitHolder.toString(), ret.state.withdrawDone.toString()
        ].join()).eq([
          Misc.ONE18, tetu.address, 1000
        ].join());
      });
      it("should return fuse status", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([ret.state.fuseStatusTokenA, ret.state.fuseStatusTokenB].join()).eq([2, 3].join());
      });
      it("should return fuse A thresholds", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect(ret.state.fuseThresholdsA.join()).eq([11, 12, 14, 13].join());
      });
      it("should return fuse B thresholds", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect(ret.state.fuseThresholdsB.join()).eq([21, 22, 24, 23].join());
      });
    });
    describe("isStablePool false, depositorSwapTokens true", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function getDefaultStateTest(): Promise<IGetDefaultStateResults> {
        const asset = ethers.Wallet.createRandom().address;
        return callGetDefaultState({
          state: {
            tokenA: usdc.address,
            tokenB: usdt.address,
            pool: weth.address,
            profitHolder: tetu.address,

            tickSpacing: 1,
            lowerTick: 2,
            upperTick: 3,
            rebalanceTickRange: 4,

            totalLiquidity: Misc.ONE18,
            fuseStatusTokenA: 2,
            fuseStatusTokenB: 3,
            withdrawDone: 1000,

            fuseThresholdsA: [11, 12, 14, 13],
            fuseThresholdsB: [21, 22, 24, 23],

            isStablePool: false,
            depositorSwapTokens: true,

            lastRebalanceNoSwap: 0
          }
        });
      }

      it("should return expected pool params", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([ret.state.pool, ret.state.isStablePool].join()).eq([weth.address, false].join());
      });
      it("should return expected tokens", async () => {
        const ret = await loadFixture(getDefaultStateTest);
        expect([ret.state.tokenA, ret.state.tokenB].join()).eq([usdc.address, usdt.address].join());
        expect(ret.state.depositorSwapTokens).eq(true);
      });
    });
  });

//endregion Unit tests
});
