import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {FacadeUniv3TokenSellerLib, MockUniswapV3Pool, UniswapV3LibFacade} from "../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {MockHelper} from "../baseUT/helpers/MockHelper";

describe('Univ3TokenSellerLibTest', () => {
  const DENOMINATOR_INT = "100000";

  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let facade: FacadeUniv3TokenSellerLib;
  let facadeUni: UniswapV3LibFacade;
  let mockedPool: MockUniswapV3Pool;

  before(async function () {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    facade = (await DeployerUtils.deployContract(signer, "FacadeUniv3TokenSellerLib")) as FacadeUniv3TokenSellerLib;
    facadeUni = (await DeployerUtils.deployContract(signer, "UniswapV3LibFacade")) as UniswapV3LibFacade;
    mockedPool = await MockHelper.createMockUniswapV3Pool(signer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  describe("Calculate tick range", () => {
    describe("calcTickRangeSymmetrically", () => {
      it("should return expected values if tick > 0, tickSpacing = 5", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(100, 20, 5);
        expect(lowerTick).eq(80);
        expect(upperTick).eq(120);
      });
      it("should return expected values if tick > 0, tickSpacing = 3", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(100, 20, 3);
        expect(lowerTick).eq(26 * 3); // 80 / 3 = 26...
        expect(upperTick).eq(26 * 3 + 20 * 2);
      });
      it("should return expected values if tick < 0, tickSpacing = 5", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(-100, 20, 5);
        expect(lowerTick).eq(-120);
        expect(upperTick).eq(-80);
      });
      it("should return expected values if tick < 0, tickSpacing = 3", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(-100, 20, 3);
        // const expectedLowerTick = ((- 100 - 20) / 3 - 1) * 3; // -123
        expect(lowerTick).eq(-123);
        expect(upperTick).eq(-123 + 20 * 2);
      });
    });
    describe("getNarrowTickRange", () => {
      describe("tickSpacing = 3", () => {
        describe("minTick is not used", () => {
          describe("tick != tickLower", () => {
            it("should return expected values if tick is negative", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(-10, 2, 3, -100);
              expect(lowerTick).eq(-9);
              expect(upperTick).eq(-3);
            });
            it("should return expected values if tick is positive", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(10, 2, 3, -100);
              expect(lowerTick).eq(12);
              expect(upperTick).eq(18);
            });
          });
          describe("tick == tickLower", () => {
            it("should return expected values if tick is negative", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(-9, 2, 3, -100);
              expect(lowerTick).eq(-9);
              expect(upperTick).eq(-3);
            });
            it("should return expected values if tick is positive", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(12, 2, 3, -100);
              expect(lowerTick).eq(12);
              expect(upperTick).eq(18);
            });
          });
        });
        describe("minTick is used", () => {
          describe("minTick is divisible on tickSpacing without remainder", () => {
            describe("tick != tickLower", () => {
              it("should return expected values if tick is negative, tick != tickLower", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(-10, 2, 3, -6);
                expect(lowerTick).eq(-6);
                expect(upperTick).eq(0);
              });
              it("should return expected values if tick is positive", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(10, 2, 3, 15);
                expect(lowerTick).eq(15);
                expect(upperTick).eq(21);
              });
            });
            describe("tick == tickLower", () => {
              it("should return expected values if tick is negative, tick != tickLower", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(-6, 2, 3, -6);
                expect(lowerTick).eq(-6);
                expect(upperTick).eq(0);
              });
              it("should return expected values if tick is positive", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(15, 2, 3, 15);
                expect(lowerTick).eq(15);
                expect(upperTick).eq(21);
              });
            });
          });
          describe("minTick is divisible on tickSpacing with remainder", () => {
            describe("tick != tickLower", () => {
              it("should return expected values if tick is negative", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(-10, 2, 3, -7);
                expect(lowerTick).eq(-6);
                expect(upperTick).eq(0);
              });
              it("should return expected values if tick is positive", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(10, 2, 3, 14);
                expect(lowerTick).eq(15);
                expect(upperTick).eq(21);
              });
            });
            describe("tick == tickLower", () => {
              it("should return expected values if tick is negative", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(-6, 2, 3, -7);
                expect(lowerTick).eq(-6);
                expect(upperTick).eq(0);
              });
              it("should return expected values if tick is positive", async () => {
                const {lowerTick, upperTick} = await facade.getNarrowTickRange(15, 2, 3, 14);
                expect(lowerTick).eq(15);
                expect(upperTick).eq(21);
              });
            });
          });
        });
      });
      describe("tickSpacing = 1", () => {
        describe("minTick is not used", () => {
          describe("tick != tickLower", () => {
            it("should return expected values if tick is negative", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(-10, 2, 1, -100);
              expect(lowerTick).eq(-10);
              expect(upperTick).eq(-8);
            });
            it("should return expected values if tick is positive", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(10, 2, 1, -100);
              expect(lowerTick).eq(10);
              expect(upperTick).eq(12);
            });
          });
          describe("tick == tickLower", () => {
            it("should return expected values if tick is negative", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(-9, 2, 1, -100);
              expect(lowerTick).eq(-9);
              expect(upperTick).eq(-7);
            });
            it("should return expected values if tick is positive", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(12, 2, 1, -100);
              expect(lowerTick).eq(12);
              expect(upperTick).eq(14);
            });
          });
        });
        describe("minTick is used", () => {
          describe("minTick is divisible on tickSpacing without remainder", () => {
            it("should return expected values if tick is negative, tick != tickLower", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(-10, 6, 1, -6);
              expect(lowerTick).eq(-6);
              expect(upperTick).eq(0);
            });
            it("should return expected values if tick is positive", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(10, 6, 1, 15);
              expect(lowerTick).eq(15);
              expect(upperTick).eq(21);
            });
          });
          describe("minTick is divisible on tickSpacing with remainder", () => {
            it("should return expected values if tick is negative", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(-10, 6, 1, -7);
              expect(lowerTick).eq(-7);
              expect(upperTick).eq(-1);
            });
            it("should return expected values if tick is positive", async () => {
              const {lowerTick, upperTick} = await facade.getNarrowTickRange(10, 6, 1, 14);
              expect(lowerTick).eq(14);
              expect(upperTick).eq(20);
            });
          });
        });
      });
    });
  });

  describe("Enter/exit logic", () => {
    describe("needToRefresh", () => {
      let snapshot1: string;
      before(async function () {
        snapshot1 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot1);
      });

      interface IParams {
        tickSpacing: number;
        state: {
          lowerTickDeltaFromTick: number;
          upperTickDeltaFromTick: number;
          lastRefreshPoolTimestampDelta?: number;
        }
        config?: {
          thresholdLastRefreshPoolSec?: number;
          thresholdTokenB?: string;
          thresholdRatio?: string;
        }
        pool: {
          amount0: string;
          amount1: string;
        }

        poolSwapTokens?: boolean;
        mainPoolSizeInTickSpacing?: number; // 100 by default
        decimalsB?: number; // 6 by default
        decimalsA?: number; // same by default to simplify numbers
      }
      interface IResults {
        gasUsed: number;
        needToRefresh: boolean;
      }
      async function makeTest(p: IParams): Promise<IResults> {
        const poolSwapTokens = p.poolSwapTokens ?? false;
        const decimalsA = p.decimalsA ?? 6;
        const decimalsB = p.decimalsB ?? 6;
// set up pool mock
        const mainPoolSizeInTickSpacing = p?.mainPoolSizeInTickSpacing ?? 100;
        const amount0 = parseUnits(p.pool.amount0, poolSwapTokens ? decimalsB: decimalsA);
        const amount1 = parseUnits(p.pool.amount1, poolSwapTokens ? decimalsA: decimalsB);

        // sqrt(price) = sqrt(reserves B / reserves A)
        const sqrtPriceX96 = amount1.div(amount0).mul(BigNumber.from(2).pow(96));
        // tick = log_{sqrt(1.0001)}(sqrt(price))
        const tick = await facadeUni._getTickAtSqrtRatio(sqrtPriceX96);
        // L = x * sqrt(P)
        const liquidity = await facadeUni.getLiquidityForAmounts(
          sqrtPriceX96,
          tick - mainPoolSizeInTickSpacing * p.tickSpacing,
          tick + mainPoolSizeInTickSpacing * p.tickSpacing,
          amount0,
          amount1
        );

        await mockedPool.setLiquidity(liquidity);
        await mockedPool.setSlot0(sqrtPriceX96, tick,
          // following values are not used here
          0, 0, 0, 0, false
        );

// set up facade
        await facade.setConfig({
          thresholdLastRefreshPoolSec: p.config?.thresholdLastRefreshPoolSec ?? 0,
          thresholdRatio: parseUnits(p.config?.thresholdRatio ?? "0", 5), // DENOMINATOR_INT
          thresholdTokenB: parseUnits(p.config?.thresholdTokenB ?? "0", decimalsB),
        // not used
          receiver: ethers.Wallet.createRandom().address,
          amountA: 0,
          minTick: 0,
          tickRangeSize: 0
        });

        await facade.setState({
          lowerTick: p.state.lowerTickDeltaFromTick + tick,
          upperTick: p.state.upperTickDeltaFromTick + tick,
          liquidityAmount: 0, // not used
          lastRefreshPoolTimestamp: p.state.lastRefreshPoolTimestampDelta
            ? (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + p.state.lastRefreshPoolTimestampDelta
            : 0,
        });

        const gasUsed = await facade.estimateGas.needToRefresh(mockedPool.address, p.tickSpacing, poolSwapTokens);
        const needToRefresh = await facade.needToRefresh(mockedPool.address, p.tickSpacing, poolSwapTokens);

        return {needToRefresh, gasUsed: gasUsed.toNumber()}
      }

      const NORMAL_CASE: IParams = {
        pool: {amount0: "1", amount1: "100"},
        tickSpacing: 1,
        state: {lowerTickDeltaFromTick: 1, upperTickDeltaFromTick: 5}
      }
      const NORMAL_CASE_5: IParams = {
        pool: {amount0: "1", amount1: "100"},
        tickSpacing: 5,
        state: {lowerTickDeltaFromTick: 5, upperTickDeltaFromTick: 25}
      }
      describe("poolSwapTokens is false", () => {
        describe("tick spacing = 1", () => {
          it("should return false in normal case (no changes)", async () => {
            const {needToRefresh} = await makeTest(NORMAL_CASE);
            expect(needToRefresh).eq(false);
          });
          it("should return true if tick moves to left on more than tickSpacing", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE,
              state: {lowerTickDeltaFromTick: 2, upperTickDeltaFromTick: 5}
            });
            expect(needToRefresh).eq(true);
          });
          it("should return false if tick moves to right but doesn't exceed ratio threshold", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE,
              config: {thresholdRatio: "0.5"}, // 50%
              state: {lowerTickDeltaFromTick: -4, upperTickDeltaFromTick: 4}
            });
            expect(needToRefresh).eq(false);
          });
          describe("tick moves to right and exceeds ratio threshold", () => {
            it("should return true if other thresholds are ok", async () => {
              const {needToRefresh} = await makeTest({
                ...NORMAL_CASE,
                config: {thresholdRatio: "0.5"}, // 50%
                state: {lowerTickDeltaFromTick: -5, upperTickDeltaFromTick: 4}
              });
              expect(needToRefresh).eq(true);
            });
            it("should return false if amountB is too low", async () => {
              const {needToRefresh} = await makeTest({
                ...NORMAL_CASE,
                config: {thresholdRatio: "0.5", thresholdTokenB: "10000"}, // 50%, thresholdTokenB is very high
                state: {lowerTickDeltaFromTick: -5, upperTickDeltaFromTick: 4}
              });
              expect(needToRefresh).eq(false);
            });
            describe("delay threshold is configured", () => {
              it("should return true if enough time has passed since last call of refreshPool", async () => {
                const {needToRefresh} = await makeTest({
                  ...NORMAL_CASE,
                  config: {thresholdRatio: "0.5", thresholdLastRefreshPoolSec: 1000}, // 50%
                  state: {lowerTickDeltaFromTick: -5, upperTickDeltaFromTick: 4, lastRefreshPoolTimestampDelta: -1001},
                });
                expect(needToRefresh).eq(true);
              });
              it("should return false if not enough time has passed since last call of refreshPool", async () => {
                const {needToRefresh} = await makeTest({
                  ...NORMAL_CASE,
                  config: {thresholdRatio: "0.5", thresholdLastRefreshPoolSec: 1500}, // 50%
                  state: {lowerTickDeltaFromTick: -5, upperTickDeltaFromTick: 4, lastRefreshPoolTimestampDelta: -1000},
                });
                expect(needToRefresh).eq(false);
              });
            });
          });
        });
        describe("tick spacing = 5", () => {
          it("should return false in normal case (no changes)", async () => {
            const {needToRefresh} = await makeTest(NORMAL_CASE_5);
            expect(needToRefresh).eq(false);
          });
          it("should return true if tick moves to left on more than tickSpacing", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE_5,
              state: {lowerTickDeltaFromTick: 5+1, upperTickDeltaFromTick: 25}
            });
            expect(needToRefresh).eq(true);
          });
          it("should return false if tick moves to right but doesn't exceed ratio threshold", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE,
              config: {thresholdRatio: "0.5"}, // 50%
              state: {lowerTickDeltaFromTick: -4*5, upperTickDeltaFromTick: 4*5}
            });
            expect(needToRefresh).eq(false);
          });
          it("should return true if tick moves to right and exceeds ratio threshold", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE,
              config: {thresholdRatio: "0.5"}, // 50%
              state: {lowerTickDeltaFromTick: -4*5 - 1, upperTickDeltaFromTick: 4*5}
            });
            expect(needToRefresh).eq(true);
          });
        });
      });
      describe("poolSwapTokens", () => {
        describe("poolSwapTokens is true", () => {
          it("should return false if amountB is too low", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE,
              poolSwapTokens: true,
              config: {thresholdRatio: "0.5", thresholdTokenB: "1"}, // 50%
              state: {lowerTickDeltaFromTick: -5, upperTickDeltaFromTick: 4},
            });
            // v.amount0 401, v.amount1 5020275, amountB 401, config.thresholdTokenB 1000000
            expect(needToRefresh).eq(false);
          });
        });
        describe("poolSwapTokens is false", () => {
          it("should return false if amountB is too low", async () => {
            const {needToRefresh} = await makeTest({
              ...NORMAL_CASE,
              poolSwapTokens: false,
              config: {thresholdRatio: "0.5", thresholdTokenB: "1"}, // 50%
              state: {lowerTickDeltaFromTick: -5, upperTickDeltaFromTick: 4},
            });
            // v.amount0 401, v.amount1 5020275, amountB 5020275, config.thresholdTokenB 1000000
            expect(needToRefresh).eq(true);
          });
        });
      });
    });

    describe("enter", () => {

    });
  });
});