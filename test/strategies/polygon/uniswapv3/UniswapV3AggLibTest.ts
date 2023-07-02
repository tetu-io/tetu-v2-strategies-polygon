import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams
} from "../../../baseUT/mocks/TestDataTypes";
import {setupMockedQuoteRepay, setupMockedRepay} from "../../../baseUT/mocks/MockRepayUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {
  IERC20Metadata__factory,
  MockForwarder,
  MockTetuConverter, MockTetuLiquidatorSingleCall,
  MockToken, PriceOracleMock,
  UniswapV3AggLibFacade
} from "../../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {setupIsConversionValid, setupMockedLiquidation} from "../../../baseUT/mocks/MockLiquidationUtils";
import {BigNumber} from "ethers";

describe('UniswapV3AggLibTest', () => {
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
  let facade: UniswapV3AggLibFacade;
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
    facade = await MockHelper.createUniswapV3AggLibFacade(signer);
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
        converter.address,
        [p.tokenX.address, p.tokenY.address],
        [
          parseUnits(p.liquidationThresholds[0], await p.tokenX.decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokenX.decimals())
        ],
        parseUnits(p.propNotUnderlying18 || "0", 18)
      );

      return {
        amountToSwap: ret.tokenToSwap === Misc.ZERO_ADDRESS
          ? 0
          : +formatUnits(ret.amountToSwap, await IERC20Metadata__factory.connect(ret.tokenToSwap, signer).decimals()),
        tokenToSwap: ret.tokenToSwap
      }
    }

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

  describe("withdrawStep", () => {
    interface IWithdrawStepParams {
      /** This is underlying always */
      tokenX: MockToken;
      tokenY: MockToken;

      tokenToSwap?: MockToken;
      amountToSwap: string;

      liquidationThresholds: string[];
      propNotUnderlying18?: string;

      balanceX: string;
      balanceY: string;
      prices?: {
        priceX: string;
        priceY: string;
      }

      liquidations?: ILiquidationParams[];
      repays?: IRepayParams[];
      quoteRepays?: IQuoteRepayParams[];
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

      // make withdraw
      const completed = await facade.callStatic.withdrawStep(
        converter.address,
        [p.tokenX.address, p.tokenY.address],
        [
          parseUnits(p.liquidationThresholds[0], await p.tokenX.decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokenX.decimals())
        ],
        p.tokenToSwap?.address || Misc.ZERO_ADDRESS,
        p.tokenToSwap === undefined
          ? BigNumber.from(0)
          : parseUnits(p.amountToSwap, await IERC20Metadata__factory.connect(p.tokenToSwap.address, signer).decimals()),
        liquidator.address,
        "0x",
        true,
        parseUnits(p.propNotUnderlying18 || "0", 18)
      );

      await facade.withdrawStep(
        converter.address,
        [p.tokenX.address, p.tokenY.address],
        [
          parseUnits(p.liquidationThresholds[0], await p.tokenX.decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokenX.decimals())
        ],
        p.tokenToSwap?.address || Misc.ZERO_ADDRESS,
        p.tokenToSwap === undefined
          ? BigNumber.from(0)
          : parseUnits(p.amountToSwap, await IERC20Metadata__factory.connect(p.tokenToSwap.address, signer).decimals()),
        liquidator.address,
        "0x",
        true,
        parseUnits(p.propNotUnderlying18 || "0", 18)
      );

      return {
        completed,
        balanceX: +formatUnits(await p.tokenX.balanceOf(facade.address), await p.tokenX.decimals()),
        balanceY: +formatUnits(await p.tokenY.balanceOf(facade.address), await p.tokenY.decimals()),
      }
    }

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

                liquidationThresholds: ["0", "0"],
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

  });

//endregion Unit tests
});