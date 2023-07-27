import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock,
  PairBasedStrategyLogicLibFacade
} from "../../../../typechain";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";

describe('PairBasedStrategyLogicLibTest', () => {
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;

  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;
  //region Variables
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
  //endregion Variables

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

    converter = await MockHelper.createMockTetuConverter(signer);
    priceOracleMock = await MockHelper.createPriceOracle(
      signer,
      [usdc.address, usdt.address, tetu.address],
      [parseUnits("1", 18), parseUnits("1", 18), parseUnits("1", 18)]
    );
    const controller = await MockHelper.createMockTetuConverterController(signer, priceOracleMock.address);
    await converter.setController(controller.address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  describe("needStrategyRebalance", () => {
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
        ]
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
//endregion Unit tests
});