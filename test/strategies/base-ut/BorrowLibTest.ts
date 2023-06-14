import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowLibFacade,
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken, PriceOracleMock
} from "../../../typechain";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {IBorrowParamsNum, IQuoteRepayParams, IRepayParams} from "../../baseUT/mocks/TestDataTypes";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {setupMockedBorrowEntryKind1, setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";
import {
  Misc
} from "../../../scripts/utils/Misc";

describe('BorrowLibTest', () => {
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

      // prepare borrow/repay
      if (p.borrows) {
        for (const borrow of p.borrows) {
          await setupMockedBorrowEntryKind1(
            converter,
            facade.address,
            borrow,
            borrow.collateralAsset === p.tokenX
              ? p.proportion
              : 100_000 - p.proportion,
            borrow.collateralAsset === p.tokenX
              ? 100_000 - p.proportion
              : p.proportion,
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

      // make rebalancing
      await facade.rebalanceAssets(converter.address, p.tokenX.address, p.tokenY.address, p.proportion);

      // get results
      return {
        balanceX: +formatUnits(await p.tokenX.balanceOf(facade.address), await p.tokenX.decimals()),
        balanceY: +formatUnits(await p.tokenY.balanceOf(facade.address), await p.tokenY.decimals()),
      }
    }

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

                collateralAmountOut: "499.999999", // 500 / 400 = 1.25
                borrowAmountOut: "399.999999",

                converter: ethers.Wallet.createRandom().address,
              }]
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            expect(r.balanceX).eq(100.000001);
            expect(r.balanceY).eq(399.999999);
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
  });
//endregion Unit tests
});