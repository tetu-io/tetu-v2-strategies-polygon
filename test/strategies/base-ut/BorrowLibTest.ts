import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BorrowLibFacade, MockForwarder, MockTetuConverter, MockTetuLiquidatorSingleCall, MockToken, PriceOracleMock} from "../../../typechain";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {IBorrowParamsNum, ILiquidationParams, IQuoteRepayParams, IRepayParams} from "../../baseUT/mocks/TestDataTypes";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {setupMockedBorrowEntryKind1, setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";
import {
  Misc
} from "../../../scripts/utils/Misc";
import {setupIsConversionValid, setupMockedLiquidation} from "../../baseUT/mocks/MockLiquidationUtils";

describe('BorrowLibTest', () => {
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
  let facade: BorrowLibFacade;
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
    facade = await MockHelper.createBorrowLibFacade(signer);
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
  describe("rebalanceAssets X:Y", () => {
    interface IRebalanceAssetsParams {
      tokenX: MockToken;
      tokenY: MockToken;
      /** [0 .. 100_000] */
      proportion: number;
      thresholdX?: number;
      thresholdY?: number;

      /**
       * Amount of token X
       * that should be received on balance to send profit to the insurance.
       * I.e. we have 1000 USDC, we need USDC:USDT 1:1 and need to send profit 200 USDC
       * So, in result we should have on balance:
       *    200 USDC (profit) + 300 USDC + 500 USDC (collateral to get 300 USDT)
       *    300:300 == 1:1, 200 USDC is standalone amount
       */
      additionX?: string;

      strategyBalances: {
        balanceX: string;
        balanceY: string;
      }
      prices?: {
        priceX: string;
        priceY: string;
      }
      repays?: IRepayParams[];
      borrows?: IBorrowParamsNum[];
      quoteRepays?: IQuoteRepayParams[];
      liquidations?: ILiquidationParams[];
      isConversionValid?: boolean;
    }

    interface IRebalanceAssetsResults {
      balanceX: number;
      balanceY: number;
    }

    async function makeRebalanceAssets(p: IRebalanceAssetsParams): Promise<IRebalanceAssetsResults> {
      // set up current balances
      await p.tokenX.mint(
        facade.address,
        parseUnits(p.strategyBalances.balanceX, await p.tokenX.decimals())
      );
      await p.tokenY.mint(
        facade.address,
        parseUnits(p.strategyBalances.balanceY, await p.tokenY.decimals())
      );

      // set prices (1 by default)
      if (p.prices) {
        await priceOracleMock.changePrices(
          [p.tokenX.address, p.tokenY.address],
          [parseUnits(p.prices.priceX, 18), parseUnits(p.prices.priceY, 18)]
        );
      }

      const prop0 = parseUnits(Number(p.proportion / SUM_PROPORTIONS).toString(), 18);
      const prop1 = parseUnits(Number((SUM_PROPORTIONS - p.proportion) / SUM_PROPORTIONS).toString(), 18);

      // prepare borrow/repay
      if (p.borrows) {
        for (const borrow of p.borrows) {
          await setupMockedBorrowEntryKind1(
            converter,
            facade.address,
            borrow,
            borrow.collateralAsset === p.tokenX
              ? prop0
              : prop1,
            borrow.collateralAsset === p.tokenX
              ? prop1
              : prop0,
          );
          await borrow.collateralAsset.connect(await Misc.impersonate(facade.address)).approve(converter.address, Misc.MAX_UINT);
        }
      }
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

      // prepare liquidations
      if (p.liquidations) {
        for (const liquidation of p.liquidations) {
          await setupMockedLiquidation(liquidator, liquidation);
          await setupIsConversionValid(
            converter,
            liquidation,
            p.isConversionValid === undefined
              ? true
              : p.isConversionValid
          )
        }
      }

      // make rebalancing
      await facade.rebalanceAssets(
        converter.address,
        liquidator.address,
        p.tokenX.address,
        p.tokenY.address,
        // 100_000 was replaced by 1e18
        parseUnits(Number(p.proportion / SUM_PROPORTIONS).toString(), 18),
        parseUnits((p.thresholdX || 0).toString(), await p.tokenX.decimals()),
        parseUnits((p.thresholdY || 0).toString(), await p.tokenY.decimals()),
        parseUnits(p?.additionX ?? "0", await p.tokenX.decimals())
      );

      // get results
      return {
        balanceX: +formatUnits(await p.tokenX.balanceOf(facade.address), await p.tokenX.decimals()),
        balanceY: +formatUnits(await p.tokenY.balanceOf(facade.address), await p.tokenY.decimals()),
      }
    }

    describe("addition0 == 0", () => {
      describe("same prices, equal decimals", () => {
        describe("Current state - no debts", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "100",
                  balanceY: "190"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 usdc for 90 usdt, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 usdt => 36 usdc
                  // as result we will have 36 usdt and 36 borrowed usdc (with collateral 54 usdt)
                  collateralAsset: usdt,
                  borrowAsset: usdc,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(136);
              expect(r.balanceY).eq(136);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "190",
                  balanceY: "100"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 usdt for 90 usdc, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 usdc => 36 usdt
                  // as result we will have 36 usdc and 36 borrowed usdt (with collateral 54 usdc)
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(136);
              expect(r.balanceY).eq(136);
            });
          });
        });

        describe("Current state - direct debt - USDT is borrowed under USDC", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     300 (+540c)   525 (+315c)      480 (+360)
                 * usdt     600 (-360b)   450 (-210b)      480 (-240)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "300",
                    balanceY: "600"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "225",
                    amountRepay: "150",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "75",
                    maxTargetAmount: "50",

                    collateralAmountOut: "45",
                    borrowAmountOut: "30",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "150",
                    collateralAmountOut: "225",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(480);
                expect(r.balanceY).eq(480);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                 * usdt     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "3000",
                    balanceY: "6000"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "2100", // 2100 / 1400 = 1.5
                    maxTargetAmount: "1400",

                    collateralAmountOut: "1260",
                    borrowAmountOut: "840",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(4380);
                expect(r.balanceY).eq(4380);
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     600 (+540c)   600-180=420 (+540+180=720c)
               * usdt     300 (-360b)   300+120=420 (-480b)
               *          sum = 1080    sum = 1080
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "600",
                  balanceY: "300"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "300",
                  maxTargetAmount: "200", // 300 / 1.5 = 200

                  collateralAmountOut: "180",
                  borrowAmountOut: "120",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  collateralAmountOut: "540",
                  amountRepay: "360",
                  totalCollateralAmountOut: "540",
                  totalDebtAmountOut: "360",
                }],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  amountRepay: "360",
                  collateralAmountOut: "540",
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(420);
              expect(r.balanceY).eq(420);
            });
          });
        });

        describe("Current state - reverse debt - USDC is borrowed under USDT", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     300 (-360c)   300+120=420 (-480b)
               * usdt     600 (+540b)   600-180=420 (+540+180=720c)
               *          sum = 1080    sum = 1080
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "300",
                  balanceY: "600"
                },
                borrows: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,

                  collateralAmount: "300",
                  maxTargetAmount: "200", // 300 / 1.5 = 200

                  collateralAmountOut: "180",
                  borrowAmountOut: "120",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  collateralAmountOut: "540",
                  amountRepay: "360",
                  totalCollateralAmountOut: "540",
                  totalDebtAmountOut: "360",
                }],
                quoteRepays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  amountRepay: "360",
                  collateralAmountOut: "540",
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(420);
              expect(r.balanceY).eq(420);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     600 (-360b)   450 (-210b)      480 (-240)
                 * usdt     300 (+540c)   525 (+315c)      480 (+360)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "600",
                    balanceY: "300"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "225",
                    amountRepay: "150",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "75",
                    maxTargetAmount: "50",

                    collateralAmountOut: "45",
                    borrowAmountOut: "30",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "150",
                    collateralAmountOut: "225",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(480);
                expect(r.balanceY).eq(480);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                 * usdt     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "6000",
                    balanceY: "3000"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "2100", // 2100 / 1400 = 1.5
                    maxTargetAmount: "1400",

                    collateralAmountOut: "1260",
                    borrowAmountOut: "840",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(4380);
                expect(r.balanceY).eq(4380);
              });
            });
          });
        });

      });
      describe("not equal proportions", () => {
        describe("Current state - no debts", () => {
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               * 600 USDC = 100 USDC + 500 USDC
               *      Collateral 500 USDC => 500/1.25 = 400 USDT
               * Result:
               *  100 USDC (+500c)
               *  400 USDC (-400b)
               *  Proportion is 4 usdc:1 usdt or 80:20
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 20_000, // 20 usdc:80 usdt
                strategyBalances: {
                  balanceX: "600",
                  balanceY: "0"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "600", // 600 / 480 = 1.25
                  maxTargetAmount: "480",

                  collateralAmountOut: "500", // 500 / 400 = 1.25
                  borrowAmountOut: "400",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(100);
              expect(r.balanceY).eq(400);
            });
          });
        });
      });
      describe("same prices, equal decimals, one of the assets has zero initial amount", () => {
        describe("Current state - no debts", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               * We can borrow 60 usdc for 90 usdt, 90/60 = 1.5
               * so, 90 => 36 + 54, 54 usdt => 36 usdc
               *        initial    after borrow
               * usdc     0 (0)         36 (+54)
               * usdt     90 (0)        36 (-36)
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "0",
                  balanceY: "90"
                },
                borrows: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(36);
              expect(r.balanceY).eq(36);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            /**
             * We can borrow 60 usd6 for 90 usdc, 90/60 = 1.5
             *        initial    after borrow
             * usdc     90 (0)       36 (-36)
             * usdt     0 (0)        36 (+54)
             */
            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "90",
                  balanceY: "0"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(36);
              expect(r.balanceY).eq(36);
            });
          });
        });

        describe("Current state - direct debt - USDT is borrowed under USDC", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     0 (+540c)     225 (+315c)      180 (+360)
                 * usdt     300 (-360b)   150 (-210b)      180 (-240)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "0",
                    balanceY: "300"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "225",
                    amountRepay: "150",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "75",
                    maxTargetAmount: "50",

                    collateralAmountOut: "45",
                    borrowAmountOut: "30",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "150",
                    collateralAmountOut: "225",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(180);
                expect(r.balanceY).eq(180);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     0 (+540c)   540 (+0c)      540+840=1380 (-840b)
                 * usdt     3000 (-360b)   2640 (-0b)      2640-1260=1380 (+1260)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "0",
                    balanceY: "3000"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "2100", // 2100 / 1400 = 1.5
                    maxTargetAmount: "1400",

                    collateralAmountOut: "1260",
                    borrowAmountOut: "840",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(1380);
                expect(r.balanceY).eq(1380);
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     300 (+540c)   300-180=120 (+540+180=720c)
               * usdt     0 (-360b)     120 (-480b)
               *          sum = 480    sum = 480
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "300",
                  balanceY: "0"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "300",
                  maxTargetAmount: "200", // 300 / 1.5 = 200

                  collateralAmountOut: "180",
                  borrowAmountOut: "120",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  collateralAmountOut: "540",
                  amountRepay: "360",
                  totalCollateralAmountOut: "540",
                  totalDebtAmountOut: "360",
                }],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  amountRepay: "360",
                  collateralAmountOut: "540",
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(120);
              expect(r.balanceY).eq(120);
            });
          });
        });

        describe("Current state - reverse debt - USDC is borrowed under USDT", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     0 (-360c)     120 (-480b)
               * usdt     300 (+540b)   300-180=120 (+540+180=720c)
               *         sum = 480      sum = 480
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "0",
                  balanceY: "300"
                },
                borrows: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,

                  collateralAmount: "300",
                  maxTargetAmount: "200", // 300 / 1.5 = 200

                  collateralAmountOut: "180",
                  borrowAmountOut: "120",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  collateralAmountOut: "540",
                  amountRepay: "360",
                  totalCollateralAmountOut: "540",
                  totalDebtAmountOut: "360",
                }],
                quoteRepays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  amountRepay: "360",
                  collateralAmountOut: "540",
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(120);
              expect(r.balanceY).eq(120);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     300 (-360b)   150 (-210b)      180 (-240)
                 * usdt     0 (+540c)     225 (+315c)      180 (+360)
                 *         sum = 480      sum = 480
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "300",
                    balanceY: "0"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "225",
                    amountRepay: "150",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "75",
                    maxTargetAmount: "50",

                    collateralAmountOut: "45",
                    borrowAmountOut: "30",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "150",
                    collateralAmountOut: "225",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(180);
                expect(r.balanceY).eq(180);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     3000 (-360b)   2640 (-0b)      2640-1260=1380 (+1260)
                 * usdt     0 (+540c)      1540 (+0c)      1540+840=1380 (-840b)
                 *          sum = 3180    sum = 3180       sum = 3180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "3000",
                    balanceY: "0"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "2100", // 2100 / 1400 = 1.5
                    maxTargetAmount: "1400",

                    collateralAmountOut: "1260",
                    borrowAmountOut: "840",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(1380);
                expect(r.balanceY).eq(1380);
              });
            });
          });
        });
      });
      describe("same prices, different decimals", () => {
        describe("Current state - no debts", () => {
          describe("Need to increase USDC, reduce TETU", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: tetu,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "100",
                  balanceY: "190"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 usdc for 90 tetu, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 tetu => 36 usdc
                  // as result we will have 36 tetu and 36 borrowed usdc (with collateral 54 tetu)
                  collateralAsset: tetu,
                  borrowAsset: usdc,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(136);
              expect(r.balanceY).eq(136);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: tetu,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "190",
                  balanceY: "100"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 tetu for 90 usdc, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 usdc => 36 tetu
                  // as result we will have 36 usdc and 36 borrowed tetu (with collateral 54 usdc)
                  collateralAsset: usdc,
                  borrowAsset: tetu,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(136);
              expect(r.balanceY).eq(136);
            });
          });
        });

        describe("Current state - direct debt - USDT is borrowed under USDC", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     300 (+540c)   525 (+315c)      480 (+360)
                 * tetu     600 (-360b)   450 (-210b)      480 (-240)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: tetu,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "300",
                    balanceY: "600"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: tetu,
                    collateralAmountOut: "225",
                    amountRepay: "150",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: tetu,

                    collateralAmount: "75",
                    maxTargetAmount: "50",

                    collateralAmountOut: "45",
                    borrowAmountOut: "30",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: tetu,
                    amountRepay: "150",
                    collateralAmountOut: "225",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(480);
                expect(r.balanceY).eq(480);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                 * tetu     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: tetu,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "3000",
                    balanceY: "6000"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: tetu,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,

                    collateralAmount: "2100", // 2100 / 1400 = 1.5
                    maxTargetAmount: "1400",

                    collateralAmountOut: "1260",
                    borrowAmountOut: "840",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: tetu,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(4380);
                expect(r.balanceY).eq(4380);
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     600 (+540c)   600-180=420 (+540+180=720c)
               * tetu     300 (-360b)   300+120=420 (-480b)
               *          sum = 1080    sum = 1080
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: tetu,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "600",
                  balanceY: "300"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: tetu,

                  collateralAmount: "300",
                  maxTargetAmount: "200", // 300 / 1.5 = 200

                  collateralAmountOut: "180",
                  borrowAmountOut: "120",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: tetu,
                  collateralAmountOut: "540",
                  amountRepay: "360",
                  totalCollateralAmountOut: "540",
                  totalDebtAmountOut: "360",
                }],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: tetu,
                  amountRepay: "360",
                  collateralAmountOut: "540",
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(420);
              expect(r.balanceY).eq(420);
            });
          });
        });

        describe("Current state - reverse debt - USDC is borrowed under USDT", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     300 (-360c)   300+120=420 (-480b)
               * tetu     600 (+540b)   600-180=420 (+540+180=720c)
               *          sum = 1080    sum = 1080
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: tetu,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "300",
                  balanceY: "600"
                },
                borrows: [{
                  collateralAsset: tetu,
                  borrowAsset: usdc,

                  collateralAmount: "300",
                  maxTargetAmount: "200", // 300 / 1.5 = 200

                  collateralAmountOut: "180",
                  borrowAmountOut: "120",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: tetu,
                  borrowAsset: usdc,
                  collateralAmountOut: "540",
                  amountRepay: "360",
                  totalCollateralAmountOut: "540",
                  totalDebtAmountOut: "360",
                }],
                quoteRepays: [{
                  collateralAsset: tetu,
                  borrowAsset: usdc,
                  amountRepay: "360",
                  collateralAmountOut: "540",
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(420);
              expect(r.balanceY).eq(420);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     600 (-360b)   450 (-210b)      480 (-240)
                 * tetu     300 (+540c)   525 (+315c)      480 (+360)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: tetu,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "600",
                    balanceY: "300"
                  },
                  repays: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,
                    collateralAmountOut: "225",
                    amountRepay: "150",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,

                    collateralAmount: "75",
                    maxTargetAmount: "50",

                    collateralAmountOut: "45",
                    borrowAmountOut: "30",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,
                    amountRepay: "150",
                    collateralAmountOut: "225",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(480);
                expect(r.balanceY).eq(480);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                 * tetu     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: tetu,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "6000",
                    balanceY: "3000"
                  },
                  repays: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: tetu,

                    collateralAmount: "2100", // 2100 / 1400 = 1.5
                    maxTargetAmount: "1400",

                    collateralAmountOut: "1260",
                    borrowAmountOut: "840",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(4380);
                expect(r.balanceY).eq(4380);
              });
            });
          });
        });
      });
      describe("different prices, same decimals", () => {
        describe("Current state - no debts", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "200",
                  balanceY: "95"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 usdc for 90 usdt, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 usdt => 36 usdc
                  // as result we will have 36 usdt and 36 borrowed usdc (with collateral 54 usdt)
                  collateralAsset: usdt,
                  borrowAsset: usdc,

                  collateralAmount: "45",
                  maxTargetAmount: "120",

                  collateralAmountOut: "27",
                  borrowAmountOut: "72",

                  converter: ethers.Wallet.createRandom().address,
                }],
                prices: {
                  priceX: "0.5",
                  priceY: "2"
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(272);
              expect(r.balanceY).eq(68);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "95",
                  balanceY: "200"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "45",
                  maxTargetAmount: "120",

                  collateralAmountOut: "27",
                  borrowAmountOut: "72",

                  converter: ethers.Wallet.createRandom().address,
                }],
                prices: {
                  priceX: "2",
                  priceY: "0.5"
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(68);
              expect(r.balanceY).eq(272);
            });
          });
        });

        describe("Current state - direct debt - USDT is borrowed under USDC", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     300 (+540c)   525 (+315c)      480 (+360)
                 * usdt     600 (-360b)   450 (-210b)      480 (-240)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "600",
                    balanceY: "300"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "450",
                    amountRepay: "75",
                    totalCollateralAmountOut: "1080",
                    totalDebtAmountOut: "180",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "150",
                    maxTargetAmount: "25",

                    collateralAmountOut: "90",
                    borrowAmountOut: "15",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "450",
                    amountRepay: "75",
                  }],
                  prices: {
                    priceX: "0.5",
                    priceY: "2"
                  }
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(960);
                expect(r.balanceY).eq(240);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                 * usdt     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "6000",
                    balanceY: "3000"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "1080",
                    amountRepay: "180",
                    totalCollateralAmountOut: "1080",
                    totalDebtAmountOut: "180",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "1050", // 2100 / 1400 = 1.5
                    maxTargetAmount: "2800",

                    collateralAmountOut: "630",
                    borrowAmountOut: "1680",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "180",
                    collateralAmountOut: "1080",
                  }],
                  prices: {
                    priceX: "0.5", // all amounts of USDC in the test were multiplied on 2
                    priceY: "2" // all amounts of USDT in the test were divided on 2
                  }
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(8760);
                expect(r.balanceY).eq(2190);
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     600 (+540c)   600-180=420 (+540+180=720c)
               * usdt     300 (-360b)   300+120=420 (-480b)
               *          sum = 1080    sum = 1080
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "1200",
                  balanceY: "150"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "600",
                  maxTargetAmount: "100", // 300 / 1.5 = 200

                  collateralAmountOut: "360",
                  borrowAmountOut: "60",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  collateralAmountOut: "1080",
                  amountRepay: "180",
                  totalCollateralAmountOut: "1080",
                  totalDebtAmountOut: "180",
                }],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  collateralAmountOut: "1080",
                  amountRepay: "180",
                }],
                prices: {
                  priceX: "0.5", // all amounts of USDC in the test were multiplied on 2
                  priceY: "2" // all amounts of USDT in the test were divided on 2
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(840);
              expect(r.balanceY).eq(210);
            });
          });
        });

        describe("Current state - reverse debt - USDC is borrowed under USDT", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               *          balances (borrow state)
               *          initial       after borrow
               *                        300 => 120 + 180, 180c => 120b
               * usdc     300 (-360c)   300+120=420 (-480b)
               * usdt     600 (+540b)   600-180=420 (+540+180=720c)
               *          sum = 1080    sum = 1080
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                strategyBalances: {
                  balanceX: "600",
                  balanceY: "300"
                },
                borrows: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,

                  collateralAmount: "150",
                  maxTargetAmount: "400", // 300 / 1.5 = 200

                  collateralAmountOut: "90",
                  borrowAmountOut: "240",

                  converter: ethers.Wallet.createRandom().address,
                }],
                repays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  collateralAmountOut: "270",
                  amountRepay: "720",
                  totalCollateralAmountOut: "270",
                  totalDebtAmountOut: "720",
                }],
                quoteRepays: [{
                  collateralAsset: usdt,
                  borrowAsset: usdc,
                  amountRepay: "720",
                  collateralAmountOut: "270",
                }],
                prices: {
                  priceX: "0.5", // all amounts of USDC in the test were multiplied on 2
                  priceY: "2" // all amounts of USDT in the test were divided on 2
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(840);
              expect(r.balanceY).eq(210);
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after direct borrow
                 *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                 * usdc     600 (-360b)   450 (-210b)      480 (-240)
                 * usdt     300 (+540c)   525 (+315c)      480 (+360)
                 *          sum = 1080    sum = 1080       sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "1200",
                    balanceY: "150"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "112.5",
                    amountRepay: "300",
                    totalCollateralAmountOut: "270",
                    totalDebtAmountOut: "720",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "37.5",
                    maxTargetAmount: "100",

                    collateralAmountOut: "22.5",
                    borrowAmountOut: "60",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "300",
                    collateralAmountOut: "112.5",
                  }],
                  prices: {
                    priceX: "0.5", // all amounts of USDC in the test were multiplied on 2
                    priceY: "2" // all amounts of USDT in the test were divided on 2
                  }
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(960);
                expect(r.balanceY).eq(240);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after repay      after reverse borrow
                 *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                 * usdc     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                 * usdt     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                 *          sum = 9180    sum = 9180       sum = 9180
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "12000",
                    balanceY: "1500"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "270",
                    amountRepay: "720",
                    totalCollateralAmountOut: "270",
                    totalDebtAmountOut: "720",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "4200", // 2100 / 1400 = 1.5
                    maxTargetAmount: "700",

                    collateralAmountOut: "2520",
                    borrowAmountOut: "420",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "270",
                    amountRepay: "180",
                  }],
                  prices: {
                    priceX: "0.5", // all amounts of USDC in the test were multiplied on 2
                    priceY: "2" // all amounts of USDT in the test were divided on 2
                  }
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(8760);
                expect(r.balanceY).eq(2190);
              });
            });
          });
        });
      });
      describe("not-zero thresholds", () => {
        describe("Current state - no debts", () => {
          describe("Input amounts >= thresholds", () => {
            describe("Need to increase USDC, reduce USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  thresholdX: 36,
                  thresholdY: 54,
                  strategyBalances: {
                    balanceX: "100",
                    balanceY: "190"
                  },
                  borrows: [{
                    // collateral = 90
                    // We can borrow 60 usdc for 90 usdt, 90/60 = 1.5
                    // We need proportions 1:1
                    // so, 90 => 36 + 54, 54 usdt => 36 usdc
                    // as result we will have 36 usdt and 36 borrowed usdc (with collateral 54 usdt)
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "90",
                    maxTargetAmount: "60",

                    collateralAmountOut: "54",
                    borrowAmountOut: "36",

                    converter: ethers.Wallet.createRandom().address,
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(136);
                expect(r.balanceY).eq(136);
              });
            });
            describe("Need to reduce USDC, increase USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  thresholdX: 54,
                  thresholdY: 36,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "190",
                    balanceY: "100"
                  },
                  borrows: [{
                    // collateral = 90
                    // We can borrow 60 usdt for 90 usdc, 90/60 = 1.5
                    // We need proportions 1:1
                    // so, 90 => 36 + 54, 54 usdc => 36 usdt
                    // as result we will have 36 usdc and 36 borrowed usdt (with collateral 54 usdc)
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "90",
                    maxTargetAmount: "60",

                    collateralAmountOut: "54",
                    borrowAmountOut: "36",

                    converter: ethers.Wallet.createRandom().address,
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(136);
                expect(r.balanceY).eq(136);
              });
            });
          });
          describe("Input amounts < thresholds", () => {
            describe("Need to increase USDC, reduce USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  thresholdX: 36,
                  thresholdY: 54 + 1,
                  strategyBalances: {
                    balanceX: "100",
                    balanceY: "190"
                  },
                  borrows: [{
                    // collateral = 90
                    // We can borrow 60 usdc for 90 usdt, 90/60 = 1.5
                    // We need proportions 1:1
                    // so, 90 => 36 + 54, 54 usdt => 36 usdc
                    // as result we will have 36 usdt and 36 borrowed usdc (with collateral 54 usdt)
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "90",
                    maxTargetAmount: "60",

                    collateralAmountOut: "54",
                    borrowAmountOut: "36",

                    converter: ethers.Wallet.createRandom().address,
                  }]
                })
              }

              it("should not change balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(100);
                expect(r.balanceY).eq(190);
              });
            });
            describe("Need to reduce USDC, increase USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  thresholdX: 54 + 1,
                  thresholdY: 36,
                  proportion: 50_000,
                  strategyBalances: {
                    balanceX: "190",
                    balanceY: "100"
                  },
                  borrows: [{
                    // collateral = 90
                    // We can borrow 60 usdt for 90 usdc, 90/60 = 1.5
                    // We need proportions 1:1
                    // so, 90 => 36 + 54, 54 usdc => 36 usdt
                    // as result we will have 36 usdc and 36 borrowed usdt (with collateral 54 usdc)
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "90",
                    maxTargetAmount: "60",

                    collateralAmountOut: "54",
                    borrowAmountOut: "36",

                    converter: ethers.Wallet.createRandom().address,
                  }]
                })
              }

              it("should not change balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(190);
                expect(r.balanceY).eq(100);
              });
            });
          });
        });

        describe("Current state - direct debt - USDT is borrowed under USDC", () => {
          describe("Input amounts >= thresholds", () => {
            describe("Need to increase USDC, reduce USDT", () => {
              describe("Partial repay and direct borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after direct borrow
                   *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                   * usdc     300 (+540c)   525 (+315c)      480 (+360)
                   * usdt     600 (-360b)   450 (-210b)      480 (-240)
                   *          sum = 1080    sum = 1080       sum = 1080
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 45,
                    thresholdY: 30,
                    strategyBalances: {
                      balanceX: "300",
                      balanceY: "600"
                    },
                    repays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      collateralAmountOut: "225",
                      amountRepay: "150",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,

                      collateralAmount: "75",
                      maxTargetAmount: "50",

                      collateralAmountOut: "45",
                      borrowAmountOut: "30",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      amountRepay: "150",
                      collateralAmountOut: "225",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(480);
                  expect(r.balanceY).eq(480);
                });
              });
              describe("Full repay and reverse borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after reverse borrow
                   *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                   * usdc     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                   * usdt     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                   *          sum = 9180    sum = 9180       sum = 9180
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 840,
                    thresholdY: 1260,
                    strategyBalances: {
                      balanceX: "3000",
                      balanceY: "6000"
                    },
                    repays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      collateralAmountOut: "540",
                      amountRepay: "360",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,

                      collateralAmount: "2100", // 2100 / 1400 = 1.5
                      maxTargetAmount: "1400",

                      collateralAmountOut: "1260",
                      borrowAmountOut: "840",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      amountRepay: "360",
                      collateralAmountOut: "540",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(4380);
                  expect(r.balanceY).eq(4380);
                });
              });
            });
            describe("Need to reduce USDC, increase USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after borrow
                 *                        300 => 120 + 180, 180c => 120b
                 * usdc     600 (+540c)   600-180=420 (+540+180=720c)
                 * usdt     300 (-360b)   300+120=420 (-480b)
                 *          sum = 1080    sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  thresholdX: 180,
                  thresholdY: 120,
                  strategyBalances: {
                    balanceX: "600",
                    balanceY: "300"
                  },
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "300",
                    maxTargetAmount: "200", // 300 / 1.5 = 200

                    collateralAmountOut: "180",
                    borrowAmountOut: "120",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(420);
                expect(r.balanceY).eq(420);
              });
            });
          });
          describe("Input amounts < thresholds", () => {
            describe("Need to increase USDC, reduce USDT", () => {
              describe("Partial repay and direct borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after direct borrow
                   *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                   * usdc     300 (+540c)   525 (+315c)      480 (+360)
                   * usdt     600 (-360b)   450 (-210b)      480 (-240)
                   *          sum = 1080    sum = 1080       sum = 1080
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 45 + 1,
                    thresholdY: 30,
                    strategyBalances: {
                      balanceX: "300",
                      balanceY: "600"
                    },
                    repays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      collateralAmountOut: "225",
                      amountRepay: "150",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,

                      collateralAmount: "75",
                      maxTargetAmount: "50",

                      collateralAmountOut: "45",
                      borrowAmountOut: "30",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      amountRepay: "150",
                      collateralAmountOut: "225",
                    }]
                  })
                }

                it("should make repay and shouldn't make borrow", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(300 + 225);
                  expect(r.balanceY).eq(600 - 150);
                });
              });
              describe("Full repay and reverse borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after reverse borrow
                   *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                   * usdc     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                   * usdt     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                   *          sum = 9180    sum = 9180       sum = 9180
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 840,
                    thresholdY: 1260 + 1,
                    strategyBalances: {
                      balanceX: "3000",
                      balanceY: "6000"
                    },
                    repays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      collateralAmountOut: "540",
                      amountRepay: "360",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,

                      collateralAmount: "2100", // 2100 / 1400 = 1.5
                      maxTargetAmount: "1400",

                      collateralAmountOut: "1260",
                      borrowAmountOut: "840",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,
                      amountRepay: "360",
                      collateralAmountOut: "540",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(3000 + 540);
                  expect(r.balanceY).eq(6000 - 360);
                });
              });
            });
            describe("Need to reduce USDC, increase USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after borrow
                 *                        300 => 120 + 180, 180c => 120b
                 * usdc     600 (+540c)   600-180=420 (+540+180=720c)
                 * usdt     300 (-360b)   300+120=420 (-480b)
                 *          sum = 1080    sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  thresholdX: 180 + 1,
                  thresholdY: 120,
                  strategyBalances: {
                    balanceX: "600",
                    balanceY: "300"
                  },
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "300",
                    maxTargetAmount: "200", // 300 / 1.5 = 200

                    collateralAmountOut: "180",
                    borrowAmountOut: "120",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(600);
                expect(r.balanceY).eq(300);
              });
            });
          });
        });

        describe("Current state - reverse debt - USDC is borrowed under USDT", () => {
          describe("Input amounts >= thresholds", () => {
            describe("Need to increase USDC, reduce USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after borrow
                 *                        300 => 120 + 180, 180c => 120b
                 * usdc     300 (-360c)   300+120=420 (-480b)
                 * usdt     600 (+540b)   600-180=420 (+540+180=720c)
                 *          sum = 1080    sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  thresholdX: 120,
                  thresholdY: 180,
                  strategyBalances: {
                    balanceX: "300",
                    balanceY: "600"
                  },
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "300",
                    maxTargetAmount: "200", // 300 / 1.5 = 200

                    collateralAmountOut: "180",
                    borrowAmountOut: "120",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(420);
                expect(r.balanceY).eq(420);
              });
            });
            describe("Need to reduce USDC, increase USDT", () => {
              describe("Partial repay and direct borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after direct borrow
                   *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                   * usdc     600 (-360b)   450 (-210b)      480 (-240)
                   * usdt     300 (+540c)   525 (+315c)      480 (+360)
                   *          sum = 1080    sum = 1080       sum = 1080
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 30,
                    thresholdY: 45,
                    strategyBalances: {
                      balanceX: "600",
                      balanceY: "300"
                    },
                    repays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      collateralAmountOut: "225",
                      amountRepay: "150",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,

                      collateralAmount: "75",
                      maxTargetAmount: "50",

                      collateralAmountOut: "45",
                      borrowAmountOut: "30",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      amountRepay: "150",
                      collateralAmountOut: "225",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(480);
                  expect(r.balanceY).eq(480);
                });
              });
              describe("Full repay and reverse borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after reverse borrow
                   *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                   * usdc     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                   * usdt     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                   *          sum = 9180    sum = 9180       sum = 9180
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 2100,
                    thresholdY: 1400,
                    strategyBalances: {
                      balanceX: "6000",
                      balanceY: "3000"
                    },
                    repays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      collateralAmountOut: "540",
                      amountRepay: "360",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,

                      collateralAmount: "2100", // 2100 / 1400 = 1.5
                      maxTargetAmount: "1400",

                      collateralAmountOut: "1260",
                      borrowAmountOut: "840",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      amountRepay: "360",
                      collateralAmountOut: "540",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(6000 - 360);
                  expect(r.balanceY).eq(3000 + 540);
                });
              });
            });
          });
          describe("Input amounts < thresholds", () => {
            describe("Need to increase USDC, reduce USDT", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 *          balances (borrow state)
                 *          initial       after borrow
                 *                        300 => 120 + 180, 180c => 120b
                 * usdc     300 (-360c)   300+120=420 (-480b)
                 * usdt     600 (+540b)   600-180=420 (+540+180=720c)
                 *          sum = 1080    sum = 1080
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  thresholdX: 120,
                  thresholdY: 180 + 1,
                  strategyBalances: {
                    balanceX: "300",
                    balanceY: "600"
                  },
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "300",
                    maxTargetAmount: "200", // 300 / 1.5 = 200

                    collateralAmountOut: "180",
                    borrowAmountOut: "120",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "540",
                    amountRepay: "360",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(300);
                expect(r.balanceY).eq(600);
              });
            });
            describe("Need to reduce USDC, increase USDT", () => {
              describe("Partial repay and direct borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after direct borrow
                   *                        150 => 225       75 => 30 + 45, 45c => 30b (45/30 = 1.5)
                   * usdc     600 (-360b)   450 (-210b)      480 (-240)
                   * usdt     300 (+540c)   525 (+315c)      480 (+360)
                   *          sum = 1080    sum = 1080       sum = 1080
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 30,
                    thresholdY: 45 + 1,
                    strategyBalances: {
                      balanceX: "600",
                      balanceY: "300"
                    },
                    repays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      collateralAmountOut: "225",
                      amountRepay: "150",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,

                      collateralAmount: "75",
                      maxTargetAmount: "50",

                      collateralAmountOut: "45",
                      borrowAmountOut: "30",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      amountRepay: "150",
                      collateralAmountOut: "225",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(600 - 150);
                  expect(r.balanceY).eq(300 + 225);
                });
              });
              describe("Full repay and reverse borrow are required", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                  /**
                   *          balances (borrow state)
                   *          initial       after repay      after reverse borrow
                   *                        360 => 540       2100 => 840 + 1260, 1260c => 840b (1260/840 = 1.5), 2100/2.5==840
                   * usdc     6000 (-360b)   5640 (-0b)      5640-1260=4380 (+1260)
                   * usdt     3000 (+540c)   3540 (+0c)      3540+840=4380 (-840b)
                   *          sum = 9180    sum = 9180       sum = 9180
                   */
                  return makeRebalanceAssets({
                    tokenX: usdc,
                    tokenY: usdt,
                    proportion: 50_000,
                    thresholdX: 2100 + 1,
                    thresholdY: 1400,
                    strategyBalances: {
                      balanceX: "6000",
                      balanceY: "3000"
                    },
                    repays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      collateralAmountOut: "540",
                      amountRepay: "360",
                      totalCollateralAmountOut: "540",
                      totalDebtAmountOut: "360",
                    }],
                    borrows: [{
                      collateralAsset: usdc,
                      borrowAsset: usdt,

                      collateralAmount: "2100", // 2100 / 1400 = 1.5
                      maxTargetAmount: "1400",

                      collateralAmountOut: "1260",
                      borrowAmountOut: "840",

                      converter: ethers.Wallet.createRandom().address,
                    }],
                    quoteRepays: [{
                      collateralAsset: usdt,
                      borrowAsset: usdc,
                      amountRepay: "360",
                      collateralAmountOut: "540",
                    }]
                  })
                }

                it("should set expected balances", async () => {
                  const r = await loadFixture(makeRebalanceAssetsTest);
                  expect(r.balanceX).eq(6000 - 360);
                  expect(r.balanceY).eq(3000 + 540);
                });
              });
            });
          });
        });
      });
    });

    describe("addition0 != 0", () => {
      describe("same prices, equal decimals", () => {
        describe("Current state - no debts", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Current balance > addition0", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  additionX: "50",
                  strategyBalances: {
                    balanceX: "150",
                    balanceY: "190"
                  },
                  borrows: [{
                    // collateral = 90
                    // We can borrow 60 usdc for 90 usdt, 90/60 = 1.5
                    // We need proportions 1:1
                    // so, 90 => 36 + 54, 54 usdt => 36 usdc
                    // as result we will have 36 usdt and 36 borrowed usdc (with collateral 54 usdt)
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "90",
                    maxTargetAmount: "60",

                    collateralAmountOut: "54",
                    borrowAmountOut: "36",

                    converter: ethers.Wallet.createRandom().address,
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(150+36);
                expect(r.balanceY).eq(190-54);
              });
            });
            describe("Current balance < addition0", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  additionX: "10",
                  strategyBalances: {
                    balanceX: "0",
                    balanceY: "120"
                  },
                  // 10*(100000+300)/100000 = 10.03
                  // Swap 10.03 USDT to 10.03 USDC. This is a ProfitToCover amount.
                  // After swap, we will have 109.97 USDT
                  // 109.97 USDT = C => gamma*C [USDC] + (1-gamma)*C*alpha [USDT]
                  // where alpha = 1.5 (we can borrow 60 usdc for 90 usdt, 90/60 = 1.5)
                  // proportions x:y = 1:1
                  // (1*1/1.5*109.97) / (109.97*(1+1/1.5)) = 0.4
                  // => gamma = 0.4
                  // 43.988 USDT is left on balance, 65.982 USDT is used as collateral
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "109.97",
                    maxTargetAmount: "73.313333", // 109.97 / 1.5

                    collateralAmountOut: "65.982",
                    borrowAmountOut: "43.987999",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "10.03", amountOut: "10.03"}]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(10.03 + 43.987999);
                expect(r.balanceY).eq(43.988);
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                additionX: "10",
                strategyBalances: {
                  balanceX: "200",
                  balanceY: "100"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 usdt for 90 usdc, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 usdc => 36 usdt
                  // as result we will have 36 usdc and 36 borrowed usdt (with collateral 54 usdc)
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "90",
                  maxTargetAmount: "60",

                  collateralAmountOut: "54",
                  borrowAmountOut: "36",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(146);
              expect(r.balanceY).eq(136);
            });
          });
        });

        describe("Current state - direct debt - USDT is borrowed under USDC", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Partial repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 * We have balances: 30 USDC, 80 USDT
                 * Required costs are: (40 + 35) and 35
                 * To get 45 USDC, we should repay at least 45 USDT
                 *
                 * Repay 45 USDT and receive 67.5 USDC of collateral
                 * Balances: USDC = 67.5 + 30, USDT = 35
                 * USDC = 40 + 57.5. 40 USDC is addition, we put aside it.
                 * Now we need to reallocate 57.5 USDC + 35 USDT to right proportions.
                 * Borrow 22.5 USDC using entry kind 1
                 * 22,5 => 9 USDC + 13.5 USDC
                 *      13.5 USDC => 9 USDT
                 * As results, we have balance
                 *  84 USDC = 57.5-22.5 + 9 + 40
                 *  44 USDT = 35 + 9
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  additionX: "40",
                  strategyBalances: {
                    balanceX: "30",
                    balanceY: "80"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "67.5",
                    amountRepay: "45",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "22.5",
                    maxTargetAmount: "15",

                    collateralAmountOut: "13.5",
                    borrowAmountOut: "9",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "360",
                    collateralAmountOut: "540",
                  }],
                  liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "10", amountOut: "10" }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(84); // 57.5-22.5+9 + 40
                expect(r.balanceY).eq(44);
              });
            });
            describe("Full repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 * We have balances: 30 USDC, 80 USDT
                 * Required costs are: (40 + 35) and 35
                 * To get 45 USDC, we should repay at least 45 USDT
                 * But the debt is only 15
                 * *
                 * Repay 15 USDT and receive 22.5 USDC of collateral
                 * Balances: USDC = 22.5 + 30 = 52.5, USDT = 80-15=65
                 * USDC = 40 + 12.5, 40 USDC is addition, we put aside it.
                 * Now we need to reallocate 12.5 USDC + 65 USDT to right proportions.
                 * Borrow 52.5 USDT using entry kind 1
                 * 52,5 => 21 USDT + 31.5 USDT
                 *         31.5 USDT => 21 USDC
                 * As results, we have balance
                 *  73.5 USDC = 12.5 + 21 + 40
                 *  33.5 USDT = 65 - 31.5
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  additionX: "40",
                  strategyBalances: {
                    balanceX: "30",
                    balanceY: "80"
                  },
                  repays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    collateralAmountOut: "22.5",
                    amountRepay: "15",
                    totalCollateralAmountOut: "22.5",
                    totalDebtAmountOut: "15",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "52.5",
                    maxTargetAmount: "35", // 52.5 / 1.5

                    collateralAmountOut: "31.5",
                    borrowAmountOut: "21",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    amountRepay: "15",
                    collateralAmountOut: "22.5",
                  }],
                  liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "10", amountOut: "10" }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(73.5);
                expect(r.balanceY).eq(33.5);
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              /**
               * We have balances: 80 USDC, 30 USDT
               * Required costs are: (40 + 35) and 35
               * We can put aside 40 USDC. Without 40 USDC we have the following balances:
               * 40 USDC, 30 USDT
               *
               * Now we need to reallocate 40 USDC + 30 USDT to right proportions.
               * Borrow 10 USDC using entry kind 1
               * 10 => 4 USDC + 6 USDC
               *       6 USDC => 4 USDT
               * As results, we have balance
               *  34 USDC = 40 - 6
               *  34 USDT = 30 + 4
               */
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: usdt,
                proportion: 50_000,
                additionX: "40",
                strategyBalances: {
                  balanceX: "80",
                  balanceY: "30"
                },
                borrows: [{
                  collateralAsset: usdc,
                  borrowAsset: usdt,

                  collateralAmount: "10",
                  maxTargetAmount: "6.666666",

                  collateralAmountOut: "6",
                  borrowAmountOut: "3.999999",

                  converter: ethers.Wallet.createRandom().address,
                }],
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(34 + 40);
              expect(r.balanceY).eq(33.999999);
            });
          });
        });

        describe("Current state - reverse debt - USDC is borrowed under USDT", () => {
          describe("Need to reduce USDC, increase USDT", () => {
            describe("Partial repay and reverse borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 * We have balances: 80 USDC, 30 USDT
                 * Required costs are: (40 + 35) and 35
                 * Now we need to reallocate 40 USDC + 30 USDT to right proportions.
                 * Repay 5 USDC to get 7.5 USDT
                 * Balances: 35 USDC, 37.5 USDT
                 * Borrow 2.5 USDT using entry kind 1
                 * 2,5 => 1 USDT + 1.5 USDT
                 *        1.5 USDT => 1 USDC
                 * As results, we have balance
                 *  76 USDC = 80 - 5 + 1
                 *  36 USDT = 30 + 7.5 - 1.5
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  additionX: "40",
                  strategyBalances: {
                    balanceX: "80",
                    balanceY: "30"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "7.5",
                    amountRepay: "5",
                    totalCollateralAmountOut: "540",
                    totalDebtAmountOut: "360",
                  }],
                  borrows: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,

                    collateralAmount: "2.5",
                    maxTargetAmount: "1.666666",

                    collateralAmountOut: "1.5",
                    borrowAmountOut: "0.999999",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "5",
                    collateralAmountOut: "7.5",
                  }],
                  liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "10", amountOut: "10" }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(75.999999);
                expect(r.balanceY).eq(36);
              });
            });
            describe("Full repay and direct borrow are required", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                /**
                 * We have balances: 80 USDC, 30 USDT
                 * Required costs are: (40 + 35) and 35
                 * Now we need to reallocate 40 USDC + 30 USDT to right proportions.
                 * We need to repay 5 USDC to get 7.5 USDT, but we have debt only 1 USDC
                 * Repay 1 USDC, get 1.5 USDT
                 * Balances: 39 USDC, 31.5 USDT
                 * Borrow 7.5 USDC using entry kind 1
                 * 7,5 => 3 USDC + 4.5 USDC
                 *        4.5 USDC => 3 USDT
                 * As results, we have balance
                 *  74.5 USDC = 80 - 1 - 4.5
                 *  34.5 USDT = 30 + 1.5 + 3
                 */
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: usdt,
                  proportion: 50_000,
                  additionX: "40",
                  strategyBalances: {
                    balanceX: "80",
                    balanceY: "30"
                  },
                  repays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    collateralAmountOut: "1.5",
                    amountRepay: "1",
                    totalCollateralAmountOut: "1.5",
                    totalDebtAmountOut: "1",
                  }],
                  borrows: [{
                    collateralAsset: usdc,
                    borrowAsset: usdt,

                    collateralAmount: "7.5",
                    maxTargetAmount: "5",

                    collateralAmountOut: "4.5",
                    borrowAmountOut: "3",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  quoteRepays: [{
                    collateralAsset: usdt,
                    borrowAsset: usdc,
                    amountRepay: "1",
                    collateralAmountOut: "1.5",
                  }],
                  liquidations: [{tokenIn: usdc, tokenOut: usdt, amountIn: "10", amountOut: "10" }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(74.5);
                expect(r.balanceY).eq(34.5);
              });
            });
          });
        });

      });
      describe("different prices, different decimals", () => {
        describe("Current state - no debts", () => {
          describe("Need to increase USDC, reduce USDT", () => {
            describe("Current balance > addition0", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: tetu,
                  proportion: 50_000,
                  additionX: "25",
                  strategyBalances: {
                    balanceX: "75",
                    balanceY: "380"
                  },
                  prices:{
                    priceX: "2",
                    priceY: "0.5"
                  },
                  borrows: [{
                    // collateral = 90
                    // We can borrow 60 usdc for 90 tetu, 90/60 = 1.5
                    // We need proportions 1:1
                    // so, 90 => 36 + 54, 54 tetu => 36 usdc
                    // as result we will have 36 tetu and 36 borrowed usdc (with collateral 54 tetu)
                    collateralAsset: tetu,
                    borrowAsset: usdc,

                    collateralAmount: "180",
                    maxTargetAmount: "30",

                    collateralAmountOut: "108",
                    borrowAmountOut: "18",

                    converter: ethers.Wallet.createRandom().address,
                  }]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq((150+36) / 2);
                expect(r.balanceY).eq((190-54) * 2);
              });
            });
            describe("Current balance < addition0", () => {
              let snapshot: string;
              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
                return makeRebalanceAssets({
                  tokenX: usdc,
                  tokenY: tetu,
                  proportion: 50_000,
                  additionX: "5",
                  prices:{
                    priceX: "2",
                    priceY: "0.5"
                  },
                  strategyBalances: {
                    balanceX: "0",
                    balanceY: "240"
                  },
                  // 10*(100000+300)/100000 = 10.03
                  // Swap 10.03 USDT to 10.03 USDC. This is a ProfitToCover amount.
                  // After swap, we will have 109.97 USDT
                  // 109.97 USDT = C => gamma*C [USDC] + (1-gamma)*C*alpha [USDT]
                  // where alpha = 1.5 (we can borrow 60 usdc for 90 usdt, 90/60 = 1.5)
                  // proportions x:y = 1:1
                  // (1*1/1.5*109.97) / (109.97*(1+1/1.5)) = 0.4
                  // => gamma = 0.4
                  // 43.988 USDT is left on balance, 65.982 USDT is used as collateral
                  borrows: [{
                    collateralAsset: tetu,
                    borrowAsset: usdc,

                    collateralAmount: "219.94",
                    maxTargetAmount: "36.656666", // 109.97 / 1.5

                    collateralAmountOut: "131.964000960000006983",
                    borrowAmountOut: "21.993999",

                    converter: ethers.Wallet.createRandom().address,
                  }],
                  liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "20.06", amountOut: "5.015"}]
                })
              }

              it("should set expected balances", async () => {
                const r = await loadFixture(makeRebalanceAssetsTest);
                expect(r.balanceX).eq(27.008999); // == (10.03 + 43.987999) / 2
                expect(r.balanceY).approximately(87.975999, 1e-6); // === 43.988 * 2
              });
            });
          });
          describe("Need to reduce USDC, increase USDT", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: tetu,
                proportion: 50_000,
                prices:{
                  priceX: "2",
                  priceY: "0.5"
                },
                additionX: "5",
                strategyBalances: {
                  balanceX: "100",
                  balanceY: "200"
                },
                borrows: [{
                  // collateral = 90
                  // We can borrow 60 usdt for 90 usdc, 90/60 = 1.5
                  // We need proportions 1:1
                  // so, 90 => 36 + 54, 54 usdc => 36 usdt
                  // as result we will have 36 usdc and 36 borrowed usdt (with collateral 54 usdc)
                  collateralAsset: usdc,
                  borrowAsset: tetu,

                  collateralAmount: "45",
                  maxTargetAmount: "120",

                  collateralAmountOut: "27",
                  borrowAmountOut: "72",

                  converter: ethers.Wallet.createRandom().address,
                }]
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              expect(r.balanceX).eq(146/2);
              expect(r.balanceY).eq(136*2);
            });
          });
        });
      });
    });

  });
//endregion Unit tests
});