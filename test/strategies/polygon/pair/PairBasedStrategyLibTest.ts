import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {IBorrowParamsNum, ILiquidationParams, IQuoteRepayParams, IRepayParams} from "../../../baseUT/mocks/TestDataTypes";
import {
  setupMockedQuoteRepay,
  setupMockedBorrowEntryKind1,
  setupMockedRepay
} from "../../../baseUT/mocks/MockRepayUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {MockForwarder, IERC20Metadata__factory, MockTetuConverter, MockTetuLiquidatorSingleCall, MockToken, PriceOracleMock, PairBasedStrategyLibFacade} from "../../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {setupIsConversionValid, setupMockedLiquidation} from "../../../baseUT/mocks/MockLiquidationUtils";
import {BigNumber} from "ethers";
import {
  FUSE_DISABLED_0,
  FUSE_OFF_1,
  FUSE_ON_LOWER_LIMIT_2,
  FUSE_ON_UPPER_LIMIT_3,
  PLAN_REPAY_SWAP_REPAY, PLAN_SWAP_ONLY,
  PLAN_SWAP_REPAY
} from "../../../baseUT/AppConstants";
import {HARDHAT_NETWORK_ID, HardhatUtils} from '../../../baseUT/utils/HardhatUtils';

describe('PairBasedStrategyLibTest', () => {
  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let liquidator: MockTetuLiquidatorSingleCall;
  let facade: PairBasedStrategyLibFacade;
  let converter: MockTetuConverter;
  let priceOracleMock: PriceOracleMock;
  //endregion Variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    [signer] = await ethers.getSigners();

    snapshotBefore = await TimeUtils.snapshot();
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);

    liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
    facade = await MockHelper.createPairBasedStrategyLibFacade(signer);
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
  describe("quoteWithdrawStep", () => {
    interface IQuoteWithdrawStepParams {
      /** This is underlying always */
      tokenX: MockToken;
      tokenY: MockToken;
      planKind: number;

      liquidationThresholds: string[];
      propNotUnderlying18?: string;

      balanceX: string;
      balanceY: string;
      prices?: {
        priceX: string;
        priceY: string;
      }
      repays?: IRepayParams[];
      quoteRepays?: IQuoteRepayParams[];
      balanceAdditions?: string[];
    }

    interface IQouteWithdrawStepResults {
      tokenToSwap: string;
      amountToSwap: number;
    }

    async function makeQuoteWithdrawStep(p: IQuoteWithdrawStepParams): Promise<IQouteWithdrawStepResults> {
      // set up current balances
      await p.tokenX.mint(
        facade.address,
        parseUnits(p.balanceX, await p.tokenX.decimals())
      );
      await p.tokenY.mint(
        facade.address,
        parseUnits(p.balanceY, await p.tokenY.decimals())
      );

      // set prices (1 by default)
      if (p.prices) {
        await priceOracleMock.changePrices(
          [p.tokenX.address, p.tokenY.address],
          [parseUnits(p.prices.priceX, 18), parseUnits(p.prices.priceY, 18)]
        );
      }

      // setup repays
      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, facade.address, r);
        }
      }
      if (p.quoteRepays) {
        for (const q of p.quoteRepays) {
          await setupMockedQuoteRepay(converter, facade.address, q);
        }
      }

      // call quote
      const ret = await facade.callStatic.quoteWithdrawStep(
        [converter.address, liquidator.address],
        [p.tokenX.address, p.tokenY.address],
        [
          parseUnits(p.liquidationThresholds[0], await p.tokenX.decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokenX.decimals())
        ],
        [
          p.balanceAdditions ? parseUnits(p.balanceAdditions[0], await p.tokenX.decimals()) : 0,
          p.balanceAdditions ? parseUnits(p.balanceAdditions[1], await p.tokenX.decimals()) : 0
        ],
        p.planKind,
        parseUnits(p.propNotUnderlying18 || "0", 18),
      );

      return {
        amountToSwap: ret.tokenToSwap === Misc.ZERO_ADDRESS
          ? 0
          : +formatUnits(ret.amountToSwap, await IERC20Metadata__factory.connect(ret.tokenToSwap, signer).decimals()),
        tokenToSwap: ret.tokenToSwap
      }
    }

    describe("PLAN_SWAP_REPAY", () => {
      describe("Zero balanceAdditions", () => {
        describe("Default liquidationThresholds, all required amounts are higher then thresholds", () => {
          describe("Swap is not required", () => {
            describe("Direct repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "0",
                  balanceY: "1000",

                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return zero tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
              });

              it("should return zero amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(0);
              });
            });
            describe("Reverse repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "1000",
                  balanceY: "0",

                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return zero tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
              });

              it("should return zero amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(0);
              });
            });
            describe("No debts", () => {
              describe("Zero balances", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "0",
                    balanceY: "0",

                    repays: []
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Assets are allocated in required proportion 1:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "1000",
                    balanceY: "1000",

                    repays: [],
                    propNotUnderlying18: "0.5",
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Assets are allocated in required proportion 0:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "0",
                    balanceY: "1000",

                    repays: [],
                    propNotUnderlying18: "1",
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Assets are allocated in required proportion 1:0", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "1000",
                    balanceY: "0",

                    repays: [],
                    propNotUnderlying18: "0",
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
            });
          });
          describe("Swap is required", () => {
            describe("Direct repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "500",
                  balanceY: "500",

                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return expected tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(usdc.address);
              });

              it("should return expected amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(500);
              });
            });
            describe("Reverse repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "500",
                  balanceY: "500",

                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return expected tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(usdt.address);
              });

              it("should return expected amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(500);
              });
            });
            describe("No debts (swap letfovers)", () => {
              describe("Proportions 1e18:0", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: []
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdt.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(900);
                });
              });
              describe("Proportions 0:1e18", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: [],
                    propNotUnderlying18: "1"
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdc.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(500);
                });
              });
              describe("Proportions 1:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: [],
                    propNotUnderlying18: "0.5"
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdt.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(200);
                });
              });
            });
          });
        });
        describe("Custom liquidationThresholds, all required amounts are higher then thresholds", () => {
          describe("Swap is required", () => {
            describe("Direct repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["599", "0"],
                  balanceX: "600",
                  balanceY: "700",

                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalCollateralAmountOut: "5000",
                    totalDebtAmountOut: "3000",
                  }]
                });
              }

              it("should return expected tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(usdc.address);
              });

              it("should return expected amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(600);
              });
            });
            describe("Reverse repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "699"],
                  balanceX: "600",
                  balanceY: "700",

                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    totalCollateralAmountOut: "5000",
                    totalDebtAmountOut: "3000",
                  }]
                });
              }

              it("should return expected tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(usdt.address);
              });

              it("should return expected amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(700);
              });
            });
            describe("No debts (swap letfovers)", () => {
              describe("Proportions 1e18:0", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "899"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: []
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdt.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(900);
                });
              });
              describe("Proportions 0:1e18", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["499", "0"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: [],
                    propNotUnderlying18: "1"
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdc.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(500);
                });
              });
              describe("Proportions 1:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "199"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: [],
                    propNotUnderlying18: "0.5"
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdt.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(200);
                });
              });
            });
          });
        });
        describe("Custom liquidationThresholds, all required amounts are lower then thresholds", () => {
          describe("Swap is required", () => {
            describe("Direct repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["601", "0"],
                  balanceX: "600",
                  balanceY: "700",

                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return zero tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
              });

              it("should return zero amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(0);
              });
            });
            describe("Reverse repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "701"],
                  balanceX: "600",
                  balanceY: "700",

                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return zero tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
              });

              it("should return zero amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(0);
              });
            });
            describe("No debts (swap letfovers)", () => {
              describe("Proportions 1e18:0", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "901"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: []
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Proportions 0:1e18", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["501", "0"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: [],
                    propNotUnderlying18: "1"
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Proportions 1:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "201"],
                    balanceX: "500",
                    balanceY: "900",

                    repays: [],
                    propNotUnderlying18: "0.5"
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
            });
          });
        });
      });
      describe("Not zero balanceAdditions", () => {
        describe("Default liquidationThresholds, all required amounts are higher then thresholds", () => {
          describe("Swap is not required", () => {
            describe("Direct repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "0",
                  balanceY: "700",

                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }],

                  balanceAdditions: ["0", "300"]
                });
              }

              it("should return zero tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
              });

              it("should return zero amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(0);
              });
            });
            describe("Reverse repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "700",
                  balanceY: "0",

                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }],

                  balanceAdditions: ["300", "0"]
                });
              }

              it("should return zero tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
              });

              it("should return zero amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(0);
              });
            });
            describe("No debts", () => {
              describe("Assets are allocated in required proportion 1:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "600",
                    balanceY: "800",

                    repays: [],
                    propNotUnderlying18: "0.5",
                    balanceAdditions: ["400", "200"]
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Assets are allocated in required proportion 0:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "0",
                    balanceY: "0",

                    repays: [],
                    propNotUnderlying18: "1",

                    balanceAdditions: ["0", "1000"]
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
              describe("Assets are allocated in required proportion 1:0", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "300",
                    balanceY: "0",

                    repays: [],
                    propNotUnderlying18: "0",

                    balanceAdditions: ["700", "0"]
                  });
                }

                it("should return zero tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(Misc.ZERO_ADDRESS);
                });

                it("should return zero amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(0);
                });
              });
            });
          });
          describe("Swap is required", () => {
            describe("Direct repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "300",
                  balanceY: "250",

                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }],

                  balanceAdditions: ["200", "250"]
                });
              }

              it("should return expected tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(usdc.address);
              });

              it("should return expected amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(500);
              });
            });
            describe("Reverse repay", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                return makeQuoteWithdrawStep({
                  planKind: PLAN_SWAP_REPAY,

                  tokenX: usdc,
                  tokenY: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "500",
                  balanceY: "500",

                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    totalCollateralAmountOut: "2000",
                    totalDebtAmountOut: "1000",
                  }]
                });
              }

              it("should return expected tokenToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.tokenToSwap).eq(usdt.address);
              });

              it("should return expected amountToSwap", async () => {
                const ret = await loadFixture(makeQuoteWithdrawStepTest);
                expect(ret.amountToSwap).eq(500);
              });
            });
            describe("No debts (swap letfovers)", () => {
              describe("Proportions 1e18:0", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "400",
                    balanceY: "750",

                    repays: [],

                    balanceAdditions: ["100", "150"]
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdt.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(900);
                });
              });
              describe("Proportions 0:1e18", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "100",
                    balanceY: "100",

                    repays: [],
                    propNotUnderlying18: "1",

                    balanceAdditions: ["400", "800"]
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdc.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(500);
                });
              });
              describe("Proportions 1:1", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
                  return makeQuoteWithdrawStep({
                    planKind: PLAN_SWAP_REPAY,

                    tokenX: usdc,
                    tokenY: usdt,

                    liquidationThresholds: ["0", "0"],
                    balanceX: "100",
                    balanceY: "100",

                    repays: [],
                    propNotUnderlying18: "0.5",

                    balanceAdditions: ["400", "800"]
                  });
                }

                it("should return expected tokenToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.tokenToSwap).eq(usdt.address);
                });

                it("should return expected amountToSwap", async () => {
                  const ret = await loadFixture(makeQuoteWithdrawStepTest);
                  expect(ret.amountToSwap).eq(200);
                });
              });
            });
          });
        });
      });
    });

    describe("PLAN_REPAY_SWAP_REPAY", () => {
      describe("Default liquidationThresholds, all required amounts are higher then thresholds", () => {
        describe("Direct repay", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
            return makeQuoteWithdrawStep({
              planKind: PLAN_REPAY_SWAP_REPAY,

              tokenX: usdc,
              tokenY: usdt,

              propNotUnderlying18: "0",

              liquidationThresholds: ["0", "0"],
              balanceX: "100",
              balanceY: "200",

              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "20000",
                totalDebtAmountOut: "10000",
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                collateralAmountOut: "1400",
                amountRepay: "700",
              }],

              balanceAdditions: ["200", "500"]
            });
          }

          it("should return expected tokenToSwap", async () => {
            const ret = await loadFixture(makeQuoteWithdrawStepTest);
            expect(ret.tokenToSwap).eq(usdc.address);
          });

          it("should return expected amountToSwap", async () => {
            const ret = await loadFixture(makeQuoteWithdrawStepTest);
            expect(ret.amountToSwap).eq(1700); // 1400 + 200 + 100
          });
        });
        describe("Reverse repay", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
            return makeQuoteWithdrawStep({
              planKind: PLAN_REPAY_SWAP_REPAY,

              tokenX: usdc,
              tokenY: usdt,

              liquidationThresholds: ["0", "0"],
              balanceX: "100",
              balanceY: "300",

              repays: [{
                collateralAsset: usdt,
                borrowAsset: usdc,
                totalCollateralAmountOut: "20000",
                totalDebtAmountOut: "10000",
              }],
              quoteRepays: [{
                collateralAsset: usdt,
                borrowAsset: usdc,
                collateralAmountOut: "600",
                amountRepay: "300",
              }],
              balanceAdditions: ["200", "500"]
            });
          }

          it("should return expected tokenToSwap", async () => {
            const ret = await loadFixture(makeQuoteWithdrawStepTest);
            expect(ret.tokenToSwap).eq(usdt.address);
          });

          it("should return expected amountToSwap", async () => {
            const ret = await loadFixture(makeQuoteWithdrawStepTest);
            expect(ret.amountToSwap).eq(1400);
          });
        });
        describe("No debts (swap letfovers)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
            return makeQuoteWithdrawStep({
              planKind: PLAN_REPAY_SWAP_REPAY,

              tokenX: usdc,
              tokenY: usdt,

              liquidationThresholds: ["0", "0"],
              balanceX: "100",
              balanceY: "100",

              repays: [],
              propNotUnderlying18: "0.5",

              balanceAdditions: ["400", "800"]
            });
          }

          it("should return expected tokenToSwap", async () => {
            const ret = await loadFixture(makeQuoteWithdrawStepTest);
            expect(ret.tokenToSwap).eq(usdt.address);
          });

          it("should return expected amountToSwap", async () => {
            const ret = await loadFixture(makeQuoteWithdrawStepTest);
            expect(ret.amountToSwap).eq(200);
          });
        });
      });
    });

    describe("PLAN_SWAP_ONLY", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeQuoteWithdrawStepTest(): Promise<IQouteWithdrawStepResults> {
        return makeQuoteWithdrawStep({
          planKind: PLAN_SWAP_ONLY,

          tokenX: usdc,
          tokenY: usdt,

          liquidationThresholds: ["0", "0"],
          balanceX: "100",
          balanceY: "100",

          propNotUnderlying18: "0.5",

          balanceAdditions: ["400", "800"],

          repays: [{
            collateralAsset: usdc,
            borrowAsset: usdt,
            totalCollateralAmountOut: "20000",
            totalDebtAmountOut: "10000",
          }],
          quoteRepays: [{
            collateralAsset: usdc,
            borrowAsset: usdt,
            collateralAmountOut: "1400",
            amountRepay: "700",
          }],
        });
      }

      it("should return expected tokenToSwap", async () => {
        const ret = await loadFixture(makeQuoteWithdrawStepTest);
        expect(ret.tokenToSwap).eq(usdt.address);
      });

      it("should return expected amountToSwap", async () => {
        const ret = await loadFixture(makeQuoteWithdrawStepTest);
        expect(ret.amountToSwap).eq(200);
      });
    });
  });

  describe("withdrawStep", () => {
    interface IWithdrawStepParams {
      /** This is underlying always */
      tokenX: MockToken;
      tokenY: MockToken;

      tokenToSwap?: MockToken;
      amountToSwap: string;

      liquidationThresholds: string[];
      /** Array means type(uint).max, undefined value means 0 */
      propNotUnderlying18?: string | string[];

      planKind: number;

      balanceX: string;
      balanceY: string;
      prices?: {
        priceX: string;
        priceY: string;
      }

      liquidations?: ILiquidationParams[];
      repays?: IRepayParams[];
      quoteRepays?: IQuoteRepayParams[];
      borrows?: IBorrowParamsNum[];

      /**
       * It's used only if propNotUnderlying18 is array.
       * This value is used to detect what amount should be returned by getPropNotUnderlying18.
       * If balance of main asset is equal to the given value, it should return SECOND value of the array.
       * Default value is zero.
       */
      assetBalanceToSwitch?: string;
    }

    interface IWithdrawStepResults {
      completed: boolean;
      balanceX: number;
      balanceY: number;
    }

    async function makeWithdrawStep(p: IWithdrawStepParams): Promise<IWithdrawStepResults> {
      // set up current balances
      await p.tokenX.mint(
        facade.address,
        parseUnits(p.balanceX, await p.tokenX.decimals())
      );
      await p.tokenY.mint(
        facade.address,
        parseUnits(p.balanceY, await p.tokenY.decimals())
      );

      // set prices (1 by default)
      if (p.prices) {
        await priceOracleMock.changePrices(
          [p.tokenX.address, p.tokenY.address],
          [parseUnits(p.prices.priceX, 18), parseUnits(p.prices.priceY, 18)]
        );
      }

      // set up liquidations
      if (p.liquidations) {
        for (const liquidation of p.liquidations) {
          await setupMockedLiquidation(liquidator, liquidation);
          await setupIsConversionValid(converter, liquidation, true);
        }
      }

      // setup repays
      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, facade.address, r);
        }
      }
      if (p.quoteRepays) {
        for (const q of p.quoteRepays) {
          await setupMockedQuoteRepay(converter, facade.address, q);
        }
      }

      // setup IPoolProportionsProvider
      if (Array.isArray(p.propNotUnderlying18)) {
        await facade.setPropNotUnderlying18(
          p.propNotUnderlying18.map(x => parseUnits(x, 18)),
          usdc.address,
          p.assetBalanceToSwitch
            ? parseUnits(p.assetBalanceToSwitch, 6)
            : 0
        );
        // setup borrows
        if (p.borrows) {
          for (const b of p.borrows) {
            const p0 = p.propNotUnderlying18[1] === "0.90"
              ? "0.1"
              : (1 - +p.propNotUnderlying18[1]).toString();
            const p1 = p.propNotUnderlying18[1] === "0.90"
              ? "0.9"
              : (+p.propNotUnderlying18[1]).toString();
            const prop0 = b.collateralAsset.address === p.tokenX.address
              ? parseUnits(p0, 18)
              : parseUnits(p1, 18);
            const prop1 = b.collateralAsset.address === p.tokenX.address
              ? parseUnits(p1, 18)
              : parseUnits(p0, 18);
            await setupMockedBorrowEntryKind1(converter, facade.address, b, prop0, prop1);
          }
        }
      }

      // make withdraw
      const completed = await facade.callStatic.withdrawStep(
        [converter.address, liquidator.address],
        [p.tokenX.address, p.tokenY.address],
        [
          parseUnits(p.liquidationThresholds[0], await p.tokenX.decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokenX.decimals())
        ],
        p.tokenToSwap?.address || Misc.ZERO_ADDRESS,
        p.tokenToSwap === undefined
          ? BigNumber.from(0)
          : parseUnits(p.amountToSwap, await IERC20Metadata__factory.connect(p.tokenToSwap.address, signer).decimals()),
        Misc.ZERO_ADDRESS,
        "0x",
        true,
        p.planKind,
        Array.isArray(p.propNotUnderlying18)
          ? Misc.MAX_UINT
          : parseUnits(p.propNotUnderlying18 || "0", 18)
      );

      await facade.withdrawStep(
        [converter.address, liquidator.address],
        [p.tokenX.address, p.tokenY.address],
        [
          parseUnits(p.liquidationThresholds[0], await p.tokenX.decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokenX.decimals())
        ],
        p.tokenToSwap?.address || Misc.ZERO_ADDRESS,
        p.tokenToSwap === undefined
          ? BigNumber.from(0)
          : parseUnits(p.amountToSwap, await IERC20Metadata__factory.connect(p.tokenToSwap.address, signer).decimals()),
        Misc.ZERO_ADDRESS,
        "0x",
        true,
        p.planKind,
        Array.isArray(p.propNotUnderlying18)
          ? Misc.MAX_UINT
          : parseUnits(p.propNotUnderlying18 || "0", 18)
      );

      return {
        completed,
        balanceX: +formatUnits(await p.tokenX.balanceOf(facade.address), await p.tokenX.decimals()),
        balanceY: +formatUnits(await p.tokenY.balanceOf(facade.address), await p.tokenY.decimals()),
      }
    }

    describe("PLAN_SWAP_REPAY", () => {
      describe("Default liquidationThresholds, all required amounts are higher then thresholds", () => {
        describe("Swap is not required", () => {
          describe("No debts", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "0",
                planKind: PLAN_SWAP_REPAY,

                liquidationThresholds: ["0", "0"],
                balanceX: "1000",
                balanceY: "0",

                repays: [],

              });
            }

            it("should complete the withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(true);
            });

            it("should not change balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([1000, 0].join());
            });
          });
          describe("Direct repay", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "0",
                planKind: PLAN_SWAP_REPAY,

                liquidationThresholds: ["0", "0"],
                balanceX: "0",
                balanceY: "1000",

                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalCollateralAmountOut: "2000",
                  totalDebtAmountOut: "1000",
                }],

              });
            }

            it("should not complete withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(false);
            });

            it("should set expected balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([2000, 0].join());
            });
          });
          describe("Reverse repay", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "0",
                planKind: PLAN_SWAP_REPAY,

                liquidationThresholds: ["0", "0"],
                balanceX: "1000",
                balanceY: "0",

                repays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  totalCollateralAmountOut: "2000",
                  totalDebtAmountOut: "1000",
                }],
              });
            }

            it("should not complete withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(false);
            });

            it("should set expected balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([0, 2000].join());
            });
          });
        });
        describe("Swap is required", () => {
          describe("Direct repay", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "500",
                tokenToSwap: usdc,
                planKind: PLAN_SWAP_REPAY,

                liquidationThresholds: ["0", "0"],
                balanceX: "500",
                balanceY: "500",

                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalCollateralAmountOut: "2000",
                  totalDebtAmountOut: "1000",
                }],
                liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "500", amountOut: "501"}]
              });
            }

            it("should not complete the withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(false);
            });

            it("should set expected balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([2000, 1].join());
            });
          });
          describe("Reverse repay", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "500",
                tokenToSwap: usdt,
                planKind: PLAN_SWAP_REPAY,

                liquidationThresholds: ["0", "0"],
                balanceX: "500",
                balanceY: "500",

                repays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  totalCollateralAmountOut: "2000",
                  totalDebtAmountOut: "1000",
                }],

                liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "500", amountOut: "501"}]
              });
            }

            it("should not complete the withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(false);
            });

            it("should set expected balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([1, 2000].join());
            });
          });
          describe("No debts (swap letfovers)", () => {
            describe("Swap part of usdt", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
                return makeWithdrawStep({
                  tokenX: usdc,
                  tokenY: usdt,

                  amountToSwap: "200",
                  tokenToSwap: usdt,
                  planKind: PLAN_SWAP_REPAY,

                  liquidationThresholds: ["10", "10"],
                  balanceX: "500",
                  balanceY: "900",

                  liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "200", amountOut: "201"}],

                  propNotUnderlying18: "0.5"
                });
              }

              it("should complete the withdraw", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                expect(ret.completed).eq(true);
              });

              it("should set expected balances", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                expect([ret.balanceX, ret.balanceY].join()).eq([701, 700].join());
              });
            });
            describe("Swap all usdt", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
                return makeWithdrawStep({
                  tokenX: usdc,
                  tokenY: usdt,
                  planKind: PLAN_SWAP_REPAY,

                  amountToSwap: "900",
                  tokenToSwap: usdt,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "500",
                  balanceY: "900",

                  liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "900", amountOut: "901"}],

                  propNotUnderlying18: "0"
                });
              }

              it("should complete the withdraw", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                expect(ret.completed).eq(true);
              });

              it("should set expected balances", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                expect([ret.balanceX, ret.balanceY].join()).eq([1401, 0].join());
              });
            });
            describe("Swap all usdc", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
                return makeWithdrawStep({
                  tokenX: usdc,
                  tokenY: usdt,
                  planKind: PLAN_SWAP_REPAY,

                  amountToSwap: "500",
                  tokenToSwap: usdc,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "500",
                  balanceY: "900",

                  liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "500", amountOut: "501"}],
                  propNotUnderlying18: "1"
                });
              }

              it("should complete the withdraw", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                expect(ret.completed).eq(true);
              });

              it("should set expected balances", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                expect([ret.balanceX, ret.balanceY].join()).eq([0, 1401].join());
              });
            });
          });
        });
      });
      describe("Read proportions from the pool", () => {
        describe("No debts", () => {
          describe("Swap changes proportions significantly", () => {
            describe("should make borrow after swap", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
                return makeWithdrawStep({
                  tokenX: usdc,
                  tokenY: usdt,

                  amountToSwap: "100",
                  tokenToSwap: usdc,
                  planKind: PLAN_SWAP_REPAY,

                  liquidationThresholds: ["0", "0"],
                  balanceX: "1000",
                  balanceY: "0",

                  repays: [],
                  propNotUnderlying18: ["0.10", "0.90"],

                  liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "100", amountOut: "100"}],

                  // untouchedAmountA = 100 / 0.9 * 0.1, amountIn = 900 - untouchedAmountA = 888.888889
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    converter: converter.address,
                    collateralAmount: "888.888889",
                    maxTargetAmount: "444.444445",
                    // 888888889-842105263 = 46783626
                    // 46783626 / 421052632 ~ 0.1111111116
                    collateralAmountOut: "842.105263",
                    borrowAmountOut: "421.052632",
                  }],

                  assetBalanceToSwitch: "900"
                });
              }

              it("should complete the withdraw", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                console.log("ret", ret);
                expect(ret.completed).eq(true);
              });

              it("should set balances to right proportions", async () => {
                const ret = await loadFixture(makeWithdrawStepTest);
                console.log("ret", ret);
                expect(ret.balanceX / ret.balanceY).approximately(10 / 90, 1e-6);
              });
            });
          });
        });
      })
    });

    describe("PLAN_REPAY_SWAP_REPAY", () => {
      describe("Custom value of propNotUnderlying18", () => {
        describe("full swap, 100% underlying", () => {
          describe("Direct repay", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "1501",
                tokenToSwap: usdc,

                planKind: PLAN_REPAY_SWAP_REPAY,
                propNotUnderlying18: "0",

                liquidationThresholds: ["0", "0"],
                balanceX: "500",
                balanceY: "500",

                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalCollateralAmountOut: "20000",
                  totalDebtAmountOut: "10000",
                  collateralAmountOut: "1001",
                  amountRepay: "500",
                }, {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalCollateralAmountOut: "20000",
                  totalDebtAmountOut: "10000",
                  collateralAmountOut: "3004",
                  amountRepay: "1502",
                  addToQueue: true
                }],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  amountRepay: "500",
                  collateralAmountOut: "1001"
                }],
                liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "1501", amountOut: "1502"}]
              });
            }

            it("should not complete the withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(false);
            });

            it("should set expected balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([3004, 0].join());
            });
          });
          describe("Reverse repay", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
              return makeWithdrawStep({
                tokenX: usdc,
                tokenY: usdt,

                amountToSwap: "1501",
                tokenToSwap: usdt,
                planKind: PLAN_REPAY_SWAP_REPAY,

                liquidationThresholds: ["0", "0"],
                balanceX: "500",
                balanceY: "500",

                repays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  totalCollateralAmountOut: "20000",
                  totalDebtAmountOut: "10000",
                  collateralAmountOut: "1001",
                  amountRepay: "500",
                }, {
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  totalCollateralAmountOut: "20000",
                  totalDebtAmountOut: "10000",
                  collateralAmountOut: "3004",
                  amountRepay: "1502",
                  addToQueue: true
                }],
                quoteRepays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  amountRepay: "500",
                  collateralAmountOut: "1001"
                }],
                liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "1501", amountOut: "1502"}]
              });
            }

            it("should not complete the withdraw", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect(ret.completed).eq(false);
            });

            it("should set expected balances", async () => {
              const ret = await loadFixture(makeWithdrawStepTest);
              expect([ret.balanceX, ret.balanceY].join()).eq([1502, 0].join());
            });
          });
        });
        describe("partial swap, 20% underlying", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
            // 20230706.2.calc.xlsx
            return makeWithdrawStep({
              tokenX: usdc,
              tokenY: usdt,

              amountToSwap: "1040",
              tokenToSwap: usdc,

              planKind: PLAN_REPAY_SWAP_REPAY,
              propNotUnderlying18: "0.8",

              liquidationThresholds: ["0", "0"],
              balanceX: "300",
              balanceY: "500",

              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "1000",
                totalDebtAmountOut: "500",
                collateralAmountOut: "1000",
                amountRepay: "500",
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "500",
                collateralAmountOut: "1000",
              }],
              liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "1040", amountOut: "1040"}]
            });
          }

          it("should not complete the withdraw", async () => {
            const ret = await loadFixture(makeWithdrawStepTest);
            expect(ret.completed).eq(false);
          });

          it("should set expected balances", async () => {
            const ret = await loadFixture(makeWithdrawStepTest);
            expect([ret.balanceX, ret.balanceY].join()).eq([260, 1040].join()); // 20% 80%
          });
        });
      });

      describe("Read propNotUnderlying18 from pool", () => {
        describe("Direct repay, borrowInsteadRepay", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
            return makeWithdrawStep({
              tokenX: usdc,
              tokenY: usdt,

              amountToSwap: "1501",
              tokenToSwap: usdc,

              planKind: PLAN_REPAY_SWAP_REPAY,

              // At first, we need proportion 1 (all not-underlying)
              // The app will swap all usdt to usdt
              // After the swap we change proportion to 0 (all underlying)
              // so, it will be necessary to make a borrow to get required amount of usdt
              propNotUnderlying18: ["1", "0"],

              liquidationThresholds: ["0", "0"],
              balanceX: "500",
              balanceY: "500",

              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "1001",
                totalDebtAmountOut: "500",
                collateralAmountOut: "1001",
                amountRepay: "500",
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "500",
                collateralAmountOut: "1001"
              }],
              liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "1501", amountOut: "1502"}],
              borrows: [{
                converter: converter.address,
                collateralAsset: usdt,
                borrowAsset: usdc,
                collateralAmount: "1502",
                maxTargetAmount: "1345"
              }]
            });
          }

          it("should not complete the withdraw", async () => {
            const ret = await loadFixture(makeWithdrawStepTest);
            expect(ret.completed).eq(false);
          });

          it("should set expected balances", async () => {
            const ret = await loadFixture(makeWithdrawStepTest);
            expect([ret.balanceX, ret.balanceY].join()).eq([1345, 0].join());
          });
        });
        describe("Direct repay, !borrowInsteadRepay", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
            /**
             * Initial balances: 500 USDC, 500 USDT
             * repay 1: pay 500 USDT, receive 1001 USDC
             * balances: 1001 USDC, 0 USDT
             * swap: 1501 USDC = > 1502 USDT
             * balances: 0 USDC, 1502 USDT
             * repay 2 (partial): pay 400 USDT, receive 800 USDC
             * balances: 800 USDC, 1102 USDT
             * borrow using entryKind 1: 302 USDT => 120.8 USDT + 181.2 USDT, 181.2 USDT => 120.8 USDC
             * balances: 920.8 USDC, 920.8 USDT
             */
            return makeWithdrawStep({
              tokenX: usdc,
              tokenY: usdt,

              amountToSwap: "1501",
              tokenToSwap: usdc,

              planKind: PLAN_REPAY_SWAP_REPAY,
              propNotUnderlying18: ["0.5", "0.5"],

              liquidationThresholds: ["0", "0"],
              balanceX: "500",
              balanceY: "500",

              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "4000",
                totalDebtAmountOut: "2000",
                collateralAmountOut: "1001",
                amountRepay: "500",
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "800",
                totalDebtAmountOut: "400",
                collateralAmountOut: "800",
                amountRepay: "400",

                addToQueue: true
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "500",
                collateralAmountOut: "1001"
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "400",
                collateralAmountOut: "800",
              }],
              borrows: [{
                converter: converter.address,
                collateralAsset: usdt,
                borrowAsset: usdc,
                collateralAmount: "302",
                maxTargetAmount: "201.333333",
                collateralAmountOut: "181.2",
                borrowAmountOut: "120.799999",
              }],
              liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "1501", amountOut: "1502"}]
            });
          }

          it("should not complete the withdraw", async () => {
            const ret = await loadFixture(makeWithdrawStepTest);
            expect(ret.completed).eq(false);
          });

          it("should set expected balances", async () => {
            const ret = await loadFixture(makeWithdrawStepTest);
            expect([ret.balanceX, ret.balanceY].join()).eq(["920.799999", "920.8"].join());
          });
        });
      });
    });

    describe("PLAN_SWAP_ONLY", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
        return makeWithdrawStep({
          tokenX: usdc,
          tokenY: usdt,

          amountToSwap: "500",
          tokenToSwap: usdt,
          planKind: PLAN_SWAP_ONLY,

          liquidationThresholds: ["0", "0"],
          balanceX: "500",
          balanceY: "500",

          repays: [{
            collateralAsset: usdc,
            borrowAsset: usdt,
            totalCollateralAmountOut: "2000",
            totalDebtAmountOut: "1000",
          }],
          liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "500", amountOut: "501"}]
        });
      }

      it("should complete the withdraw", async () => {
        const ret = await loadFixture(makeWithdrawStepTest);
        // Leftovers were swapped, so withdraw is completed even if any debts still exist
        expect(ret.completed).eq(true);
      });

      it("should set expected balances", async () => {
        const ret = await loadFixture(makeWithdrawStepTest);
        expect([ret.balanceX, ret.balanceY].join()).eq([1001, 0].join());
      });
    });
  });

  describe("_getAmountToRepay2", () => {
    interface IGetAmountToRepay2Params {
      tokens: MockToken[];
      balances: string[];
      indicesCollateralBorrow: number[];
      propNotUnderlying18: string;
      prices: string[];

      repays?: IRepayParams[];
      liquidationThresholds?: string[];
      borrows?: IBorrowParamsNum[];
    }
    interface IGetAmountToRepay2Results {
      amountToRepay: number;
      borrowInsteadRepay: boolean;
    }

    async function makeGetAmountToRepay2(p: IGetAmountToRepay2Params) : Promise<IGetAmountToRepay2Results> {
      // decimals
      const decimals = await Promise.all(p.tokens.map(
        async x => x.decimals()
      ));

      // initial balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // setup repays
      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, facade.address, r);
        }
      }

      // setup borrows
      if (p.borrows) {
        for (const b of p.borrows) {
          await setupMockedBorrowEntryKind1(
            converter,
            facade.address,
            b,
            b.collateralAsset.address === p.tokens[0].address
              ? parseUnits((1 - +p.propNotUnderlying18).toString(), 18)
              : parseUnits((+p.propNotUnderlying18).toString(), 18),
            b.collateralAsset.address === p.tokens[0].address
              ? parseUnits((+p.propNotUnderlying18).toString(), 18)
              : parseUnits((1 - +p.propNotUnderlying18).toString(), 18),
          );
        }
      }

      const {amountToRepay, borrowInsteadRepay} = await facade._getAmountToRepay2({
          tokens: [p.tokens[0].address, p.tokens[1].address],
          prices: [
            parseUnits(p.prices[0], 18),
            parseUnits(p.prices[1], 18),
          ],
          decs: [
            parseUnits("1", await p.tokens[0].decimals()),
            parseUnits("1", await p.tokens[1].decimals()),
          ],
          balanceAdditions: [], // not used here
          liquidationThresholds: p.liquidationThresholds
            ? p.liquidationThresholds.map((x, index) => parseUnits(x, decimals[index]))
            : p.tokens.map(x => 0),
          converter: converter.address,
          liquidator: liquidator.address,
          planKind: 0, // not used here
          usePoolProportions: false, // not used here
          propNotUnderlying18: parseUnits(p.propNotUnderlying18, 18),
        },
        p.indicesCollateralBorrow[0],
        p.indicesCollateralBorrow[1],
      );

      return {
        amountToRepay: +formatUnits(amountToRepay, await p.tokens[p.indicesCollateralBorrow[1]].decimals()),
        borrowInsteadRepay
      }
    }

    describe("Good paths", () => {
      describe("Borrow is not required", () => {
        describe("Same prices, same decimals, direct borrow", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("should return expected amount-to-repay", async () => {
            // 20230706.2.calc.xlsx
            const ret = await makeGetAmountToRepay2({
              tokens: [usdc, usdt],
              balances: ["400", "1000"],
              prices: ["1", "1"],

              indicesCollateralBorrow: [0, 1],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "10000",
                totalDebtAmountOut: "5000"
              }],
              propNotUnderlying18: "0.25"
            });
            // 20230706.2.calc.xlsx
            expect(ret.amountToRepay).eq(520);
          })
        });
        describe("Same prices, same decimals, reverse borrow", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("should return expected amount-to-repay", async () => {
            // 20230706.2.calc.xlsx
            const ret = await makeGetAmountToRepay2({
              tokens: [usdt, usdc],
              balances: ["1000", "400"],
              prices: ["1", "1"],

              indicesCollateralBorrow: [1, 0],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "10000",
                totalDebtAmountOut: "5000"
              }],
              propNotUnderlying18: "0.75"
            });
            // 20230706.2.calc.xlsx
            expect(ret.amountToRepay).eq(520);
          })
        });
        describe("Same prices, different decimals", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("should return expected amount-to-repay", async () => {
            // 20230706.2.calc.xlsx
            const ret = await makeGetAmountToRepay2({
              tokens: [usdc, tetu],
              balances: ["400", "1000"],
              prices: ["1", "1"],

              indicesCollateralBorrow: [0, 1],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: tetu,
                totalCollateralAmountOut: "10000",
                totalDebtAmountOut: "5000"
              }],
              propNotUnderlying18: "0.25"
            });
            // 20230706.2.calc.xlsx
            expect(ret.amountToRepay).eq(520);
          })
        });
        describe("Different prices, same decimals", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("should return expected amount-to-repay", async () => {
            // 20230706.2.calc.xlsx
            const ret = await makeGetAmountToRepay2({
              tokens: [usdc, usdt],
              balances: ["200", "2000"],
              prices: ["2", "0.5"],

              indicesCollateralBorrow: [0, 1],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "5000",
                totalDebtAmountOut: "10000"
              }],
              propNotUnderlying18: "0.25"
            });
            // 20230706.2.calc.xlsx
            expect(ret.amountToRepay).eq(1040);
          })
        });
      });
      describe("Borrow is required", () => {
        describe("Same prices, same decimals, direct borrow", () => {
          describe("No repay is available", () => {
            let snapshot: string;
            beforeEach(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            afterEach(async function () {
              await TimeUtils.rollback(snapshot);
            });

            it("should return true", async () => {
              // 20230706.2.calc.xlsx
              const ret = await makeGetAmountToRepay2({
                tokens: [usdc, usdt],
                balances: ["1000", "1001"],
                prices: ["1", "1"],

                indicesCollateralBorrow: [0, 1],
                repays: [],
                propNotUnderlying18: "0.5"
              });
              expect(ret.borrowInsteadRepay).eq(true);
            })
            it("should return false", async () => {
              // 20230706.2.calc.xlsx
              const ret = await makeGetAmountToRepay2({
                tokens: [usdc, usdt],
                balances: ["1001", "1000"],
                prices: ["1", "1"],

                indicesCollateralBorrow: [0, 1],
                repays: [],
                propNotUnderlying18: "0.5"
              });
              expect(ret.borrowInsteadRepay).eq(false);
            })
          });
          describe("Too small repay is available", () => {
            let snapshot: string;
            beforeEach(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            afterEach(async function () {
              await TimeUtils.rollback(snapshot);
            });

            it("should return expected values", async () => {
              // 20230706.2.calc.xlsx
              const ret = await makeGetAmountToRepay2({
                tokens: [usdc, usdt],
                balances: ["1200", "1800"],
                prices: ["1", "1"],

                indicesCollateralBorrow: [0, 1],
                // we need final balances 1500:1500
                // we should repay 300 usdt
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalCollateralAmountOut: "200",
                  totalDebtAmountOut: "100",
                }],
                propNotUnderlying18: "0.5"
              });
              expect(ret.borrowInsteadRepay).eq(false);
              expect(ret.amountToRepay).eq(200);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("No borrow", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should return zero", async () => {
          // 20230706.2.calc.xlsx
          const ret = await makeGetAmountToRepay2({
            tokens: [usdc, usdt],
            balances: ["1440", "480"],
            prices: ["1", "1"],

            indicesCollateralBorrow: [0, 1],
            propNotUnderlying18: "0.25"
          });
          expect(ret.amountToRepay).eq(0);
        })
      });
      describe("Negative B, balances", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should return zero", async () => {
          // 20230706.2.calc.xlsx
          const ret = await makeGetAmountToRepay2({
            tokens: [usdc, usdt],
            balances: ["200", "1000"],
            prices: ["1", "1"],

            indicesCollateralBorrow: [0, 1],
            propNotUnderlying18: "0.99",

            repays: [{
              collateralAsset: usdc,
              borrowAsset: usdt,
              totalCollateralAmountOut: "10000",
              totalDebtAmountOut: "5000"
            }],
          });
          expect(ret.amountToRepay).eq(0);
        })
      });
      describe("Negative B, proportions", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should return zero", async () => {
          // 20230706.2.calc.xlsx
          const ret = await makeGetAmountToRepay2({
            tokens: [usdc, usdt],
            balances: ["1000", "200"],
            prices: ["1", "1"],

            indicesCollateralBorrow: [0, 1],
            propNotUnderlying18: "0.98",

            repays: [{
              collateralAsset: usdc,
              borrowAsset: usdt,
              totalCollateralAmountOut: "10000",
              totalDebtAmountOut: "5000"
            }],
          });
          expect(ret.amountToRepay).eq(0);
        })
      });
      describe("Amount to borrow is less than the threshold", () => {
        let snapshot: string;
        beforeEach(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should return false", async () => {
          // 20230706.2.calc.xlsx
          const ret = await makeGetAmountToRepay2({
            tokens: [usdc, usdt],
            balances: ["1000", "1001"],
            prices: ["1", "1"],
            liquidationThresholds: ["2", "0"],

            indicesCollateralBorrow: [0, 1],
            repays: [],
            propNotUnderlying18: "0.5"
          });
          expect(ret.borrowInsteadRepay).eq(false);
        })
      });
    });
  });

  describe("borrowToProportions", () => {
    interface IBorrowToProportionsParams {
      tokens: MockToken[];
      balances: string[];
      prices?: string[];
      liquidationThresholds: string[];

      indexCollateral: number;
      indexBorrow: number;
      propNotUnderlying18: string;

      liquidations?: ILiquidationParams[];
      repays?: IRepayParams[];
      borrows?: IBorrowParamsNum[];
      quoteRepays?: IQuoteRepayParams[];
    }
    interface IBorrowToProportionsResults {
      balances: number[];
    }

    async function callBorrowToProportions(p: IBorrowToProportionsParams): Promise<IBorrowToProportionsResults> {
      const decimals: number[] = await Promise.all(p.tokens.map(
        async x => x.decimals()
      ));

      // set up current balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(
          facade.address,
          parseUnits(p.balances[i], await p.tokens[i].decimals())
        );
      }

      // set prices (1 by default)
      if (p.prices) {
        await priceOracleMock.changePrices(
          p.tokens.map(x => x.address),
          p.prices.map(price => parseUnits(price, 18))
        );
      }

      // set up liquidations
      if (p.liquidations) {
        for (const liquidation of p.liquidations) {
          await setupMockedLiquidation(liquidator, liquidation);
          await setupIsConversionValid(converter, liquidation, true);
        }
      }

      // setup repays
      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, facade.address, r);
        }
      }
      if (p.quoteRepays) {
        for (const q of p.quoteRepays) {
          await setupMockedQuoteRepay(converter, facade.address, q);
        }
      }

      // setup borrows
      if (p.borrows) {
        for (const b of p.borrows) {
          await setupMockedBorrowEntryKind1(
            converter,
            facade.address,
            b,
            p.indexCollateral === 0
              ? parseUnits((1 - +p.propNotUnderlying18).toString(), 18)
              : parseUnits((+p.propNotUnderlying18).toString(), 18),
            p.indexCollateral === 0
              ? parseUnits((+p.propNotUnderlying18).toString(), 18)
              : parseUnits((1 - +p.propNotUnderlying18).toString(), 18),
          );
          await b.collateralAsset.connect(await Misc.impersonate(facade.address)).approve(converter.address, Misc.MAX_UINT);
        }
      }

      await facade.borrowToProportions(
        {
          planKind: 0, // not use here
          tokens: p.tokens.map(x => x.address),
          prices: p.prices
            ? p.prices.map(price => parseUnits(price, 18))
            : p.tokens.map(x => parseUnits("1", 18)),
          propNotUnderlying18: parseUnits((+p.propNotUnderlying18).toString(), 18),
          converter: converter.address,
          liquidator: liquidator.address,
          liquidationThresholds: p.liquidationThresholds.map(
            (threshold, index) => parseUnits(threshold, decimals[index])
          ),
          balanceAdditions: [], // not used here
          decs: decimals.map(x => parseUnits("1", x)),
          usePoolProportions: false // not used here
        },
        p.indexCollateral,
        p.indexBorrow
      )

      return {
        balances: await Promise.all(p.tokens.map(
          async (x, index) => +formatUnits(await x.balanceOf(facade.address), decimals[index])
        ))
      };
    }

    describe("Good paths", () => {
      describe("Equal prices, equal decimals, equal proportions", () => {
        describe("Direct debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, usdt],
              indexCollateral: 0,
              indexBorrow: 1,
              balances: ["400", "100"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                collateralAmountOut: "200",
                borrowAmountOut: "100",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([200, 200].join());
          });
        });
        describe("Reverse debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, usdt],
              indexCollateral: 1,
              indexBorrow: 0,
              balances: ["100", "400"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: usdt,
                borrowAsset: usdc,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                collateralAmountOut: "200",
                borrowAmountOut: "100",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([200, 200].join());
          });
        });
      });
      describe("Different prices, equal decimals, equal proportions", () => {
        describe("Direct debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, usdt],
              prices: ["2", "0.5"],
              indexCollateral: 0,
              indexBorrow: 1,
              balances: ["200", "200"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                converter: converter.address,
                collateralAmount: "150",
                maxTargetAmount: "300",
                collateralAmountOut: "100",
                borrowAmountOut: "200",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([100, 400].join());
          });
        });
        describe("Reverse debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, usdt],
              prices: ["2", "0.5"],
              indexCollateral: 1,
              indexBorrow: 0,
              balances: ["50", "800"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: usdt,
                borrowAsset: usdc,
                converter: converter.address,
                collateralAmount: "600",
                maxTargetAmount: "75",
                collateralAmountOut: "400",
                borrowAmountOut: "50",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([100, 400].join());
          });
        });
      });
      describe("Equal prices, different decimals, equal proportions", () => {
        describe("Direct debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, tetu],
              indexCollateral: 0,
              indexBorrow: 1,
              balances: ["400", "100"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: usdc,
                borrowAsset: tetu,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                collateralAmountOut: "200",
                borrowAmountOut: "100",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([200, 200].join());
          });
        });
        describe("Reverse debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, tetu],
              indexCollateral: 1,
              indexBorrow: 0,
              balances: ["100", "400"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: tetu,
                borrowAsset: usdc,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                collateralAmountOut: "200",
                borrowAmountOut: "100",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([200, 200].join());
          });
        });
      });
      describe("Equal prices, equal decimals, different proportions", () => {
        describe("Reverse debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, usdt],
              indexCollateral: 1,
              indexBorrow: 0,
              balances: ["300", "400"], // untouched amounts are 300 : 100, we can use 300 usdt to borrow usdc
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.25",
              borrows: [{
                collateralAsset: usdt,
                borrowAsset: usdc,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                // 300 usdt - 257.142857 = 42.857143 usdt
                // 42.857143 usdt : 128.571428 usdc === 1:3
                collateralAmountOut: "257.142857",
                borrowAmountOut: "128.571428",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([428.571428, 142.857143].join());
          });
        });
        describe("Direct debt", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callBorrowToProportionsTest(): Promise<IBorrowToProportionsResults> {
            return callBorrowToProportions({
              tokens: [usdc, usdt],
              indexCollateral: 0,
              indexBorrow: 1,
              balances: ["400", "300"], // untouched amounts are 100 : 300, we can use 300 usdc to borrow usdt
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.75",
              borrows: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                // 300 usdc - 257.142857 = 42.857143 usdc
                // 42.857143 usdc : 128.571428 usdt === 1:3
                collateralAmountOut: "257.142857",
                borrowAmountOut: "128.571428",
              }]
            });
          }

          it("should return expected values", async () => {
            const ret = await loadFixture(callBorrowToProportionsTest);
            expect(ret.balances.join()).eq([142.857143, 428.571428].join());
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Opposite debt exists", () => {
        let snapshot: string;
        beforeEach(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should revert, usdt=>usdc exist", async () => {
          // we are going to borrow usdt under usdc, but there is existed borrow of usdc under usdt
          await expect(callBorrowToProportions({
            tokens: [usdc, usdt],
            indexCollateral: 0,
            indexBorrow: 1,
            balances: ["400", "100"],
            liquidationThresholds: ["0", "0"],
            propNotUnderlying18: "0.5",
            borrows: [{
              collateralAsset: usdc,
              borrowAsset: usdt,
              converter: converter.address,
              collateralAmount: "300",
              maxTargetAmount: "150",
              collateralAmountOut: "200",
              borrowAmountOut: "100",
            }],
            repays: [{
              collateralAsset: usdt,
              borrowAsset: usdc,
              totalCollateralAmountOut: "100",
              totalDebtAmountOut: "50"
            }]
          })).revertedWith("TS-29 opposite debt exists"); // OPPOSITE_DEBT_EXISTS
        });
        it("should revert, usdc=>usdt exist", async () => {
          // we are going to borrow usdt under usdc, but there is existed borrow of usdc under usdt
          await expect(callBorrowToProportions({
            tokens: [usdc, usdt],
            indexCollateral: 1,
            indexBorrow: 0,
            balances: ["100", "400"],
            liquidationThresholds: ["0", "0"],
            propNotUnderlying18: "0.5",
            borrows: [{
              collateralAsset: usdt,
              borrowAsset: usdc,
              converter: converter.address,
              collateralAmount: "300",
              maxTargetAmount: "150",
              collateralAmountOut: "200",
              borrowAmountOut: "100",
            }],
            repays: [{
              collateralAsset: usdc,
              borrowAsset: usdt,
              totalCollateralAmountOut: "100",
              totalDebtAmountOut: "50"
            }]
          })).revertedWith("TS-29 opposite debt exists"); // OPPOSITE_DEBT_EXISTS
        });
        it("should NOT revert if the debt is dust", async () => {
          // we are going to borrow usdt under usdc, there is existed borrow of usdc under usdt with DUST amounts
          const ret = await callBorrowToProportions({
              tokens: [usdc, usdt],
              indexCollateral: 0,
              indexBorrow: 1,
              balances: ["400", "100"],
              liquidationThresholds: ["0", "0"],
              propNotUnderlying18: "0.5",
              borrows: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                converter: converter.address,
                collateralAmount: "300",
                maxTargetAmount: "150",
                collateralAmountOut: "200",
                borrowAmountOut: "100",
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                totalCollateralAmountOut: "0.001",
                totalDebtAmountOut: "0.00009" // this amount is less than AppLib.DUST_AMOUNT_TOKENS tokens
              }]
          });

          expect(ret.balances.join()).eq([200, 200].join());
        });
      });
    });
  });

  describe("_extractProp", () => {
    describe("Good paths", () => {
      it("should return expected propNotUnderlying18 for PLAN_SWAP_REPAY", async () => {
        const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_SWAP_REPAY, Misc.ONE18]);
        expect((await facade._extractProp(PLAN_SWAP_REPAY, entryData)).eq(Misc.ONE18)).eq(true);
      });
      it("should return propNotUnderlying18=MAX_UINT for PLAN_SWAP_REPAY", async () => {
        const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_SWAP_REPAY, Misc.MAX_UINT]);
        expect((await facade._extractProp(PLAN_SWAP_REPAY, entryData)).eq(Misc.MAX_UINT)).eq(true);
      });
      it("should return custom propNotUnderlying18 for PLAN_SWAP_ONLY", async () => {
        const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_SWAP_ONLY, 777]);
        expect((await facade._extractProp(PLAN_SWAP_ONLY, entryData)).toNumber()).eq(777);
      });
      it("should return max uint for PLAN_REPAY_SWAP_REPAY", async () => {
        const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
        expect(await facade._extractProp(PLAN_REPAY_SWAP_REPAY, entryData)).eq(Misc.MAX_UINT);
      });
      it("should return 0 for PLAN_REPAY_SWAP_REPAY", async () => {
        const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_REPAY_SWAP_REPAY, 0]);
        expect(await facade._extractProp(PLAN_REPAY_SWAP_REPAY, entryData)).eq(0);
      });
    });
    describe("Bad paths", () => {
      it("should revert if plan is unknown", async () => {
        const entryData = defaultAbiCoder.encode(['uint256'], [555]);
        await expect(facade._extractProp(555, entryData)).revertedWith("TS-9 wrong value"); // WRONG_VALUE
      });
      it("should revert if proportion is greater than 1e18", async () => {
        const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_REPAY_SWAP_REPAY, Misc.ONE18.add(1)]);
        await expect(facade._extractProp(PLAN_SWAP_REPAY, entryData)).revertedWith("TS-30 invalid value"); // INVALID_VALUE
      });
    });
  });

  describe("setFuseStatus", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetFuseStatusParams {
      status: number;
      thresholds?: string[];
    }
    interface ISetFuseStatusResults {
      status: number;
      thresholds: number[];
    }
    async function callSetFuseStatus(p: ISetFuseStatusParams): Promise<ISetFuseStatusResults> {
      await facade.setFuseStatus(p.status);
      if (p.thresholds) {
        const tt = new Array<BigNumber>(4);
        for (let i = 0; i < 4; ++i) {
          tt[i] = parseUnits(p.thresholds[i], 18);
        }
        await facade.setFuseThresholds([tt[0], tt[1], tt[2], tt[3]]);
      }
      return {
        status: ((await facade.getFuseData()).status).toNumber(),
        thresholds: (await facade.getFuseData()).thresholds.map(
          x => +formatUnits(x, 18)
        )
      }
    }

    it("should turn fuse OFF", async () => {
      expect((await callSetFuseStatus({status: FUSE_DISABLED_0})).status).eq(FUSE_DISABLED_0);
    });
    it("should reset fuse", async () => {
      expect((await callSetFuseStatus({status: FUSE_OFF_1})).status).eq(FUSE_OFF_1);
    });
    it("should assign arbitrary value to fuse status", async () => {
      expect((await callSetFuseStatus({status: FUSE_ON_UPPER_LIMIT_3})).status).eq(FUSE_ON_UPPER_LIMIT_3);
    });
    it("should not change thresholds", async () => {
      expect((await callSetFuseStatus({status: FUSE_OFF_1, thresholds: ["1", "2", "4", "3"]})).thresholds.join()).eq([1, 2, 4, 3].join());
    });
  });

  describe("setFuseThresholds", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetFuseThresholdsParams {
      thresholds: string[];
      status?: number;
    }
    interface ISetFuseThresholdsResults {
      status: number;
      thresholds: number[];
    }
    async function callSetFuseThresholds(p: ISetFuseThresholdsParams): Promise<ISetFuseThresholdsResults> {
      if (p.status) {
        await facade.setFuseStatus(p.status);
      }

      const tt = new Array<BigNumber>(4);
      for (let i = 0; i < 4; ++i) {
        tt[i] = parseUnits(p.thresholds[i], 18);
      }

      await facade.setFuseThresholds([tt[0], tt[1], tt[2], tt[3]]);
      return {
        status: ((await facade.getFuseData()).status).toNumber(),
        thresholds: (await facade.getFuseData()).thresholds.map(
          x => +formatUnits(x, 18)
        )
      }

    }

    describe("Good paths", () => {
      it("should set expected thresholds", async () => {
        expect((await callSetFuseThresholds({thresholds: ["0.995", "0.995005", "1.005012", "1.005009"]})).thresholds.join()).eq([0.995, 0.995005, 1.005012, 1.005009].join());
      });
      it("should not change status", async () => {
        expect((await callSetFuseThresholds({
          thresholds: ["1", "2", "4", "3"],
          status: FUSE_ON_LOWER_LIMIT_2
        })).status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
      it("should set lower limit only", async () => {
        expect((await callSetFuseThresholds({thresholds: ["1", "2", "0", "0"]})).thresholds.join()).eq([1, 2, 0, 0].join());
      });
      it("should set upper limit only", async () => {
        expect((await callSetFuseThresholds({thresholds: ["0", "0", "4", "3"]})).thresholds.join()).eq([0, 0, 4, 3].join());
      });
      it("should set zero limits", async () => {
        await callSetFuseThresholds({thresholds: ["1", "2", "4", "3"]});
        expect((await callSetFuseThresholds({thresholds: ["0", "0", "0", "0"]})).thresholds.join()).eq([0, 0, 0, 0].join());
      });
    });
    describe("Bad paths", () => {
      it("should revert if lower-limit-on is greater than lower-limit-off", async () => {
        await expect(callSetFuseThresholds({thresholds: ["2", "1", "0", "0"]})).revertedWith("TS-30 invalid value"); // INVALID_VALUE
      });
      it("should revert if upper-limit-on is less than upper-limit-off", async () => {
        await expect(callSetFuseThresholds({thresholds: ["0", "0", "1", "2"]})).revertedWith("TS-30 invalid value"); // INVALID_VALUE
      });
      it("should revert if upper-limit-on is less than lower-limit-off", async () => {
        await expect(callSetFuseThresholds({thresholds: ["2", "3", "2", "1"]})).revertedWith("TS-30 invalid value"); // INVALID_VALUE
      });
    });
  });

  describe("needChangeFuseStatus", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    const DEFAULT_PRICE_THRESHOLDS = ["0.995", "0.997", "1.005", "1.003"];
    interface INeedChangeFuseStatusParams {
      thresholds?: string[];
      status: number;
      newPrice?: string;
      newPricePool?: string;
    }
    interface INeedChangeFuseStatusResults {
      needToChange: boolean;
      status: number;
    }
    async function callNeedChange(p: INeedChangeFuseStatusParams): Promise<INeedChangeFuseStatusResults> {
      const tt = new Array<BigNumber>(4);
      for (let i = 0; i < 4; ++i) {
        tt[i] = parseUnits(p.thresholds
          ? p.thresholds[i]
          : DEFAULT_PRICE_THRESHOLDS[i]
          , 18
        );
      }

      const ret = await facade.needChangeFuseStatus(
        {
          status: p.status,
          thresholds: [tt[0], tt[1], tt[2], tt[3]]
        },
        parseUnits(p.newPrice || "1", 18),
        parseUnits(p.newPricePool || "1", 18)
      );
      console.log(ret);
      return {
        needToChange: ret.needToChange,
        status: ret.status,
      }
    }

    describe("Fuse is FUSE_DISABLED_0", () => {
      it("should return false and FUSE_DISABLED_0", async () => {
        const ret = await callNeedChange({status: FUSE_DISABLED_0 });
        expect(ret.needToChange).eq(false);
        expect(ret.status).eq(FUSE_DISABLED_0);
      });
    });

    describe("Fuse is FUSE_OFF_1", () => {
      it("should return false if new price == low-limit-off", async () => {
        expect((await callNeedChange({status: FUSE_OFF_1, newPrice: "0.997"})).needToChange).eq(false);
      });
      it("should return false if (low-limit-on < new price < low-limit-off)", async () => {
        expect((await callNeedChange({status: FUSE_OFF_1, newPrice: "0.996"})).needToChange).eq(false);
      });
      it("should return true if low-limit-on == new price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPrice: "0.995"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
      it("should return true if low-limit-on == new pool price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPricePool: "0.995"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
      it("should return true if low-limit-on < new price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPrice: "0.991"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
      it("should return true if low-limit-on < new pool price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPricePool: "0.991"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });

      it("should return false if new price == upper-limit-off", async () => {
        expect((await callNeedChange({status: FUSE_OFF_1, newPrice: "1.003"})).needToChange).eq(false);
      });
      it("should return false if (upper-limit-off < new price < upper-limit-on)", async () => {
        expect((await callNeedChange({status: FUSE_OFF_1, newPrice: "1.004"})).needToChange).eq(false);
      });
      it("should return true if upper-limit-on == new price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPrice: "1.005"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });
      it("should return true if upper-limit-on == new pool price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPricePool: "1.005"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });
      it("should return true if upper-limit-on < new price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPrice: "1.007"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });
      it("should return true if upper-limit-on < new pool price", async () => {
        const ret = await callNeedChange({status: FUSE_OFF_1, newPricePool: "1.007"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });
    });

    describe("Fuse is FUSE_ON_LOWER_LIMIT_2", () => {
      it("should return false if new price < low-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.990"})).needToChange).eq(false);
      });
      it("should return false if new price == low-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.995"})).needToChange).eq(false);
      });
      it("should return false if (low-limit-on < new price < low-limit-off)", async () => {
        expect((await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.996"})).needToChange).eq(false);
      });
      it("should return false if new pool price < low-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPricePool: "0.990"})).needToChange).eq(false);
      });
      it("should return false if new pool price == low-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPricePool: "0.995"})).needToChange).eq(false);
      });
      it("should return false if (low-limit-on < new pool price < low-limit-off)", async () => {
        expect((await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPricePool: "0.996"})).needToChange).eq(false);
      });
      it("should return true if new price == low-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.997"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new price > low-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.998"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new price == upper-limit-on", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "1.005"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });

      it("should return true if new price == low-limit-off and new price pool == low-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.997", newPricePool: "0.997"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new price > low-limit-off and new pool price > low-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.998", newPricePool: "0.998"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new price == upper-limit-on and new pool price == upper-limit-on", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "1.005", newPricePool: "1.005"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });

      it("should return false if new price == low-limit-off but new pool price is lower", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.997", newPricePool: "0.99"});
        expect(ret.needToChange).eq(false);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
      it("should return false if new price > low-limit-off but new pool price is lower", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPrice: "0.998", newPricePool: "0.99"});
        expect(ret.needToChange).eq(false);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });

      it("should return false if new pool price == low-limit-off but new price is lower", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPricePool: "0.997", newPrice: "0.99"});
        expect(ret.needToChange).eq(false);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
      it("should return false if new pool price > low-limit-off but new price is lower", async () => {
        const ret = await callNeedChange({status: FUSE_ON_LOWER_LIMIT_2, newPricePool: "0.998", newPrice: "0.99"});
        expect(ret.needToChange).eq(false);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });
    });

    describe("Fuse is FUSE_ON_UPPER_LIMIT_3", () => {
      it("should return false if new price > upper-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "1.010"})).needToChange).eq(false);
      });
      it("should return false if new price == upper-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "1.005"})).needToChange).eq(false);
      });
      it("should return false if (upper-limit-off < new price < upper-limit-on)", async () => {
        expect((await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "1.004"})).needToChange).eq(false);
      });

      it("should return false if new pool price > upper-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPricePool: "1.010"})).needToChange).eq(false);
      });
      it("should return false if new pool price == upper-limit-on", async () => {
        expect((await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPricePool: "1.005"})).needToChange).eq(false);
      });
      it("should return false if (upper-limit-off < new pool price < upper-limit-on)", async () => {
        expect((await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPricePool: "1.004"})).needToChange).eq(false);
      });

      it("should return true if new price == upper-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "1.003"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new price < upper-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "1.001"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new price == lower-limit-on", async () => {
        const ret = await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "0.995"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_ON_LOWER_LIMIT_2);
      });

      it("should return true if new pool price == upper-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPricePool: "1.003"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });
      it("should return true if new pool price < upper-limit-off", async () => {
        const ret = await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPricePool: "1.001"});
        expect(ret.needToChange).eq(true);
        expect(ret.status).eq(FUSE_OFF_1);
      });

      it("should return false if new price < upper-limit-off but new pool price is more", async () => {
        const ret = await callNeedChange({status: FUSE_ON_UPPER_LIMIT_3, newPrice: "1.001", newPricePool: "1.01"});
        expect(ret.needToChange).eq(false);
        expect(ret.status).eq(FUSE_ON_UPPER_LIMIT_3);
      });
    });
  });
//endregion Unit tests
});
