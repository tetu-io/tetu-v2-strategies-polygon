import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {defaultAbiCoder, formatUnits, parseUnits} from 'ethers/lib/utils';
import {ConverterStrategyBaseLibFacade, MockToken, PriceOracleMock} from '../../../typechain';
import {expect} from 'chai';
import {MockHelper} from '../../baseUT/helpers/MockHelper';
import {Misc} from "../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {
  IBorrowParamsNum, IConversionValidationParams,
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams,
  ITokenAmountNum
} from "../../baseUT/mocks/TestDataTypes";
import {
  setupIsConversionValid,
  setupIsConversionValidDetailed,
  setupMockedLiquidation
} from "../../baseUT/mocks/MockLiquidationUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {
  setupMockedBorrow,
  setupMockedQuoteRepay,
  setupMockedRepay
} from "../../baseUT/mocks/MockRepayUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_OPEN_POSITION,
  GET_GET_COLLATERALS
} from "../../baseUT/GasLimits";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {areAlmostEqual} from "../../baseUT/utils/MathUtils";
import {HardhatUtils, HARDHAT_NETWORK_ID} from '../../baseUT/utils/HardhatUtils';

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 *
 * Following tests are created using fixtures, not snapshots
 */
describe('ConverterStrategyBaseLibTest', () => {
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let bal: MockToken;
  let unknown: MockToken;
  let facade: ConverterStrategyBaseLibFacade;
  let mapTokenByAddress: Map<string, MockToken>;
  //endregion Variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseLibFacade(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 18);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
    bal = await DeployerUtils.deployMockToken(signer, 'BAL');
    unknown = await DeployerUtils.deployMockToken(signer, 'unknown');
    console.log("usdc", usdc.address);
    console.log("dai", dai.address);
    console.log("tetu", tetu.address);
    console.log("weth", weth.address);
    console.log("usdt", usdt.address);
    console.log("bal", bal.address);
    mapTokenByAddress = new Map<string, MockToken>();
    mapTokenByAddress.set(usdc.address, usdc);
    mapTokenByAddress.set(tetu.address, tetu);
    mapTokenByAddress.set(dai.address, dai);
    mapTokenByAddress.set(weth.address, weth);
    mapTokenByAddress.set(usdt.address, usdt);
    mapTokenByAddress.set(bal.address, bal);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
  //endregion before, after

  //region Unit tests
  describe("openPositionEntryKind1", () => {
    let snapshot: string;
    before(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IOpenPositionEntryKind1TestParams {
      threshold: number,
      borrows?: {
        converter: string;
        collateralAsset: MockToken;
        collateralAmount: BigNumber;
        borrowAsset: MockToken;
        amountToBorrow: BigNumber;
      }[];
      findBorrowStrategyOutputs?: {
        entryData: string;
        sourceToken: string;
        amountIn: BigNumber;
        targetToken: string;

        converters: string[];
        collateralAmountsOut: BigNumber[];
        amountToBorrowsOut: BigNumber[];
        aprs18: BigNumber[];
      }[];
      amountBorrowAssetForTetuConverter: BigNumber;
      amountCollateralForFacade: BigNumber;
      amountInIsCollateral: boolean;
      prices: {
        collateral: BigNumber;
        borrow: BigNumber;
      };
    }

    interface IOpenPositionEntryKind1TestResults {
      collateralAmountOut: BigNumber;
      borrowedAmountOut: BigNumber;
      gasUsed: BigNumber;
      balanceBorrowAssetTetuConverter: BigNumber;
      balanceCollateralAssetFacade: BigNumber;
    }

    async function makeOpenPositionEntryKind1Test(
      entryData: string,
      collateralAsset: MockToken,
      borrowAsset: MockToken,
      amountIn: BigNumber,
      params: IOpenPositionEntryKind1TestParams,
    ): Promise<IOpenPositionEntryKind1TestResults> {
      const converter = await MockHelper.createMockTetuConverter(signer);

      if (params.borrows) {
        for (const b of params.borrows) {
          await converter.setBorrowParams(
            b.converter,
            b.collateralAsset.address,
            b.collateralAmount,
            b.borrowAsset.address,
            b.amountToBorrow,
            ethers.Wallet.createRandom().address,
            b.amountToBorrow,
          );
        }
      }

      if (params.findBorrowStrategyOutputs) {
        for (const b of params.findBorrowStrategyOutputs) {
          await converter.setFindBorrowStrategyOutputParams(
            b.entryData,
            b.converters,
            b.collateralAmountsOut,
            b.amountToBorrowsOut,
            b.aprs18,
            b.sourceToken,
            b.amountIn,
            b.targetToken,
            1, // period
          );
        }
      }

      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        [collateralAsset.address, borrowAsset.address],
        [params.prices.collateral, params.prices.borrow],
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(controller.address);

      await collateralAsset.mint(facade.address, params.amountCollateralForFacade);
      await borrowAsset.mint(converter.address, params.amountBorrowAssetForTetuConverter);

      if (params.amountInIsCollateral) {
        await collateralAsset.connect(await Misc.impersonate(facade.address)).approve(converter.address, amountIn);
      } else {
        await borrowAsset.connect(await Misc.impersonate(facade.address)).approve(converter.address, amountIn);
      }
      const ret = await facade.callStatic.openPositionEntryKind1(
        converter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        params.threshold,
      );

      const tx = await facade.openPositionEntryKind1(
        converter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        params.threshold,
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        collateralAmountOut: ret.collateralAmountOut,
        borrowedAmountOut: ret.borrowedAmountOut,
        gasUsed,
        balanceBorrowAssetTetuConverter: await borrowAsset.balanceOf(converter.address),
        balanceCollateralAssetFacade: await collateralAsset.balanceOf(facade.address),
      };
    }

    describe("openPositionEntryKind1 (SCB-621)", () => {
      /**
       * https://dashboard.tenderly.co/tx/polygon/0x00b1287431f89a85879007f8a2a80d79976f818813718e5a122c29eadf430afe/debugger?trace=0.0.1.0.0.0.2.1.2.0.2.0.0.0.0.3.11.8.0
       * There were 3 borrows instead 1
       */
      async function reproduceError(threshold: number): Promise<IOpenPositionEntryKind1TestResults> {
        const entryData1 = "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f4366000000000000000000000000000000000000000000000000000000000000d93e";
        return makeOpenPositionEntryKind1Test(
          entryData1,
          usdc,
          usdt,
          BigNumber.from("194495951"),
          {
            threshold,
            borrows: [
              {
                collateralAsset: usdc,
                collateralAmount: BigNumber.from("13606564"),
                borrowAsset: usdt,
                amountToBorrow: BigNumber.from("10052591"),
                converter: "0x14b8ffeb2484b01ca66d521b2a7a59628817aa53",
              },
              {
                collateralAsset: usdc,
                collateralAmount: BigNumber.from("2"),
                borrowAsset: usdt,
                amountToBorrow: BigNumber.from("1"),
                converter: "0x7d6ad97865258f11f1f31fb3b9b8838d1bce5bce",
              },
            ],
            findBorrowStrategyOutputs: [
              {
                converters: ["0x14b8ffeb2484b01ca66d521b2a7a59628817aa53", "0x7d6ad97865258f11f1f31fb3b9b8838d1bce5bce", "0x34a379bf1514e1a93179cdfe8dd4555d7822e91b"],
                sourceToken: usdc.address,
                targetToken: usdt.address,
                entryData: entryData1,
                aprs18: [BigNumber.from("-1481796327407567"), BigNumber.from("-192674234045099"), BigNumber.from("831344681206963")],
                amountIn: BigNumber.from("194495951"),
                collateralAmountsOut: [BigNumber.from("13606564"), BigNumber.from("13606564"), BigNumber.from("13606564")],
                amountToBorrowsOut: [BigNumber.from("10052591"), BigNumber.from("10115580"), BigNumber.from("10143568")],
              },
            ],
            amountCollateralForFacade: BigNumber.from("194495951"),
            amountBorrowAssetForTetuConverter: BigNumber.from("10052592"),
            amountInIsCollateral: true,
            prices: {
              collateral: BigNumber.from("1000082050000000000"),
              borrow: BigNumber.from("1000523100000000000")
            }
          },
        );
      }

      async function reproduceErrorSingleBorrow(): Promise<IOpenPositionEntryKind1TestResults> {
        return reproduceError(0);
      }

      async function reproduceErrorTwoBorrows(): Promise<IOpenPositionEntryKind1TestResults> {
        return reproduceError(10);
      }

      it('should make two borrows if threshold is 0', async () => {
        const r = await loadFixture(reproduceErrorSingleBorrow);

        expect(r.collateralAmountOut).eq(BigNumber.from("13606566")); // (!) 64 + 2 = 66 (two borrows)
        expect(r.borrowedAmountOut).eq(BigNumber.from("10052592")); // (!) 91 + 1 = 92 (two borrows)
      });
      it('should make single borrow if threshold is 10', async () => {
        const r = await loadFixture(reproduceErrorTwoBorrows);

        expect(r.collateralAmountOut).eq(BigNumber.from("13606564")); // (!) 64 (single borrow)
        expect(r.borrowedAmountOut).eq(BigNumber.from("10052591")); // (!) 91 (single borrow)
      });
    });
    describe("Platform with best APR has not enough resources", () => {
      async function makeTestFirstPlatformHasNotEnoughResources(): Promise<IOpenPositionEntryKind1TestResults> {
        // platform with the highest APR and not enough resources
        const problemPlatform = ethers.Wallet.createRandom().address;

        const entryData1 = "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f4366000000000000000000000000000000000000000000000000000000000000d93e";
        return makeOpenPositionEntryKind1Test(
          entryData1,
          usdc,
          usdt,
          BigNumber.from("194495951"),
          {
            threshold: 10,
            borrows: [
              {
                collateralAsset: usdc,
                collateralAmount: BigNumber.from("13606564"),
                borrowAsset: usdt,
                amountToBorrow: BigNumber.from("10052591"),
                converter: "0x14b8ffeb2484b01ca66d521b2a7a59628817aa53",
              },
              {
                collateralAsset: usdc,
                collateralAmount: BigNumber.from("2"),
                borrowAsset: usdt,
                amountToBorrow: BigNumber.from("1"),
                converter: "0x7d6ad97865258f11f1f31fb3b9b8838d1bce5bce",
              },
            ],
            findBorrowStrategyOutputs: [
              {
                sourceToken: usdc.address,
                targetToken: usdt.address,
                entryData: entryData1,
                amountIn: BigNumber.from("194495951"),
                converters: [problemPlatform, "0x14b8ffeb2484b01ca66d521b2a7a59628817aa53", "0x7d6ad97865258f11f1f31fb3b9b8838d1bce5bce", "0x34a379bf1514e1a93179cdfe8dd4555d7822e91b"],
                aprs18: [parseUnits("-1", 18), BigNumber.from("-1481796327407567"), BigNumber.from("-192674234045099"), BigNumber.from("831344681206963")],
                collateralAmountsOut: [BigNumber.from("7"), BigNumber.from("13606564"), BigNumber.from("13606564"), BigNumber.from("13606564")],
                amountToBorrowsOut: [BigNumber.from("5"), BigNumber.from("10052591"), BigNumber.from("10115580"), BigNumber.from("10143568")],
              },
            ],
            amountCollateralForFacade: BigNumber.from("194495951"),
            amountBorrowAssetForTetuConverter: BigNumber.from("10052592"),
            amountInIsCollateral: true,
            prices: {
              collateral: BigNumber.from("1000082050000000000"),
              borrow: BigNumber.from("1000523100000000000")
            }
          },
        );
      }

      it('should ignore first platform and make single borrow on the second platform', async () => {
        const r = await loadFixture(makeTestFirstPlatformHasNotEnoughResources);

        expect(r.collateralAmountOut).eq(BigNumber.from("13606564")); // (!) 64 (single borrow)
        expect(r.borrowedAmountOut).eq(BigNumber.from("10052591")); // (!) 91 (single borrow)
      });
    });
    describe("No converters are available", () => {
      async function makeTest(): Promise<IOpenPositionEntryKind1TestResults> {
        const entryData1 = "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f4366000000000000000000000000000000000000000000000000000000000000d93e";
        return makeOpenPositionEntryKind1Test(
          entryData1,
          usdc,
          usdt,
          BigNumber.from("194495951"),
          {
            threshold: 0,
            borrows: [],
            findBorrowStrategyOutputs: [
              {
                converters: [],
                sourceToken: usdc.address,
                targetToken: usdt.address,
                entryData: entryData1,
                aprs18: [],
                amountIn: BigNumber.from("194495951"),
                collateralAmountsOut: [],
                amountToBorrowsOut: [],
              },
            ],
            amountCollateralForFacade: BigNumber.from("194495951"),
            amountBorrowAssetForTetuConverter: BigNumber.from("10052592"),
            amountInIsCollateral: true,
            prices: {
              collateral: BigNumber.from("1000082050000000000"),
              borrow: BigNumber.from("1000523100000000000")
            }
          },
        );
      }

      it('should make two borrows if threshold is 0', async () => {
        const r = await loadFixture(makeTest);

        expect(r.collateralAmountOut).eq(BigNumber.from("0"));
        expect(r.borrowedAmountOut).eq(BigNumber.from("0"));
      });
    });
  });

  describe("closePositionsToGetAmount", () => {
    interface IClosePositionToGetRequestedAmountResults {
      expectedBalance: number;
      gasUsed: BigNumber;
      balances: number[];
    }

    interface IClosePositionToGetRequestedAmountParams {
      requestedAmount: string;
      tokens: MockToken[];
      indexAsset: number;
      balances: string[];
      prices: string[];
      liquidationThresholds: string[];
      liquidations: ILiquidationParams[];
      quoteRepays: IQuoteRepayParams[];
      repays: IRepayParams[];
      isConversionValid?: boolean;
    }

    async function makeClosePositionToGetRequestedAmountTest(
      p: IClosePositionToGetRequestedAmountParams
    ): Promise<IClosePositionToGetRequestedAmountResults> {
      // set up balances
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);

        // set up current balances
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], d));
        console.log("mint", i, p.balances[i]);

        // set up liquidation threshold for token
        await facade.setLiquidationThreshold(p.tokens[i].address, parseUnits(p.liquidationThresholds[i], d));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);
      const priceOracle = (await DeployerUtils.deployContract(
        signer,
        'PriceOracleMock',
        p.tokens.map(x => x.address),
        p.prices.map(x => parseUnits(x, 18))
      )) as PriceOracleMock;
      const tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(tetuConverterController.address);

      // set up repay
      for (const repay of p.repays) {
        await setupMockedRepay(converter, facade.address, repay);
      }
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }

      // set up expected liquidations
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      const pool = ethers.Wallet.createRandom().address;
      const swapper = ethers.Wallet.createRandom().address;
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation, pool, swapper);
        const isConversionValid = p.isConversionValid === undefined ? true : p.isConversionValid;
        await setupIsConversionValid(converter, liquidation, isConversionValid)
      }

      // make test
      const ret = await facade.callStatic.closePositionsToGetAmount(
        converter.address,
        liquidator.address,
        p.indexAsset,
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexAsset]),
        p.tokens.map(x => x.address),
      );

      const tx = await facade.closePositionsToGetAmount(
        converter.address,
        liquidator.address,
        p.indexAsset,
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexAsset]),
        p.tokens.map(x => x.address),
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedBalance: +formatUnits(ret, decimals[p.indexAsset]),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(facade.address), decimals[index])
          )
        )
      }
    }

    describe("Good paths", () => {
      describe("Direct debt only", () => {
        describe("Partial repayment, balance > toSell", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "500", // usdc
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["2000", "910"], // usdc, dai
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{
                amountIn: "1010", // usdc, 500/(1.5-1)*101/100
                amountOut: "1010", // dai, for simplicity we assume same prices
                tokenIn: usdc,
                tokenOut: dai
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "1920",
                collateralAmountOut: "2880"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "1920", // dai // 1010 + 910
                collateralAmountOut: "2880", // 1920 / 2000 * 3000
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedBalance).eq(2000 + 1870); // 2000 + 2880 - 1010
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([3870, 0].join()); // 2880 + 2000 - 1010
          });
        });
        describe("Partial repayment, balance < toSell", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "1500", // usdc
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["300", "0"], // usdc, dai
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{
                amountIn: "300", // usdc, 500/(1.5-1)*101/100=1010, but we have only 300 on balance
                amountOut: "300", // dai, for simplicity we assume same prices
                tokenIn: usdc,
                tokenOut: dai
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "300",
                collateralAmountOut: "450"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "300", // dai
                collateralAmountOut: "450", // 300 / 2000 * 3000
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedBalance).eq(300 + 150); // 450
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([450, 0].join());
          });
        });
        describe("Full repayment of the borrow", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "1000000", // usdc - we need as much as possible USDC
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                { // _getAmountToSell gives 2020 instead 2000, so 20 exceed usdc will be exchanged
                  // we need second liquidation to exchange them back
                  amountIn: "2020", // usdc, 2000 + 1%, see _getAmountToSell
                  amountOut: "2020", // dai
                  tokenIn: usdc,
                  tokenOut: dai
                }, {
                  amountIn: "20", // dai
                  amountOut: "20", // usdc
                  tokenIn: dai,
                  tokenOut: usdc
                }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000",
                collateralAmountOut: "3000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000", // dai
                collateralAmountOut: "3000", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected expectedBalance", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            // see SCB-779 fix inside _closePositionsToGetAmount for details of calculations
            expect(r.expectedBalance).eq(6000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([6000, 0].join());
          });
        });
        describe("QuoteRepay != repay", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "1000000", // usdc - we need as much as possible USDC
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{
                amountIn: "2020", // usdc, 2000 + 1%, see _getAmountToSell
                amountOut: "2000", // dai
                tokenIn: usdc,
                tokenOut: dai
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000",
                collateralAmountOut: "2800" // (!) 3000
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000", // dai
                collateralAmountOut: "3000", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedBalance).eq(5000 + 2800 - 2020);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([5980, 0].join());
          });
        });
        describe("Not zero liquidation threshold", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "1000000", // usdc - we need as much as possible USDC
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "1999"], // (!) less than amoutOut in liquidation
              liquidations: [{
                amountIn: "2020", // usdc, 2000 + 1%, see _getAmountToSell
                amountOut: "2000", // dai
                tokenIn: usdc,
                tokenOut: dai
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000",
                collateralAmountOut: "2800" // (!) 3000
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000", // dai
                collateralAmountOut: "3000", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedBalance).eq(5000 + 2800 - 2020);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([5980, 0].join());
          });
        });
        describe("requestedAmount is max uint", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "", // MAX_UINT, usdc
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{
                amountIn: "2020", // usdc, 2000 + 1%, see _getAmountToSell
                amountOut: "2000", // dai
                tokenIn: usdc,
                tokenOut: dai
              }],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000",
                collateralAmountOut: "3000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "2000", // dai
                collateralAmountOut: "3000", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedBalance).eq(5000 + 3000 - 2020);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([5980, 0].join());
          });
        });
      });
      describe("Reverse debt only", () => {
        describe("Partial repayment, balance > toSell", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            /**
             * Initially: 1010 dai, 400 usdc, debt (2000 dai borrowed under 3000 usdc)
             * Convert 1010 dai to 1010 usdc
             * Now we have 1410 usdc, less than required 1411. Make next swap-repay
             * Convert 1010+400 usdc to 2115 dai
             * Convert 2115 dai to 2115 usdc
             */
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "1411", // usdc
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["400", "1010"], // usdc, dai
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{
                amountIn: "1010", // dai, 500/(1.5-1)*101/100
                amountOut: "1010", // usdc, for simplicity we assume same prices
                tokenIn: dai,
                tokenOut: usdc
              }, {
                amountIn: "2115",
                amountOut: "2115",
                tokenIn: dai,
                tokenOut: usdc
              }],
              quoteRepays: [{
                collateralAsset: dai,
                borrowAsset: usdc,
                amountRepay: "1410",
                collateralAmountOut: "2115"
              }],
              repays: [{
                collateralAsset: dai,
                borrowAsset: usdc,
                amountRepay: "1410", // usdc / 1010 + 400
                collateralAmountOut: "2115", // 1410 / 2000 * 3000
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected expectedBalance", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedBalance).eq(2115);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([2115, 0].join()); // 2880 + 2000 - 1010
          });
        });
        describe("SCB-787: swap1, repay1, swap2, stop (required amount of USDC is received)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "0.001789", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["0.000484", "0.001279"], // usdc, dai
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0.001", "0.001"],
              liquidations: [
                {tokenIn: usdt, tokenOut: usdc, amountIn: "0.001279", amountOut: "0.001277"},
                {tokenIn: usdt, tokenOut: usdc, amountIn: "0.002132", amountOut: "0.002130"},
              ],
              quoteRepays: [
                {collateralAsset: usdt, borrowAsset: usdc, amountRepay: "0.001761", collateralAmountOut: "0.002132"},
              ],
              repays: [{
                collateralAsset: usdt,
                borrowAsset: usdc,
                totalDebtAmountOut: "234.316595",
                totalCollateralAmountOut: "280.962168",
                amountRepay: "0.001761",
                collateralAmountOut: "0.002132",
              }]
            });
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([0.002130, 0].join());
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Zero balance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["0", "0"], // usdc, dai - we don't have USDC at all
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "0"],
            liquidations: [],
            quoteRepays: [],
            repays: [],
          });
        }

        it("should return zero expected amount", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedBalance).eq(0);
        });
        it("should not change balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([0, 0].join());
        });
      });
      describe("Zero requested amount", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should return zero expected amount", async () => {
          const r = await makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "0", // (!)
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["0", "0"], // usdc, dai - we don't have USDC at all
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "0"],
            liquidations: [],
            quoteRepays: [],
            repays: [],
          });
          expect(r.expectedBalance).eq(0);
        });
      });
      describe("There are no debts", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "0"],
            liquidations: [],
            quoteRepays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "0",
              collateralAmountOut: "0"
            }],
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "0", // dai
              collateralAmountOut: "0", // usdc
              totalDebtAmountOut: "0",
              totalCollateralAmountOut: "0"
            }],
          });
        }

        it("should return expected value", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedBalance).eq(5000);
        });
        it("should not change balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([5000, 0].join());
        });
      });
      describe("Liquidation threshold is too high to sell", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["2100", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["2101", "0"], // (!) the threshold for USDC is higher than amountIn
            liquidations: [{
              amountIn: "2000", // usdc
              amountOut: "2000", // dai
              tokenIn: usdc,
              tokenOut: dai
            }],
            quoteRepays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "2000",
              collateralAmountOut: "3000"
            }],
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "2000", // dai
              collateralAmountOut: "3000", // usdc
              totalDebtAmountOut: "2000",
              totalCollateralAmountOut: "3000"
            }],
          });
        }

        it("should return expected value", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedBalance).eq(2100);
        });
        it("should not change balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([2100, 0].join());
        });
      });
      describe("Liquidation threshold is too high to swap", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "10000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["8000", "3000"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "3001"], // (!) the threshold for DAI is higher than token balance
            liquidations: [{
              amountIn: "3000", // dai
              amountOut: "3000", // usdc
              tokenIn: dai,
              tokenOut: usdc
            }],
            quoteRepays: [],
            repays: [],
          });
        }

        it("should return expected value", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedBalance).eq(8000);
        });
        it("should not change balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([8000, 3000].join());
        });
      });
    });
  });

  describe("liquidate", () => {
    interface ILiquidationTestResults {
      spentAmountIn: number;
      receivedAmountOut: number;
      gasUsed: BigNumber;
      balanceTokenIn: number;
      balanceTokenOut: number;
    }

    interface ILiquidationTestParams {
      tokens: MockToken[];
      balances: string[];
      prices: string[];
      liquidationThreshold: string;
      liquidation: ILiquidationParams;
      isConversionValid?: boolean;
      slippage?: number;
      noLiquidationRoute?: boolean;
      skipConversionValidation?: boolean;
    }

    async function makeLiquidationTest(p: ILiquidationTestParams): Promise<ILiquidationTestResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        // set up current balances
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
        console.log("mint", i, p.balances[i]);
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);
      const priceOracle = (await DeployerUtils.deployContract(
        signer,
        'PriceOracleMock',
        p.tokens.map(x => x.address),
        p.prices.map(x => parseUnits(x, 18))
      )) as PriceOracleMock;
      const tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(tetuConverterController.address);

      // set up expected liquidations
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      if (!p.noLiquidationRoute) {
        await setupMockedLiquidation(liquidator, p.liquidation);
      }
      await setupIsConversionValid(
        converter,
        p.liquidation,
        p.isConversionValid === undefined
          ? true
          : p.isConversionValid
      )

      // make test
      const ret = await facade.callStatic.liquidate(
        converter.address,
        liquidator.address,
        p.liquidation.tokenIn.address,
        p.liquidation.tokenOut.address,
        parseUnits(p.liquidation.amountIn, await p.liquidation.tokenIn.decimals()),
        p.slippage || 10_000,
        parseUnits(p.liquidationThreshold, await p.liquidation.tokenIn.decimals()),
        p?.skipConversionValidation || false
      );

      const tx = await facade.liquidate(
        converter.address,
        liquidator.address,
        p.liquidation.tokenIn.address,
        p.liquidation.tokenOut.address,
        parseUnits(p.liquidation.amountIn, await p.liquidation.tokenIn.decimals()),
        p.slippage || 10_000,
        parseUnits(p.liquidationThreshold, await p.liquidation.tokenIn.decimals()),
        p?.skipConversionValidation || false
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        spentAmountIn: +formatUnits(ret.spentAmountIn, await p.liquidation.tokenIn.decimals()),
        receivedAmountOut: +formatUnits(ret.receivedAmountOut, await p.liquidation.tokenOut.decimals()),
        gasUsed,
        balanceTokenIn: +formatUnits(await p.liquidation.tokenIn.balanceOf(facade.address), await p.liquidation.tokenIn.decimals()),
        balanceTokenOut: +formatUnits(await p.liquidation.tokenOut.balanceOf(facade.address), await p.liquidation.tokenOut.decimals()),
      }
    }

    describe("Good paths", () => {
      describe("Amount in > liquidation threshold", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeLiquidationFixture(): Promise<ILiquidationTestResults> {
          return makeLiquidationTest({
            tokens: [usdc, dai],
            balances: ["1000", "2000"],
            prices: ["1", "1"],
            liquidation: {
              tokenIn: usdc,
              tokenOut: dai,
              amountIn: "400",
              amountOut: "800",
            },
            liquidationThreshold: "399",
          });
        }

        it("should return expected amounts", async () => {
          const r = await loadFixture(makeLiquidationFixture);
          expect(r.spentAmountIn).eq(400);
          expect(r.receivedAmountOut).eq(800);
        });
        it("should set expected balances", async () => {
          const r = await loadFixture(makeLiquidationFixture);
          expect(r.balanceTokenIn).eq(600);
          expect(r.balanceTokenOut).eq(2800);
        });
      });
      describe("Amount in < liquidation threshold", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeLiquidationFixture(): Promise<ILiquidationTestResults> {
          return makeLiquidationTest({
            tokens: [usdc, dai],
            balances: ["1000", "2000"],
            prices: ["1", "1"],
            liquidation: {
              tokenIn: usdc,
              tokenOut: dai,
              amountIn: "400",
              amountOut: "800",
            },
            liquidationThreshold: "401", // (!)
          });
        }

        it("should return expected amounts", async () => {
          const r = await loadFixture(makeLiquidationFixture);
          expect(r.spentAmountIn).eq(0);
          expect(r.receivedAmountOut).eq(0);
        });
        it("should set expected balances", async () => {
          const r = await loadFixture(makeLiquidationFixture);
          expect(r.balanceTokenIn).eq(1000);
          expect(r.balanceTokenOut).eq(2000);
        });
      });
      describe("Conversion validation is disabled", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should revert if price impact is too high", async () => {
          const r = await makeLiquidationTest({
            tokens: [usdc, dai],
            balances: ["1000", "2000"],
            prices: ["1", "1"],
            liquidation: {
              tokenIn: usdc,
              tokenOut: dai,
              amountIn: "400",
              amountOut: "800",
            },
            liquidationThreshold: "399",
            isConversionValid: false, // price impact is too high
            skipConversionValidation: true // .. but validation is skipped
          });
          expect(r.spentAmountIn).eq(400);
          expect(r.receivedAmountOut).eq(800);
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

      it("should revert if price impact is too high", async () => {
        await expect(makeLiquidationTest({
          tokens: [usdc, dai],
          balances: ["1000", "2000"],
          prices: ["1", "1"],
          liquidation: {
            tokenIn: usdc,
            tokenOut: dai,
            amountIn: "400",
            amountOut: "800",
          },
          liquidationThreshold: "399",
          isConversionValid: false // (!) price impact is too high
        })).revertedWith("TS-16 price impact"); // PRICE_IMPACT
      });
      it("should revert if no liquidation route", async () => {
        await expect(makeLiquidationTest({
          tokens: [usdc, dai],
          balances: ["1000", "2000"],
          prices: ["1", "1"],
          liquidation: {
            tokenIn: usdc,
            tokenOut: dai,
            amountIn: "400",
            amountOut: "800",
          },
          noLiquidationRoute: true,
          liquidationThreshold: "399",
          isConversionValid: false // (!) price impact is too high
        })).revertedWith("TS-15 No liquidation route");
      });
    });
  });

  describe("_getAmountToSell", () => {
    interface IGetAmountToSellResults {
      amountOut: number;
    }

    interface IGetAmountToSellParams {
      remainingRequestedAmount: string;
      totalDebt: string;
      totalCollateral: string;
      prices: string[];
      decimals: number[];
      indexCollateral: number;
      balanceBorrowAsset: string;
    }

    async function makeGetAmountToSellTest(p: IGetAmountToSellParams): Promise<IGetAmountToSellResults> {
      const indexBorrowAsset = p.indexCollateral === 0 ? 1 : 0;
      const amountOut = await facade._getAmountToSell(
        parseUnits(p.remainingRequestedAmount, p.decimals[p.indexCollateral]),
        parseUnits(p.totalDebt, p.decimals[indexBorrowAsset]),
        parseUnits(p.totalCollateral, p.decimals[p.indexCollateral]),
        p.prices.map(x => parseUnits(x, 18)),
        p.decimals.map(x => parseUnits("1", x)),
        p.indexCollateral,
        indexBorrowAsset,
        parseUnits(p.balanceBorrowAsset, p.decimals[indexBorrowAsset]),
      );
      return {
        amountOut: +formatUnits(amountOut, p.decimals[p.indexCollateral])
      };
    }

    describe("Good paths", () => {
      describe("balanceBorrowAsset == 0", () => {
        describe("usdc=$1, dai=$0.5", () => {
          describe("collateral > requested amount", () => {
            it("should return expected value", async () => {
              const r = await makeGetAmountToSellTest({
                indexCollateral: 0,
                decimals: [6, 18], // usdc, dai
                prices: ["1", "0.5"], // assume prices 1:2
                totalDebt: "1000",
                totalCollateral: "3000", // assume health factor is 1.5
                remainingRequestedAmount: "800",
                balanceBorrowAsset: "0"
              });
              // alpha = 2e30, (alpha18 * totalCollateral / totalDebt - 1e18) = 5e18
              expect(r.amountOut).eq(161.6); // 160 * 101/100
            });
          });
          describe("collateral = requested amount", () => {
            it("should return expected value", async () => {
              const r = await makeGetAmountToSellTest({
                indexCollateral: 0,
                decimals: [6, 18], // usdc, dai
                prices: ["1", "0.5"], // assume prices 1:2
                totalDebt: "1000", // [dai] == 500 USDC
                totalCollateral: "3000", // assume health factor is 1.5
                remainingRequestedAmount: "3000",
                balanceBorrowAsset: "0"
              });
              // alpha = 2e30, (alpha18 * totalCollateral / totalDebt - 1e18) = 5e18

              // 600 * 101/100 = 606 > max allowed 500 usdc, so 500
              // but _getAmountToSell adds +1%, so 505
              expect(r.amountOut).eq(505);
            });
          });
        });
        describe("tetu=$0.02, usdt=$2", () => {
          describe("collateral > requested amount", () => {
            it("should return expected value", async () => {
              const r = await makeGetAmountToSellTest({
                indexCollateral: 0,
                decimals: [18, 6], // tetu, usdt
                prices: ["0.02", "2"],
                totalDebt: "400", // === $800
                totalCollateral: "50000", // === $1000
                remainingRequestedAmount: "2500", // === $50
                balanceBorrowAsset: "0"
              });
              // 2500e18/(0.02*1e6*1e18/2/1e18*50000e18/400e6-1e18)*101/100 = 10100
              expect(r.amountOut).eq(10100); // 10100
            });
          });
          describe("collateral = requested amount", () => {
            it("should return expected value", async () => {
              const r = await makeGetAmountToSellTest({
                indexCollateral: 0,
                decimals: [18, 6], // tetu, usdt
                prices: ["0.02", "2"],
                totalDebt: "400", // === $800
                totalCollateral: "50000", // === $1000
                remainingRequestedAmount: "50000", // === $1000
                balanceBorrowAsset: "0"
              });
              // 50000e18/(0.02*1e6*1e18/2/1e18*50000e18/400e6-1e18)*101/100 = 202000 > 50000
              // 400e6*1e18/(0.02*1e6*1e18/2/1e18)/1e18 = 40000 === $800
              expect(r.amountOut).eq(40400); // == $800 == totalDebt + 1%, === 40000 + 1%
            });
          });
        });
      });
      describe("balanceBorrowAsset != 0", () => {
        describe("tetu=$0.02, usdt=$2", () => {
          describe("collateral > requested amount", () => {
            it("should return expected value", async () => {
              const r = await makeGetAmountToSellTest({
                indexCollateral: 0,
                decimals: [18, 6], // tetu, usdt
                prices: ["0.02", "2"],
                totalDebt: "450", // === $900
                totalCollateral: "60000", // === $1200
                remainingRequestedAmount: "2500", // === $50
                balanceBorrowAsset: "45" // It will reduce debt and collateral: debt=405 ($810), collateral=54000 ($1080)
              });
              // 2500e18/(0.02*1e6*1e18/2/1e18*54000e18/405e6-1e18)*101/100
              expect(r.amountOut).eq(7575);
            });
          });
          describe("collateral = requested amount", () => {
            it("should return expected value", async () => {
              const r = await makeGetAmountToSellTest({
                indexCollateral: 0,
                decimals: [18, 6], // tetu, usdt
                prices: ["0.02", "2"],
                totalDebt: "450", // === $900
                totalCollateral: "60000", // === $1200
                remainingRequestedAmount: "50000", // === $1000
                balanceBorrowAsset: "45" // It will reduce debt and collateral: debt=405 ($810), collateral=54000 ($1080)
              });
              // 50000e18/(0.02*1e6*1e18/2/1e18*54000e18/405e6-1e18)*101/100 = 151500 > 50000
              // 405e6*1e18/(0.02*1e6*1e18/2/1e18)/1e18 = 40500 === $810
              expect(r.amountOut).eq(40905); // == $810 == totalDebt - balanceBorrowAsset + 1%, == 40500 + 1%
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      it("should return zero if the debt is zero", async () => {
        const r = await makeGetAmountToSellTest({
          indexCollateral: 0,
          decimals: [6, 18],
          prices: ["1", "0.5"],
          totalDebt: "0", // (!) all debts were already paid
          totalCollateral: "3000",
          remainingRequestedAmount: "800",
          balanceBorrowAsset: "0"
        });
        expect(r.amountOut).eq(0);
      });
      it("should return zero if the collateral is zero", async () => {
        const r = await makeGetAmountToSellTest({
          indexCollateral: 0,
          decimals: [6, 18],
          prices: ["1", "0.5"],
          totalDebt: "1000",
          totalCollateral: "0", // (!) liquidation happens
          remainingRequestedAmount: "800",
          balanceBorrowAsset: "0"
        });
        expect(r.amountOut).eq(0);
      });
    });
  });

  describe("sendTokensToForwarder", () => {
    let snapshot: string;
    before(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISendTokensToForwarderParams {
      tokens: MockToken[];
      amounts: string[];
      vault: string;
      thresholds?: string[];
    }

    interface ISendTokensToForwarderResults {
      tokensOut: string[];
      amountsOut: number[];

      allowanceForForwarder: number[];
      tokensToForwarder: string[];
      amountsToForwarder: number[];
      splitterToForwarder: string;
      isDistributeToForwarder: boolean;
    }

    async function makeSendTokensToForwarderTest(p: ISendTokensToForwarderParams): Promise<ISendTokensToForwarderResults> {
      const controller = await MockHelper.createMockController(signer);
      const forwarder = await MockHelper.createMockForwarder(signer);
      await controller.setForwarder(forwarder.address);
      const splitter = await MockHelper.createMockSplitter(signer);
      await splitter.setVault(p.vault);
      const thresholds = p.thresholds ?? p.tokens.map(x => "0");

      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        decimals.push(await p.tokens[i].decimals());
        await p.tokens[i].mint(facade.address, parseUnits(p.amounts[i], decimals[i]));
      }

      const ret = await facade.callStatic.sendTokensToForwarder(
        controller.address,
        splitter.address,
        p.tokens.map(x => x.address),
        p.amounts.map((amount, index) => parseUnits(amount, decimals[index])),
        thresholds.map((threshold, index) => parseUnits(threshold, decimals[index])),
      );

      await facade.sendTokensToForwarder(
        controller.address,
        splitter.address,
        p.tokens.map(x => x.address),
        p.amounts.map((amount, index) => parseUnits(amount, decimals[index])),
        thresholds.map((threshold, index) => parseUnits(threshold, decimals[index])),
      );

      const r = await forwarder.getLastRegisterIncomeResults();
      return {
        tokensOut: ret.tokensOut,
        amountsOut: await Promise.all(
          ret.amountsOut.map(
            async (amount, index) => +formatUnits(
              amount,
              await IERC20Metadata__factory.connect(ret.tokensOut[index], signer).decimals()
            )
          )
        ),

        amountsToForwarder: await Promise.all(
          r.amounts.map(
            async (amount, index) => +formatUnits(
              amount,
              await IERC20Metadata__factory.connect(r.tokens[index], signer).decimals()
            )
          )
        ),
        tokensToForwarder: r.tokens,
        isDistributeToForwarder: r.isDistribute,
        splitterToForwarder: r.vault,
        allowanceForForwarder: await Promise.all(
          r.tokens.map(
            async (token, index) => +formatUnits(
              await IERC20Metadata__factory.connect(token, signer).allowance(facade.address, forwarder.address),
              decimals[index])
          ),
        )
      }
    }

    describe("normal case", () => {
      const VAULT = ethers.Wallet.createRandom().address;

      async function makeSendTokensToForwarderFixture(): Promise<ISendTokensToForwarderResults> {
        return makeSendTokensToForwarderTest({
          tokens: [usdc, usdt, dai, tetu],
          amounts: ["100", "1", "5000", "5"],
          vault: VAULT
        });
      }

      it("forwarder should receive expected tokens", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.tokensToForwarder.join()).eq([usdc.address, usdt.address, dai.address, tetu.address].join());
      });
      it("forwarder should receive expected amounts", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.amountsToForwarder.join()).eq([100, 1, 5000, 5].join());
      });
      it("forwarder should receive expected allowance", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        const gt: boolean[] = [];
        for (let i = 0; i < r.tokensToForwarder.length; ++i) {
          gt.push(r.allowanceForForwarder[i] >= r.amountsToForwarder[i]);
        }
        expect(gt.join()).eq([true, true, true, true].join());
      });
      it("forwarder should receive isDistribute=true", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.isDistributeToForwarder).eq(true);
      });
      it("should return expected tokens", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.tokensToForwarder.join()).eq([usdc.address, usdt.address, dai.address, tetu.address].join());
      });
      it("should return expected tokensOut", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.tokensOut.join()).eq([usdc.address, usdt.address, dai.address, tetu.address].join());
      });
      it("should return expected amountsOut", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.amountsOut.join()).eq([100, 1, 5000, 5].join());
      });
    });
    describe("zero case", () => {
      const VAULT = ethers.Wallet.createRandom().address;

      async function makeSendTokensToForwarderFixture(): Promise<ISendTokensToForwarderResults> {
        return makeSendTokensToForwarderTest({
          tokens: [usdc, usdt, dai, tetu],
          amounts: ["100", "0", "5000", "0"],
          vault: VAULT
        });
      }

      it("should filter out zero tokens", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.tokensToForwarder.join()).eq([usdc.address, dai.address].join());
      });
      it("should filter out zero amounts", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.amountsToForwarder.join()).eq([100, 5000].join());
      });
      it("forwarder should receive expected allowance", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        const gt: boolean[] = [];
        for (let i = 0; i < r.tokensToForwarder.length; ++i) {
          gt.push(r.allowanceForForwarder[i] >= r.amountsToForwarder[i]);
        }
        expect(gt.join()).eq([true, true].join());
      });
    });
    describe("not zero thresholds", () => {
      const VAULT = ethers.Wallet.createRandom().address;

      async function makeSendTokensToForwarderFixture(): Promise<ISendTokensToForwarderResults> {
        return makeSendTokensToForwarderTest({
          tokens: [usdc, usdt, dai, tetu],
          amounts: ["100", "1", "5000", "5"],
          vault: VAULT,
          thresholds: ["101", "0.5", "4999", "6"]
        });
      }

      it("forwarder should receive expected tokens", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.tokensToForwarder.join()).eq([usdt.address, dai.address].join());
      });
      it("forwarder should receive expected amounts", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.amountsToForwarder.join()).eq([1, 5000].join());
      });
      it("forwarder should receive expected allowance", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        const gt: boolean[] = [];
        for (let i = 0; i < r.tokensToForwarder.length; ++i) {
          gt.push(r.allowanceForForwarder[i] >= r.amountsToForwarder[i]);
        }
        expect(gt.join()).eq([true, true].join());
      });
      it("should return expected tokensOut", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.tokensOut.join()).eq([usdt.address, dai.address].join());
      });
      it("should return expected amountsOut", async () => {
        const r = await loadFixture(makeSendTokensToForwarderFixture);
        expect(r.amountsOut.join()).eq([1, 5000].join());
      });
    });
  });

  describe("_recycle", () => {
    interface IRecycleTestParams {
      compoundRatio: number;

      tokens: MockToken[];
      assetIndex: number;

      liquidations: ILiquidationParams[];
      thresholds?: ITokenAmountNum[];
      initialBalances: ITokenAmountNum[];

      rewardTokens: MockToken[];
      rewardAmounts: string[];

      isConversionValid?: boolean;
      isConversionValidDetailed?: IConversionValidationParams[];

      performanceFee: number;
    }

    interface IRecycleTestResults {
      gasUsed: BigNumber;

      amountsToForward: string[];
      amountToPerformanceAndInsurance: string;

      tokenBalances: string[];
      rewardTokenBalances: string[];
    }

    async function makeRecycle(p: IRecycleTestParams): Promise<IRecycleTestResults> {
      // read decimals
      const decimals: number[] = [];
      for (let i = 0; i < p.rewardTokens.length; ++i) {
        decimals.push(await p.rewardTokens[i].decimals());
      }

      // set up thresholds
      const thresholds = p.rewardTokens.map(x => "0");
      if (p.thresholds) {
        for (const thresholdInfo of p.thresholds) {
          for (let i = 0; i < p.rewardTokens.length; ++i) {
            if (p.rewardTokens[i] === thresholdInfo.token) {
              thresholds[i] = thresholdInfo.amount;
            }
          }
        }
      }

      // set up initial balances
      for (const b of p.initialBalances) {
        await b.token.mint(facade.address, parseUnits(b.amount, await b.token.decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up expected liquidations
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
        if (!p.isConversionValidDetailed) {
          await setupIsConversionValid(
            converter,
            liquidation,
            p.isConversionValid === undefined
              ? true
              : p.isConversionValid
          )
        }
      }

      if (p.isConversionValidDetailed) {
        for (const cv of p.isConversionValidDetailed) {
          await setupIsConversionValidDetailed(converter, cv);
        }
      }

      // make test
      const {amountsToForward, amountToPerformanceAndInsurance} = await facade.callStatic._recycle(
        converter.address,
        p.tokens[p.assetIndex].address,
        p.compoundRatio,
        p.tokens.map(x => x.address),
        liquidator.address,
        thresholds.map((x, index) => parseUnits(x, decimals[index])),
        p.rewardTokens.map(x => x.address),
        await p.rewardAmounts.map((amount, index) => parseUnits(amount, decimals[index])),
        p.performanceFee
      );
      console.log(amountsToForward, amountToPerformanceAndInsurance);

      const tx = await facade._recycle(
        converter.address,
        p.tokens[p.assetIndex].address,
        p.compoundRatio,
        p.tokens.map(x => x.address),
        liquidator.address,
        thresholds.map((x, index) => parseUnits(x, decimals[index])),
        p.rewardTokens.map(x => x.address),
        await p.rewardAmounts.map((amount, index) => parseUnits(amount, decimals[index])),
        p.performanceFee
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        gasUsed,
        amountsToForward: await Promise.all(amountsToForward.map(
          async (amount, index) => (+formatUnits(amount, await p.rewardTokens[index].decimals())).toString()
        )),
        amountToPerformanceAndInsurance: (+formatUnits(amountToPerformanceAndInsurance, await p.tokens[p.assetIndex].decimals())).toString(),
        tokenBalances: await Promise.all(p.tokens.map(
          async t => (+formatUnits(await t.balanceOf(facade.address), await t.decimals())).toString()
        )),
        rewardTokenBalances: await Promise.all(p.rewardTokens.map(
          async t => (+formatUnits(await t.balanceOf(facade.address), await t.decimals())).toString()
        )),
      }
    }

    describe('Good paths', () => {
      describe("performance fee == 0", () => {
        describe("single reward token", () => {
          describe("Reward token is underlying", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc],
                rewardAmounts: ["100"],
                initialBalances: [
                  {token: usdt, amount: "1"},
                  {token: usdc, amount: "102"},
                  {token: dai, amount: "3"}
                ],
                compoundRatio: 90_000,
                liquidations: [],
                performanceFee: 0
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["10"].join());
            });
            it("should not change balances of secondary depositor assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["1", "102", "3"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["102"].join());
            });
          });
          describe("Reward token belongs to the list of depositor tokens", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [dai],
                rewardAmounts: ["100"],
                initialBalances: [
                  {token: usdt, amount: "1"},
                  {token: usdc, amount: "2"},
                  {token: dai, amount: "103"}
                ],
                compoundRatio: 90_000,
                liquidations: [],
                performanceFee: 0
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["10"].join());
            });
            it("should not change balances of secondary depositor assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["1", "2", "103"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["103"].join());
            });
          });
          describe("Reward doesn't token belong to the list of depositor tokens", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [tetu],
                rewardAmounts: ["100"],
                initialBalances: [
                  {token: usdt, amount: "1"},
                  {token: usdc, amount: "2"},
                  {token: dai, amount: "3"},
                  {token: tetu, amount: "108"}
                ],
                compoundRatio: 90_000,
                liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "90", amountOut: "97"}],
                performanceFee: 0
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["10"].join());
            });
            it("should not change balances of secondary depositor assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["1", "99", "3"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["18"].join());
            });
          });
        });
        describe("multiple reward tokens", () => {
          describe("Normal case - a lot of various reward tokens", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc, usdt, weth, dai, tetu],
                rewardAmounts: ["100", "200", "300", "400", "500"],
                initialBalances: [
                  {token: usdc, amount: "10100"},
                  {token: usdt, amount: "20200"},
                  {token: weth, amount: "301"},  // 1 is dust token, we never use it
                  {token: dai, amount: "30400"},
                  {token: tetu, amount: "502"},  // 2 are dust tokens, we never use them
                ],
                compoundRatio: 10_000,
                liquidations: [
                  {tokenIn: weth, amountIn: "30", tokenOut: usdc, amountOut: "33"},
                  {tokenIn: tetu, amountIn: "50", tokenOut: usdc, amountOut: "55"},
                ],
                performanceFee: 0
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["90", "180", "270", "360", "450"].join());
            });
            it("should not change balances of secondary depositior assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["20200", "10188", "30400"].join()); // 10100+33+55 = 10188
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10188", "20200", "271", "30400", "452"].join()); // 10100+33+55 = 10188
            });
          });
          describe("Compound ratio is zero", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc, usdt, weth, dai, tetu],
                rewardAmounts: ["100", "200", "300", "400", "500"],
                initialBalances: [
                  {token: usdc, amount: "10100"},
                  {token: usdt, amount: "20200"},
                  {token: weth, amount: "301"},  // 1 is dust token, we never use it
                  {token: dai, amount: "30400"},
                  {token: tetu, amount: "502"},  // 2 are dust tokens, we never use them
                ],
                compoundRatio: 0, // (!) edge case
                liquidations: [],
                performanceFee: 0
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["100", "200", "300", "400", "500"].join());
            });
            it("should not change balances of secondary depositior assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["20200", "10100", "30400"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10100", "20200", "301", "30400", "502"].join());
            });
          });
          describe("Compound ratio is 100%", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc, usdt, weth, dai, tetu],
                rewardAmounts: ["100", "200", "300", "400", "500"],
                initialBalances: [
                  {token: usdc, amount: "10100"},
                  {token: usdt, amount: "20200"},
                  {token: weth, amount: "301"},  // 1 is dust token, we never use it
                  {token: dai, amount: "30400"},
                  {token: tetu, amount: "502"},  // 2 are dust tokens, we never use them
                ],
                compoundRatio: 100_000, // (!) edge case
                liquidations: [
                  {tokenIn: weth, amountIn: "300", tokenOut: usdc, amountOut: "330"},
                  {tokenIn: tetu, amountIn: "500", tokenOut: usdc, amountOut: "550"},
                ],
                performanceFee: 0
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["0", "0", "0", "0", "0"].join());
            });
            it("should not change balances of secondary depositior assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["20200", "10980", "30400"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10980", "20200", "1", "30400", "2"].join());
            });
          });
        });
      });
      describe("performance fee > 0", () => {
        describe("single reward token", () => {
          describe("Reward token is underlying", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc],
                rewardAmounts: ["200"],
                initialBalances: [
                  {token: usdt, amount: "1"},
                  {token: usdc, amount: "202"},
                  {token: dai, amount: "3"}
                ],
                compoundRatio: 80_000,
                liquidations: [],
                performanceFee: 40_000
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["24"].join());
            });
            it("should not change balances of secondary depositor assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["1", "202", "3"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["202"].join());
            });
            it("should return expected amountToPerformanceAndInsurance", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountToPerformanceAndInsurance).eq("80");
            });
          });
          describe("Reward token belongs to the list of depositor tokens", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [dai],
                rewardAmounts: ["100"],
                initialBalances: [
                  {token: usdt, amount: "1"},
                  {token: usdc, amount: "2"},
                  {token: dai, amount: "103"}
                ],
                compoundRatio: 90_000,
                liquidations: [{amountIn: "10", amountOut: "8", tokenIn: dai, tokenOut: usdc}],
                performanceFee: 10_000
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["9"].join());
            });
            it("should not change balances of secondary depositor assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["1", "10", "93"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["93"].join());
            });
            it("should return expected amountToPerformanceAndInsurance", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountToPerformanceAndInsurance).eq("8");
            });
          });
          describe("Reward doesn't token belong to the list of depositor tokens", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [tetu],
                rewardAmounts: ["100"],
                initialBalances: [
                  {token: usdt, amount: "1"},
                  {token: usdc, amount: "2"},
                  {token: dai, amount: "3"},
                  {token: tetu, amount: "108"}
                ],
                compoundRatio: 90_000,
                liquidations: [
                  {tokenIn: tetu, tokenOut: usdc, amountIn: "98", amountOut: "97"}
                ],
                performanceFee: 80_000
              });
            }

            // 100 => 80 P + 18 C + 2 F

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["2"].join());
            });
            it("should not change balances of secondary depositor assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["1", "99", "3"].join());
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10"].join());
            });
            it("should return expected amountToPerformanceAndInsurance", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountToPerformanceAndInsurance).eq("79.183673"); // 97 * 80/(80 + 18)
            });
          });
        });
        describe("multiple reward tokens", () => {
          describe("Normal case - a lot of various reward tokens", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc, usdt, weth, dai, tetu],
                rewardAmounts: ["100", "200", "300", "400", "500"],
                initialBalances: [
                  {token: usdc, amount: "10100"},
                  {token: usdt, amount: "20200"},
                  {token: weth, amount: "301"},  // 1 is dust token, we never use it
                  {token: dai, amount: "30400"},
                  {token: tetu, amount: "502"},  // 2 are dust tokens, we never use them
                ],
                compoundRatio: 10_000,
                liquidations: [
                  {tokenIn: weth, amountIn: "57", tokenOut: usdc, amountOut: "33"},
                  {tokenIn: tetu, amountIn: "95", tokenOut: usdc, amountOut: "55"},
                  {tokenIn: usdt, amountIn: "20", tokenOut: usdc, amountOut: "7"},
                  {tokenIn: dai, amountIn: "40", tokenOut: usdc, amountOut: "11"},
                ],
                performanceFee: 10_000
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["81", "162", "243", "324", "405"].join());
            });
            it("should subtract performance fee from balances of depositor secondary assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["20180", "10206", "30360"].join()); // 9090+33+55 = 9178
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10206", "20180", "244", "30360", "407"].join()); // 10100+33+55+7+11 = 10206
            });
            it("should return expected amountToPerformanceAndInsurance", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountToPerformanceAndInsurance).eq("74.315789"); // 7 + 11 + 100*0.1+33*(300*0.1/(300*0.1+300*0.9*0.1))+55*(500*0.1/(500*0.1+500*0.9*0.1))
            });
          });
          describe("Compound ratio is zero", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc, usdt, weth, dai, tetu],
                rewardAmounts: ["100", "200", "300", "400", "500"],
                initialBalances: [
                  {token: usdc, amount: "10100"},
                  {token: usdt, amount: "20200"},
                  {token: weth, amount: "301"},  // 1 is dust token, we never use it
                  {token: dai, amount: "30400"},
                  {token: tetu, amount: "502"},  // 2 are dust tokens, we never use them
                ],
                compoundRatio: 0,
                liquidations: [
                  {tokenIn: weth, amountIn: "30", tokenOut: usdc, amountOut: "33"},
                  {tokenIn: tetu, amountIn: "50", tokenOut: usdc, amountOut: "55"},
                  {tokenIn: usdt, amountIn: "20", tokenOut: usdc, amountOut: "7"},
                  {tokenIn: dai, amountIn: "40", tokenOut: usdc, amountOut: "11"},
                ],
                performanceFee: 10_000
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["90", "180", "270", "360", "450"].join());
            });
            it("should subtract performance fee from balances of depositor secondary assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["20180", "10206", "30360"].join()); // 10100+33+55+7+11 = 10206
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10206", "20180", "271", "30360", "452"].join()); // 10100+33+55+7+11 = 10206
            });
            it("should return expected amountToPerformanceAndInsurance", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountToPerformanceAndInsurance).eq("116"); // 7 + 11 + 100*0.1+33+55
            });
          });
          describe("Compound ratio is 100%", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRecycleTest(): Promise<IRecycleTestResults> {
              return makeRecycle({
                assetIndex: 1,
                tokens: [usdt, usdc, dai],
                rewardTokens: [usdc, usdt, weth, dai, tetu],
                rewardAmounts: ["100", "200", "300", "400", "500"],
                initialBalances: [
                  {token: usdc, amount: "10100"},
                  {token: usdt, amount: "20200"},
                  {token: weth, amount: "301"},  // 1 is dust token, we never use it
                  {token: dai, amount: "30400"},
                  {token: tetu, amount: "502"},  // 2 are dust tokens, we never use them
                ],
                compoundRatio: 100_000,
                liquidations: [
                  {tokenIn: weth, amountIn: "300", tokenOut: usdc, amountOut: "330"},
                  {tokenIn: tetu, amountIn: "500", tokenOut: usdc, amountOut: "550"},
                  {tokenIn: usdt, amountIn: "20", tokenOut: usdc, amountOut: "7"},
                  {tokenIn: dai, amountIn: "40", tokenOut: usdc, amountOut: "11"},
                ],
                performanceFee: 10_000
              });
            }

            it("should return expected amounts for the forwarder", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountsToForward.join()).eq(["0", "0", "0", "0", "0"].join());
            });
            it("should subtract performance fee from balances of depositor secondary assets", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.tokenBalances.join()).eq(["20180", "10998", "30360"].join()); // 10100+330+550+7+11 = 10998
            });
            it("should set expected balances of rewards tokens", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.rewardTokenBalances.join()).eq(["10998", "20180", "1", "30360", "2"].join()); // 10100+330+550+7+11 = 10998
            });
            it("should return expected amountToPerformanceAndInsurance", async () => {
              const r = await loadFixture(makeRecycleTest);
              expect(r.amountToPerformanceAndInsurance).eq("116"); // 7 + 11 + 100*0.1+330*(300*0.1/(300*0.1+300*0.9))+550*(500*0.1/(500*0.1+500*0.9))
            });
          });
        });
      });
      describe("using of isConversionValid inside liquidation", () => {
        describe("Reward token belongs to the list of depositor tokens", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [dai],
              rewardAmounts: ["100"],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "103"}
              ],
              compoundRatio: 90_000,
              liquidations: [{amountIn: "10", amountOut: "8", tokenIn: dai, tokenOut: usdc}],
              performanceFee: 10_000,
              isConversionValidDetailed: [{amountIn: "10", amountOut: "8", tokenIn: dai, tokenOut: usdc, result: 1}]
            });
          }

          it("should successfully liquidate performance part of the reward amount", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountToPerformanceAndInsurance).eq("8");
          });
        });
        describe("Reward doesn't token belong to the list of depositor tokens", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["100"],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "108"}
              ],
              compoundRatio: 90_000,
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "90", amountOut: "97"}],
              performanceFee: 0,

              // Following isConversionValid check shouldn't be called because TETU is not depositor asset
              isConversionValidDetailed: [{tokenIn: tetu, tokenOut: usdc, amountIn: "90", amountOut: "97", result: 2}]
            });
          }

          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["18"].join());
          });
        });
      });
    });
    describe('Bad paths', () => {
      describe("liquidationThresholds[reward token] is set", () => {
        describe("Reward amount > liquidationThresholds[reward asset]", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: tetu, amount: "1.79"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 0.15 > 0.11
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}],
              performanceFee: 0
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["4.2"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["1", "2.15", "3"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["4.2"].join());
          });
        });
        describe("liquidationThresholds[reward asset] > Reward amount > DEFAULT_LIQUIDATION_THRESHOLD==100_000", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: tetu, amount: "1.81"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 200_000 > 0.15e6 > 100_000
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}],
              performanceFee: 0
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["4.2"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["1", "2", "3"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["6"].join());
          });
        });
        /**
         * TODO: liquidation should take into account DEFAULT_LIQUIDATION_THRESHOLD
         */
        describe.skip("DEFAULT_LIQUIDATION_THRESHOLD > Reward amount > liquidationThresholds[reward asset]", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 0,
              tokens: [usdc, dai],
              rewardTokens: [usdt], // usdt is used as reward token to have decimals 6 and simplify calculations
              rewardAmounts: ["6"],
              thresholds: [{token: usdt, amount: "0.012"}],
              initialBalances: [
                {token: usdt, amount: "6"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
              ],
              compoundRatio: 300,

              // 0.1 > 0.018 > 0.012
              liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "0.018", amountOut: "0.09"}],
              performanceFee: 0
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["5.982"].join()); // 6*(100000-300)/100000
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["2", "3"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["6"].join());
          });
        });
      });
      describe("liquidationThresholds[main asset] is set", () => {
        describe("amountToCompound > liquidationThresholds[main asset]", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: usdc, amount: "0.14"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 6*0.3 > 0.7 > 0.0000000000001
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}],
              performanceFee: 0
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["4.2"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["1", "2.15", "3"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["4.2"].join());
          });
        });
        describe("liquidationThresholds[main asset] > amountToCompound > DEFAULT_LIQUIDATION_THRESHOLD==100_000", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: usdc, amount: "2"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 2 > 1.8 > 100_000e-18
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}],
              performanceFee: 0
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["4.2"].join());
          });
          it("should change balances", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["1", "2.15", "3"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["4.2"].join());
          });
        });
      });
      describe("liquidationThresholds[secondary asset] is set, performance fee > 0", () => {
        describe("performance > liquidationThresholds[reward token]", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [dai],
              rewardAmounts: ["12"],
              thresholds: [{token: dai, amount: "0.7"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "12"},
              ],
              compoundRatio: 30_000,

              // 12*0.5 > 0.7 > 0.0000000000001
              liquidations: [{tokenIn: dai, tokenOut: usdc, amountIn: "6", amountOut: "7"}],
              performanceFee: 50_000
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["4.2"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["1", "9", "6"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["6"].join());
          });
          it("should set expected performance amount", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountToPerformanceAndInsurance).eq("7");
          });
        });
        describe("liquidationThresholds[secondary asset] > performance > DEFAULT_LIQUIDATION_THRESHOLD==100_000", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [dai],
              rewardAmounts: ["12"],
              thresholds: [{token: dai, amount: "6.1"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "6"},
              ],
              compoundRatio: 30_000,

              // 6.1 > (12*0.5 = 6) > 100_000e-18
              liquidations: [{tokenIn: dai, tokenOut: usdc, amountIn: "6", amountOut: "6.15"}],
              performanceFee: 50_000
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["4.2"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["1", "2", "6"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["6"].join());
          });
          it("should generate zero performance amount", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountToPerformanceAndInsurance).eq("0");
          });
        });

        /**
         * TODO: liquidation should take into account DEFAULT_LIQUIDATION_THRESHOLD
         */
        describe.skip("DEFAULT_LIQUIDATION_THRESHOLD > performance > liquidationThresholds[secondary asset]", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 0,
              tokens: [usdc, usdt],
              rewardTokens: [usdt],
              rewardAmounts: ["0.08"],
              thresholds: [{token: usdt, amount: "0.01"}],
              initialBalances: [
                {token: dai, amount: "1"},
                {token: usdc, amount: "2"},
                {token: usdt, amount: "1"},
              ],
              compoundRatio: 40_000,

              // 0.1 > 0.08*0.5 > 0.01
              liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "0.04", amountOut: "0.09"}],
              performanceFee: 50_000
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["0.024"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["2", "1"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["1"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountToPerformanceAndInsurance).eq("0");
          });
        });
      });

      describe("Wrong lengths", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should revert", async () => {
          await expect(
            makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu, usdc],
              rewardAmounts: ["6"], // (!) wrong lengths
              initialBalances: [],
              compoundRatio: 30_000,
              liquidations: [],
              performanceFee: 0
            })
          ).revertedWith("TS-4 wrong lengths"); // WRONG_LENGTHS
        });
      });
    });
  });

  describe("getTokenAmounts", () => {
    interface IGetTokenAmountsParams {
      initialBalances: string[];

      tokens: MockToken[];
      assetIndex: number;
      threshold?: string;

      borrows: IBorrowParamsNum[];
      collaterals: string[];
    }

    interface IGetTokenAmountsResults {
      gasUsed: BigNumber;

      tokenAmountsOut: string[];
      tokenBalances: string[];
    }

    async function makeGetTokenAmounts(p: IGetTokenAmountsParams): Promise<IGetTokenAmountsResults> {
      // set up initial balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.initialBalances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);
      for (const borrow of p.borrows) {
        await setupMockedBorrow(converter, facade.address, borrow);
      }

      // make test
      const tokenAmountsOut = await facade.callStatic.getTokenAmounts(
        converter.address,
        p.tokens.map(x => x.address),
        p.assetIndex,
        await Promise.all(p.collaterals.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals())
        )),
        parseUnits(p.threshold || "0", await p.tokens[p.assetIndex].decimals())
      );

      const tx = await facade.getTokenAmounts(
        converter.address,
        p.tokens.map(x => x.address),
        p.assetIndex,
        await Promise.all(p.collaterals.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals())
        )),
        parseUnits(p.threshold || "0", await p.tokens[p.assetIndex].decimals())
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        gasUsed,
        tokenAmountsOut: await Promise.all(tokenAmountsOut.map(
          async (amount, index) => (+formatUnits(amount, await p.tokens[index].decimals())).toString()
        )),
        tokenBalances: await Promise.all(p.tokens.map(
          async t => (+formatUnits(await t.balanceOf(facade.address), await t.decimals())).toString()
        )),
      }
    }

    describe("Good paths", () => {
      describe("Typical case", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeGetTokenAmountsTest(): Promise<IGetTokenAmountsResults> {
          return makeGetTokenAmounts({
            tokens: [usdt, tetu, dai, usdc],
            assetIndex: 3,
            threshold: "0",
            initialBalances: ["0", "0", "0", "1000"],
            collaterals: ["100", "200", "300", "4444"],
            borrows: [
              {
                collateralAsset: usdc,
                borrowAsset: usdt,
                collateralAmount: "100",
                maxTargetAmount: "101",
                converter: ethers.Wallet.createRandom().address
              },
              {
                collateralAsset: usdc,
                borrowAsset: tetu,
                collateralAmount: "200",
                maxTargetAmount: "201",
                converter: ethers.Wallet.createRandom().address
              },
              {
                collateralAsset: usdc,
                borrowAsset: dai,
                collateralAmount: "300",
                maxTargetAmount: "301",
                converter: ethers.Wallet.createRandom().address
              },
            ]
          });
        }

        it("should return expected values", async () => {
          const results = await loadFixture(makeGetTokenAmountsTest);
          expect(results.tokenAmountsOut.join()).eq(["101", "201", "301", "400"].join());
        });
        it("should set expected balances", async () => {
          const results = await loadFixture(makeGetTokenAmountsTest);
          expect(results.tokenBalances.join()).eq(["101", "201", "301", "400"].join());
        });
      });
    });
    describe("Bad paths", () => {
      describe("Conversion is not available", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        /**
         * There are two possible cases with maxTargetAmount = 0:
         * 1) threshold is too high
         * 2) landing platform cannot provide required liquidity
         * In both cases the function doesn't revert, it just returns zero amount
         */
        it("should return zero amounts", async () => {
          const r = await makeGetTokenAmounts({
            tokens: [usdt, tetu, dai, usdc],
            assetIndex: 3,
            threshold: "0",
            initialBalances: ["0", "0", "0", "1000"],
            collaterals: ["100", "200", "300", "400"],
            borrows: [
              {
                collateralAsset: usdc,
                borrowAsset: usdt,
                collateralAmount: "100",
                maxTargetAmount: "101",
                converter: ethers.Wallet.createRandom().address
              },
              {
                collateralAsset: usdc,
                borrowAsset: tetu,
                collateralAmount: "200",
                maxTargetAmount: "0",
                converter: Misc.ZERO_ADDRESS
              },
              {
                collateralAsset: usdc,
                borrowAsset: dai,
                collateralAmount: "300",
                maxTargetAmount: "0",
                converter: Misc.ZERO_ADDRESS
              },
            ]
          });
          expect(r.tokenAmountsOut.join()).eq(["101", "0", "0", "400"].join());
        });
      });
      describe("Zero collateral amount", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeGetTokenAmountsTest(): Promise<IGetTokenAmountsResults> {
          return makeGetTokenAmounts({
            tokens: [usdt, tetu, dai, usdc],
            assetIndex: 3,
            threshold: "0",
            initialBalances: ["0", "0", "0", "1000"],
            collaterals: ["100", "0", "0", "400"],
            borrows: [
              {
                collateralAsset: usdc,
                borrowAsset: usdt,
                collateralAmount: "100",
                maxTargetAmount: "101",
                converter: ethers.Wallet.createRandom().address
              },
            ]
          });
        }

        it("should return expected values", async () => {
          const results = await loadFixture(makeGetTokenAmountsTest);
          expect(results.tokenAmountsOut.join()).eq(["101", "0", "0", "400"].join());
        });
        it("should set expected balances", async () => {
          const results = await loadFixture(makeGetTokenAmountsTest);
          expect(results.tokenBalances.join()).eq(["101", "0", "0", "900"].join());
        });
      });
      describe("Collateral of the main assets exceeds available balance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeGetTokenAmountsTest(): Promise<IGetTokenAmountsResults> {
          return makeGetTokenAmounts({
            tokens: [usdt, tetu, dai, usdc],
            assetIndex: 3,
            threshold: "0",
            initialBalances: ["0", "0", "0", "999"],
            collaterals: ["100", "200", "300", "400"],
            borrows: [
              {
                collateralAsset: usdc,
                borrowAsset: usdt,
                collateralAmount: "100",
                maxTargetAmount: "101",
                converter: ethers.Wallet.createRandom().address
              },
              {
                collateralAsset: usdc,
                borrowAsset: tetu,
                collateralAmount: "200",
                maxTargetAmount: "201",
                converter: ethers.Wallet.createRandom().address
              },
              {
                collateralAsset: usdc,
                borrowAsset: dai,
                collateralAmount: "300",
                maxTargetAmount: "301",
                converter: ethers.Wallet.createRandom().address
              },
            ]
          });
        }

        it("should return expected values", async () => {
          const results = await loadFixture(makeGetTokenAmountsTest);
          expect(results.tokenAmountsOut.join()).eq(["101", "201", "301", "399"].join());
        });
        it("should set expected balances", async () => {
          const results = await loadFixture(makeGetTokenAmountsTest);
          expect(results.tokenBalances.join()).eq(["101", "201", "301", "399"].join());
        });
      });
    });
  });

  describe("_closePositionExact", () => {
    interface IClosePositionParams {
      collateralAsset: MockToken;
      borrowAsset: MockToken;
      amountRepay: string;
      balances: string[]; // collateral, borrow
      repays: IRepayParams[];
    }

    interface IClosePositionResults {
      gasUsed: BigNumber;
      collateralAmount: string;
      repaidAmount: string;
      collateralAssetBalance: string;
      borrowAssetBalance: string;
    }

    async function makeClosePosition(p: IClosePositionParams): Promise<IClosePositionResults> {
      const tokens = [p.collateralAsset, p.borrowAsset];

      // set up balances
      for (let i = 0; i < tokens.length; ++i) {
        await tokens[i].mint(facade.address, parseUnits(p.balances[i], await tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up repay
      for (const repay of p.repays) {
        await setupMockedRepay(converter, facade.address, repay);
      }

      const balanceBorrowAsset = p.balances[1];
      const ret = await facade.callStatic._closePositionExact(
        converter.address,
        p.collateralAsset.address,
        p.borrowAsset.address,
        parseUnits(p.amountRepay, await p.borrowAsset.decimals()),
        parseUnits(balanceBorrowAsset, await p.borrowAsset.decimals())
      );

      const tx = await facade._closePositionExact(
        converter.address,
        p.collateralAsset.address,
        p.borrowAsset.address,
        parseUnits(p.amountRepay, await p.borrowAsset.decimals()),
        parseUnits(balanceBorrowAsset, await p.borrowAsset.decimals())
      );

      const gasUsed = (await tx.wait()).gasUsed;
      return {
        gasUsed,
        collateralAmount: (+formatUnits(ret.collateralOut, await p.collateralAsset.decimals())).toString(),
        repaidAmount: (+formatUnits(ret.repaidAmountOut, await p.borrowAsset.decimals())).toString(),
        collateralAssetBalance: (+formatUnits(await p.collateralAsset.balanceOf(facade.address), await p.collateralAsset.decimals())).toString(),
        borrowAssetBalance: (+formatUnits(await p.borrowAsset.balanceOf(facade.address), await p.borrowAsset.decimals())).toString(),
      };
    }

    describe("Good paths", () => {
      describe("Full repayment, no debt gap", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["0", "1000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountRepay: "1000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "1000",
              collateralAmountOut: "2000",
              totalDebtAmountOut: "1000",
              totalCollateralAmountOut: "2000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("2000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("1000");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("2000");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("0");
        });
      });
      describe("Full repayment with debt gap", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["0", "1010"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountRepay: "1010",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "1010",
              collateralAmountOut: "2000",
              totalDebtAmountOut: "1000",
              totalCollateralAmountOut: "2000",
              debtGapToSend: "10",
              debtGapToReturn: "9"
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("2000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("1001");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("2000");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("9");
        });
      });
      describe("Partial repayment", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["500", "8000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountRepay: "1000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "1000",
              collateralAmountOut: "2000",
              totalDebtAmountOut: "50000",
              totalCollateralAmountOut: "100000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("2000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("1000");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("2500");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("7000");
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

      describe("Try to pay too much", () => {
        it("should revert if pay too much", async () => {
          await expect(makeClosePosition({
            balances: ["0", "8000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountRepay: "5000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "5000",
              returnedBorrowAmountOut: "4000", // not used amount = 5000 - 1000
              collateralAmountOut: "2000",
              totalDebtAmountOut: "1000",
              totalCollateralAmountOut: "2000",
            }]
          })).revertedWith("SB: Wrong value"); // WRONG_VALUE
        });
      });
      describe("Try to repay dust token", () => {
        it("should not change balances", async () => {
          const ret = await makeClosePosition({
            balances: ["0.02", "0.01"],
            collateralAsset: usdc,
            borrowAsset: usdt,
            amountRepay: "0.00004", // less than 100 tokens
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              totalCollateralAmountOut: "90",
              totalDebtAmountOut: "45",
            }],
          });
          expect([ret.collateralAssetBalance, ret.borrowAssetBalance].join()).eq(["0.02", "0.01"].join())
        });
      });
    });
  });

  describe("_closePosition", () => {
    interface IClosePositionParams {
      collateralAsset: MockToken;
      borrowAsset: MockToken;
      amountToRepay: string;
      balances: string[]; // collateral, borrow
      repays: IRepayParams[];
    }

    interface IClosePositionResults {
      gasUsed: BigNumber;
      collateralAmount: string;
      repaidAmount: string;
      collateralAssetBalance: string;
      borrowAssetBalance: string;
    }

    async function makeClosePosition(p: IClosePositionParams): Promise<IClosePositionResults> {
      const tokens = [p.collateralAsset, p.borrowAsset];

      // set up balances
      for (let i = 0; i < tokens.length; ++i) {
        await tokens[i].mint(facade.address, parseUnits(p.balances[i], await tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up repay
      for (const repay of p.repays) {
        await setupMockedRepay(converter, facade.address, repay);
      }

      const balanceBorrowAsset = p.balances[1];
      const ret = await facade.callStatic._closePosition(
        converter.address,
        p.collateralAsset.address,
        p.borrowAsset.address,
        parseUnits(p.amountToRepay, await p.borrowAsset.decimals())
      );

      const tx = await facade._closePosition(
        converter.address,
        p.collateralAsset.address,
        p.borrowAsset.address,
        parseUnits(p.amountToRepay, await p.borrowAsset.decimals())
      );

      const gasUsed = (await tx.wait()).gasUsed;
      return {
        gasUsed,
        collateralAmount: (+formatUnits(ret.returnedAssetAmountOut, await p.collateralAsset.decimals())).toString(),
        repaidAmount: (+formatUnits(ret.repaidAmountOut, await p.borrowAsset.decimals())).toString(),
        collateralAssetBalance: (+formatUnits(await p.collateralAsset.balanceOf(facade.address), await p.collateralAsset.decimals())).toString(),
        borrowAssetBalance: (+formatUnits(await p.borrowAsset.balanceOf(facade.address), await p.borrowAsset.decimals())).toString(),
      };
    }

    describe("Good paths", () => {
      describe("balanceBefore > needToRepay > amountToRepay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["300", "5000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountToRepay: "1000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "1000",
              collateralAmountOut: "2000",
              totalDebtAmountOut: "3000", // needToRepay
              totalCollateralAmountOut: "6000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("2000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("1000");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("2300");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("4000");
        });
      });
      describe("balanceBefore > amountToRepay > needToRepay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["300", "5000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountToRepay: "4000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "1000",
              collateralAmountOut: "2000",
              totalDebtAmountOut: "1000", // needToRepay
              totalCollateralAmountOut: "2000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("2000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("1000");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("2300");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("4000");
        });
      });
      describe("amountToRepay > needToRepay > balanceBefore", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["300", "500"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountToRepay: "7000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "500",
              collateralAmountOut: "1000",
              totalDebtAmountOut: "1000", // needToRepay
              totalCollateralAmountOut: "2000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("1000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("500");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("1300");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("0");
        });
      });
      describe("amountToRepay > balanceBefore > needToRepay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["300", "5000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountToRepay: "7000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "1000",
              collateralAmountOut: "2000",
              totalDebtAmountOut: "1000", // needToRepay
              totalCollateralAmountOut: "2000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("2000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("1000");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("2300");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("4000");
        });
      });
      describe("needToRepay > amountToRepay > balanceBefore", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["300", "500"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountToRepay: "7000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "500",
              collateralAmountOut: "1000",
              totalDebtAmountOut: "25000", // needToRepay
              totalCollateralAmountOut: "50000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("1000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("500");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("1300");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("0");
        });
      });
      describe("needToRepay > balanceBefore > amountToRepay", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClosePositionTest(): Promise<IClosePositionResults> {
          return makeClosePosition({
            balances: ["300", "5000"],
            collateralAsset: usdc,
            borrowAsset: dai,
            amountToRepay: "3000",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: dai,
              amountRepay: "3000",
              collateralAmountOut: "6000",
              totalDebtAmountOut: "25000", // needToRepay
              totalCollateralAmountOut: "50000",
            }]
          });
        }

        it("should return expected collateral amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAmount).eq("6000");
        });
        it("should return expected repaid amount", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.repaidAmount).eq("3000");
        });
        it("should set expected collateral asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.collateralAssetBalance).eq("6300");
        });
        it("should set expected borrow asset balance", async () => {
          const ret = await loadFixture(makeClosePositionTest);
          expect(ret.borrowAssetBalance).eq("2000");
        });
      });
    });
  });

  describe('sendPerformanceFee', () => {
    interface ISendPerformanceFeeParams {
      asset: MockToken;
      amount: string;
    }

    interface ISendPerformanceFeeResults {
      toInsurance: number;
      toPerf: number;
      facadeBalance: number;
      receiverBalance: number;
      insuranceBalance: number;
      gasUsed: BigNumber;
    }

    async function makeSendPerformanceFee(p: ISendPerformanceFeeParams): Promise<ISendPerformanceFeeResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const decimalsAsset = await p.asset.decimals()
      await p.asset.mint(facade.address, parseUnits(p.amount, decimalsAsset));

      const insurance = ethers.Wallet.createRandom().address;
      const vault = await MockHelper.createMockVault(signer);
      await vault.setInsurance(insurance);

      const splitter = await MockHelper.createMockSplitter(signer);
      await splitter.setVault(vault.address);

      const r = await facade.callStatic.sendPerformanceFee(
        p.asset.address,
        parseUnits(p.amount, decimalsAsset),
        splitter.address,
        receiver,
        50_000
      );

      const tx = await facade.sendPerformanceFee(
        p.asset.address,
        parseUnits(p.amount, decimalsAsset),
        splitter.address,
        receiver,
        50_000
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const facadeBalance = await p.asset.balanceOf(facade.address);
      const receiverBalance = await p.asset.balanceOf(receiver);
      const insuranceBalance = await p.asset.balanceOf(insurance);

      return {
        gasUsed,
        toInsurance: +formatUnits(r.toInsurance, decimalsAsset),
        toPerf: +formatUnits(r.toPerf, decimalsAsset),
        facadeBalance: +formatUnits(facadeBalance, decimalsAsset),
        receiverBalance: +formatUnits(receiverBalance, decimalsAsset),
        insuranceBalance: +formatUnits(insuranceBalance, decimalsAsset),
      };
    }

    describe('Good paths', () => {
      describe('Amount != 0', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeSendPerformanceFeeTest(): Promise<ISendPerformanceFeeResults> {
          return makeSendPerformanceFee({
            asset: usdc,
            amount: "100"
          });
        }

        it('should return expected toPerf', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.toPerf).eq(50);
        });
        it('should return expected toInsurance', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.toInsurance).eq(50);
        });
        it('should set expected facade balances', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.facadeBalance).eq(0);
        });
        it('should return receiver balances', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.receiverBalance).eq(50);
        });
        it('should return insurance balances', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.insuranceBalance).eq(50);
        });
      });
      describe('Amount 0', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeSendPerformanceFeeTest(): Promise<ISendPerformanceFeeResults> {
          return makeSendPerformanceFee({
            asset: usdc,
            amount: "0"
          });
        }

        it('should return expected toPerf', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.toPerf).eq(0);
        });
        it('should return expected toInsurance', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.toInsurance).eq(0);
        });
        it('should set expected facade balances', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.facadeBalance).eq(0);
        });
        it('should return receiver balances', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.receiverBalance).eq(0);
        });
        it('should return insurance balances', async () => {
          const results = await loadFixture(makeSendPerformanceFeeTest);
          expect(results.insuranceBalance).eq(0);
        });
      });
    });
  });

  describe('getCollaterals', () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      describe('Same prices, same weights', () => {
        it('should return expected values', async () => {
          const assetAmount = parseUnits('1000', 6);
          const priceOracle = await MockHelper.createPriceOracle(
            signer,
            [dai.address, weth.address, usdc.address, tetu.address],
            [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18],
          );
          const ret = await facade.getCollaterals(
            assetAmount,
            [dai.address, weth.address, usdc.address, tetu.address],
            [1, 1, 1, 1],
            4,
            2,
            priceOracle.address,
          );

          const expected = [
            parseUnits('250', 6),
            parseUnits('250', 6),
            parseUnits('250', 6),
            parseUnits('250', 6),
          ];

          expect(ret.join()).eq(expected.join());
        });
      });
      describe('Same prices, different weights', () => {
        it('should return expected values', async () => {
          const assetAmount = parseUnits('1000', 6);
          const priceOracle = await MockHelper.createPriceOracle(
            signer,
            [dai.address, weth.address, usdc.address, tetu.address],
            [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18],
          );
          const ret = await facade.getCollaterals(
            assetAmount,
            [dai.address, weth.address, usdc.address, tetu.address],
            [1, 2, 3, 4],
            10,
            2,
            priceOracle.address,
          );

          const expected = [
            parseUnits('100', 6),
            parseUnits('200', 6),
            parseUnits('300', 6),
            parseUnits('400', 6),
          ];

          expect(ret.join()).eq(expected.join());
        });
      });
      describe('Some amounts are already on balance', () => {
        it('should return expected values', async () => {
          const assets = [dai, weth, usdc, tetu];
          const assetAmount = parseUnits('1000', 6);
          const priceOracle = await MockHelper.createPriceOracle(
            signer,
            assets.map(x => x.address),
            [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18],
          );
          const amountsOnBalance = [
            parseUnits('30', 18), // part of required amount is on the balance
            parseUnits('200', 18), // more amount than required is on the balance
            parseUnits('1000', 6), // USDC is the main asset
            parseUnits('100', 18), // full required amount is on balance
          ];
          for (let i = 0; i < assets.length; ++i) {
            await assets[i].mint(facade.address, amountsOnBalance[i]);
          }

          const ret = await facade.getCollaterals(
            assetAmount,
            assets.map(x => x.address),
            [1, 1, 1, 1],
            10,
            2,
            priceOracle.address,
          );

          const expected = [
            parseUnits('70', 6),
            parseUnits('0', 6),
            parseUnits('100', 6),
            parseUnits('0', 6),
          ];

          expect(ret.join()).eq(expected.join());
        });
      });
    });
    describe('Gas estimation @skip-on-coverage', () => {
      it('should return expected values', async () => {
        const assetAmount = parseUnits('1000', 6);
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [dai.address, weth.address, usdc.address, tetu.address],
          [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18],
        );
        const gasUsed = await facade.estimateGas.getCollaterals(
          assetAmount,
          [dai.address, weth.address, usdc.address, tetu.address],
          [1, 1, 1, 1],
          4,
          2,
          priceOracle.address,
        );

        controlGasLimitsEx(gasUsed, GET_GET_COLLATERALS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe('openPosition', () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IOpenPositionTestInputParams {
      borrows?: {
        converter: string;
        collateralAsset: MockToken;
        collateralAmount: BigNumber;
        borrowAsset: MockToken;
        amountToBorrow: BigNumber;
      }[];
      findBorrowStrategyOutputs?: {
        entryData: string;
        sourceToken: string;
        amountIn: BigNumber;
        targetToken: string;

        converters: string[];
        collateralAmountsOut: BigNumber[];
        amountToBorrowsOut: BigNumber[];
        aprs18: BigNumber[];
      }[];
      amountBorrowAssetForTetuConverter: BigNumber;
      amountCollateralForFacade: BigNumber;
      amountInIsCollateral: boolean;
      prices?: {
        collateral: BigNumber;
        borrow: BigNumber;
      };
    }

    interface IOpenPositionTestResults {
      collateralAmountOut: BigNumber;
      borrowedAmountOut: BigNumber;
      gasUsed: BigNumber;
      balanceBorrowAssetTetuConverter: BigNumber;
      balanceCollateralAssetFacade: BigNumber;
    }

    async function makeOpenPositionTest(
      entryData: string,
      collateralAsset: MockToken,
      borrowAsset: MockToken,
      amountIn: BigNumber,
      params: IOpenPositionTestInputParams,
    ): Promise<IOpenPositionTestResults> {
      const tetuConverter = await MockHelper.createMockTetuConverter(signer);

      if (params.borrows) {
        for (const b of params.borrows) {
          await tetuConverter.setBorrowParams(
            b.converter,
            b.collateralAsset.address,
            b.collateralAmount,
            b.borrowAsset.address,
            b.amountToBorrow,
            ethers.Wallet.createRandom().address,
            b.amountToBorrow,
          );
        }
      }

      if (params.findBorrowStrategyOutputs) {
        for (const b of params.findBorrowStrategyOutputs) {
          await tetuConverter.setFindBorrowStrategyOutputParams(
            b.entryData,
            b.converters,
            b.collateralAmountsOut,
            b.amountToBorrowsOut,
            b.aprs18,
            b.sourceToken,
            b.amountIn,
            b.targetToken,
            1, // period
          );
        }
      }

      if (params.prices) {
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [collateralAsset.address, borrowAsset.address],
          [params.prices.collateral, params.prices.borrow],
        );
        const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
        await tetuConverter.setController(controller.address);
      }

      await collateralAsset.mint(facade.address, params.amountCollateralForFacade);
      await borrowAsset.mint(tetuConverter.address, params.amountBorrowAssetForTetuConverter);

      if (params.amountInIsCollateral) {
        await collateralAsset.connect(await Misc.impersonate(facade.address)).approve(tetuConverter.address, amountIn);
      } else {
        await borrowAsset.connect(await Misc.impersonate(facade.address)).approve(tetuConverter.address, amountIn);
      }
      const ret = await facade.callStatic.openPosition(
        tetuConverter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        0,
      );

      const tx = await facade.openPosition(
        tetuConverter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        0,
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        collateralAmountOut: ret.collateralAmountOut,
        borrowedAmountOut: ret.borrowedAmountOut,
        gasUsed,
        balanceBorrowAssetTetuConverter: await borrowAsset.balanceOf(tetuConverter.address),
        balanceCollateralAssetFacade: await collateralAsset.balanceOf(facade.address),
      };
    }

    describe('Good paths', () => {
      describe('Entry kind 0', () => {
        it('should return expected values, single borrow', async () => {
          const converter = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            '0x',
            usdc,
            dai,
            parseUnits('11', 6),
            {
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('11', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('17', 18),
                  converter,
                },
              ],
              findBorrowStrategyOutputs: [
                {
                  converters: [converter],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: '0x',
                  aprs18: [parseUnits('1', 18)],
                  amountIn: parseUnits('11', 6),
                  collateralAmountsOut: [parseUnits('11', 6)],
                  amountToBorrowsOut: [parseUnits('17', 18)],
                },
              ],
              amountCollateralForFacade: parseUnits('11', 6),
              amountBorrowAssetForTetuConverter: parseUnits('17', 18),
              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('11', 6), parseUnits('17', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it('should return expected values, two borrows', async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            '0x',
            usdc,
            dai,
            parseUnits('3', 6),
            {
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('1', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('1', 18),
                  converter: converter1,
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('2', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('2', 18),
                  converter: converter2,
                },
              ],
              findBorrowStrategyOutputs: [
                {
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: '0x',
                  aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                  amountIn: parseUnits('3', 6),
                  amountToBorrowsOut: [parseUnits('1', 18), parseUnits('2', 18)],
                  collateralAmountsOut: [parseUnits('1', 6), parseUnits('2', 6)],
                },
              ],
              amountCollateralForFacade: parseUnits('11', 6),
              amountBorrowAssetForTetuConverter: parseUnits('17', 18),

              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('3', 6), parseUnits('3', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it('should return expected values, two borrows, platforms don\'t have enough amount', async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            '0x',
            usdc,
            dai,
            parseUnits('103', 6), // (!) we asked too much, lending platforms have DAI for $3 in total
            {
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('1', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('1', 18),
                  converter: converter1,
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('2', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('2', 18),
                  converter: converter2,
                },
              ],
              findBorrowStrategyOutputs: [
                {
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: '0x',
                  aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                  amountIn: parseUnits('3', 6),
                  amountToBorrowsOut: [parseUnits('1', 18), parseUnits('2', 18)],
                  collateralAmountsOut: [parseUnits('1', 6), parseUnits('2', 6)],
                },
              ],
              amountCollateralForFacade: parseUnits('11', 6),
              amountBorrowAssetForTetuConverter: parseUnits('17', 18),
              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('3', 6), parseUnits('3', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it('should return expected values, two borrows, platforms have more then required liquidity', async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            '0x',
            usdc,
            dai,
            parseUnits('100', 6),
            {
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('10', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('15', 18),
                  converter: converter1,
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('90', 6), // (!) we will take only 100-10 = 90
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('180', 18), // (!) we will take only 200*90/100 = 180
                  converter: converter2,
                },
              ],
              findBorrowStrategyOutputs: [
                {
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: '0x',
                  aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                  amountIn: parseUnits('3', 6),
                  amountToBorrowsOut: [parseUnits('15', 18), parseUnits('200', 18)],
                  collateralAmountsOut: [parseUnits('10', 6), parseUnits('100', 6)],
                },
              ],
              amountCollateralForFacade: parseUnits('100', 6),
              amountBorrowAssetForTetuConverter: parseUnits('195', 18),
              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('100', 6), parseUnits('195', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        describe('threshold is used, first conversion provides a bit less amount than required', () => {
          it('should return expected values, single borrow', async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256'], [0]),
              usdc,
              weth,
              BigNumber.from('9762660842'),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: weth.address,
                    entryData: defaultAbiCoder.encode(['uint256'], [0]),
                    aprs18: [parseUnits('1', 18)],
                    amountIn: BigNumber.from('9762660842'),
                    collateralAmountsOut: [
                      BigNumber.from('9762660841'), // (!) 9762660842-1
                      BigNumber.from('9762660842'),
                    ],
                    amountToBorrowsOut: [
                      BigNumber.from('1720944043846096427'),
                      BigNumber.from('1712848453478843025'),
                    ],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: BigNumber.from('9762660841'), // (!) 9762660842-1
                    borrowAsset: weth,
                    amountToBorrow: BigNumber.from('1718521573012697263'),
                    converter: converter1,
                  },
                ],
                amountBorrowAssetForTetuConverter: BigNumber.from('1720944043846096427'),
                amountCollateralForFacade: BigNumber.from('9762660842'),
                amountInIsCollateral: true,
                prices: {
                  collateral: BigNumber.from('998200000000000000'),
                  borrow: BigNumber.from('1696840000000000000000'),
                },
              },
            );

            const ret = [
              r.collateralAmountOut,
              r.borrowedAmountOut,
              r.balanceCollateralAssetFacade,
            ].map(x => BalanceUtils.toString(x)).join();
            const expected = [
              BigNumber.from('9762660841'),
              BigNumber.from('1718521573012697263'),
              BigNumber.from(1),
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
      });
      describe('Entry kind 1', () => {
        describe('proportions 1:1', () => {
          it('should return expected values, single borrow, single converter', async () => {
            const converter = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
              usdc,
              dai,
              parseUnits('100', 6),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter],
                    sourceToken: usdc.address,
                    targetToken: dai.address,
                    entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
                    aprs18: [parseUnits('1', 18)],
                    amountIn: parseUnits('100', 6),
                    amountToBorrowsOut: [parseUnits('50', 18)],
                    collateralAmountsOut: [parseUnits('75', 6)],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('75', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('50', 18),
                    converter,
                  },
                ],
                amountBorrowAssetForTetuConverter: parseUnits('50', 18),
                amountCollateralForFacade: parseUnits('75', 6),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits('1', 18),
                  borrow: parseUnits('0.5', 18),
                },
              },
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits('75', 6), parseUnits('50', 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it('should return expected values, single borrow, multiple converters', async () => {
            const converter = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
              usdc,
              dai,
              parseUnits('100', 6),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter, converter],
                    sourceToken: usdc.address,
                    targetToken: dai.address,
                    entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
                    aprs18: [parseUnits('1', 18)],
                    amountIn: parseUnits('100', 6),
                    amountToBorrowsOut: [parseUnits('50', 18), parseUnits('40', 18)],
                    collateralAmountsOut: [parseUnits('75', 6), parseUnits('70', 6)],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('75', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('50', 18),
                    converter,
                  },
                ],
                amountBorrowAssetForTetuConverter: parseUnits('50', 18),
                amountCollateralForFacade: parseUnits('75', 6),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits('1', 18),
                  borrow: parseUnits('0.5', 18),
                },
              },
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits('75', 6), parseUnits('50', 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it('should return expected values, two borrows', async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
              usdc,
              dai,
              parseUnits('100', 6),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: dai.address,
                    entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
                    aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                    amountIn: parseUnits('100', 6),
                    collateralAmountsOut: [parseUnits('15', 6), parseUnits('60', 6)],
                    amountToBorrowsOut: [parseUnits('5', 18), parseUnits('20', 18)],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('15', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('5', 18),
                    converter: converter1,
                  }, {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('60', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('20', 18),
                    converter: converter2,
                  },
                ],
                amountCollateralForFacade: parseUnits('75', 6),
                amountBorrowAssetForTetuConverter: parseUnits('25', 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits('1', 18),
                  borrow: parseUnits('0.5', 18),
                },
              },
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits('75', 6), parseUnits('25', 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          /**
           * We are going to use collateral = $100
           * It should be divided on two "same" parts (proportions 1:1):
           *    $25 - remain unchanged
           *    $75 - swapped to 50 matic ~ $25
           * As result need to have $25 + $50 matic on our balance.
           *
           * First landing platform doesn't have enough liquidity, it allows to swap only $45
           *    $15 + $45, $45 => 30 matic ~ $15
           * Second landing platform doesn't have enough liquidity too, it allows to swap only $15
           * So findBorrowStrategy returns (collateral $15, borrow 10 matic).
           *    $20 + $15, $15 => 10 matic ~ $20
           * As result we will have
           *    used collateral = $45 + $15 = $60
           *    borrowed amount = 30 + 10 = 40 matic ~ $20
           *    unchanged amount = $100 - $60 = $40
           * and incorrect result proportions.
           */
          it('should return expected values, two borrows, platforms don\'t have enough amount', async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
              usdc,
              dai,
              parseUnits('100', 6),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: dai.address,
                    entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
                    aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                    amountIn: parseUnits('100', 6),
                    collateralAmountsOut: [parseUnits('45', 6), parseUnits('15', 6)],
                    amountToBorrowsOut: [parseUnits('30', 18), parseUnits('10', 18)],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('45', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('30', 18),
                    converter: converter1,
                  }, {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('15', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('10', 18),
                    converter: converter2,
                  },
                ],
                amountCollateralForFacade: parseUnits('60', 6),
                amountBorrowAssetForTetuConverter: parseUnits('40', 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits('1', 18),
                  borrow: parseUnits('0.5', 18),
                },
              },
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits('60', 6), parseUnits('40', 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          /**
           * We are going to use collateral = $100
           * It should be divided on two "same" parts (proportions 1:1):
           *    $25 - remain unchanged
           *    $75 - swapped to 50 matic ~ $25
           * As result we will have $25 + $50 matic on our balance.
           *
           * First landing platform doesn't have enough liquidity, it allows to swap only $45
           *    $15 + $45, $45 => 30 matic ~ $15
           * Second landing platform has a lot of liquidity, it allows to swap whole amount.
           * So findBorrowStrategy returns (collateral $75, borrow 50 matic).
           * But we need to make only partial conversion because other part has been converted using the first landing platform.
           *    $10 + $30, $30 => 20 matic ~ $10
           * As result we will have
           *    used collateral = $45 + $30 = $75
           *    borrowed amount = 30 + 20 = 50 matic
           *    unchanged amount = $100 - $75 = $25
           */
          it('should return expected values, two borrows, platforms have more then required liquidity', async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
              usdc,
              dai,
              parseUnits('100', 6),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: dai.address,
                    entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
                    aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                    amountIn: parseUnits('100', 6),
                    collateralAmountsOut: [parseUnits('45', 6), parseUnits('75', 6)],
                    amountToBorrowsOut: [parseUnits('30', 18), parseUnits('50', 18)],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('45', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('30', 18),
                    converter: converter1,
                  }, {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('30', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('20', 18), // (75 - 45) * 30 / 100
                    converter: converter2,
                  },
                ],
                amountCollateralForFacade: parseUnits('75', 6),
                amountBorrowAssetForTetuConverter: parseUnits('50', 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits('1', 18),
                  borrow: parseUnits('0.5', 18),
                },
              },
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits('75', 6), parseUnits('50', 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
        describe('proportions 1:2', () => {
          /**
           * We are going to use collateral = $220
           * It should be divided on two "same" parts (proportions 2:3):
           *    $40 - remain unchanged
           *    $180 - swapped to 120 matic ~ $60
           * As result we need to have $40 + $120 matic on our balance (40 : 60 = 2 : 3)
           *
           * First landing platform doesn't have enough liquidity, it allows to swap only $90
           *    $20 + $90, $90 => 60 matic ~ $30
           * Second landing platform has a lot of liquidity, it allows to swap whole amount.
           * So findBorrowStrategy returns (collateral $180, borrow 120 matic).
           * But we need to make only partial conversion because other part has been converted using the first landing platform.
           *   $20 + $90, $90 => 60 matic ~ $30
           * As result we will have
           *    used collateral = $90 + $90 = $180
           *    borrowed amount = 60 + 60 = 120 matic
           *    unchanged amount = $220 - $180 = $40
           */
          it(
            'should return expected values, two borrows, platforms have more then required liquidity, usdc => dai',
            async () => {
              const converter1 = ethers.Wallet.createRandom().address;
              const converter2 = ethers.Wallet.createRandom().address;
              const r = await makeOpenPositionTest(
                defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 2, 3]),
                usdc,
                dai,
                parseUnits('220', 6),
                {
                  findBorrowStrategyOutputs: [
                    {
                      converters: [converter1, converter2],
                      sourceToken: usdc.address,
                      targetToken: dai.address,
                      entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 2, 3]),
                      aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                      amountIn: parseUnits('220', 6),
                      collateralAmountsOut: [parseUnits('90', 6), parseUnits('180', 6)],
                      amountToBorrowsOut: [parseUnits('60', 18), parseUnits('120', 18)],
                    },
                  ],
                  borrows: [
                    {
                      collateralAsset: usdc,
                      collateralAmount: parseUnits('90', 6),
                      borrowAsset: dai,
                      amountToBorrow: parseUnits('60', 18),
                      converter: converter1,
                    }, {
                      collateralAsset: usdc,
                      collateralAmount: parseUnits('90', 6),
                      borrowAsset: dai,
                      amountToBorrow: parseUnits('60', 18),
                      converter: converter2,
                    },
                  ],
                  amountCollateralForFacade: parseUnits('180', 6),
                  amountBorrowAssetForTetuConverter: parseUnits('120', 18),
                  amountInIsCollateral: true,
                  prices: {
                    collateral: parseUnits('1', 18),
                    borrow: parseUnits('0.5', 18),
                  },
                },
              );

              const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
              const expected = [parseUnits('180', 6), parseUnits('120', 18)].map(x => BalanceUtils.toString(x)).join();

              expect(ret).eq(expected);
            },
          );
          it(
            'should return expected values, two borrows, platforms have more then required liquidity, dai => usdc',
            async () => {
              const converter1 = ethers.Wallet.createRandom().address;
              const converter2 = ethers.Wallet.createRandom().address;
              const r = await makeOpenPositionTest(
                defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 2, 3]),
                dai,
                usdc,
                parseUnits('220', 18),
                {
                  findBorrowStrategyOutputs: [
                    {
                      converters: [converter1, converter2],
                      sourceToken: dai.address,
                      targetToken: usdc.address,
                      entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 2, 3]),
                      aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                      amountIn: parseUnits('220', 18),
                      collateralAmountsOut: [parseUnits('90', 18), parseUnits('180', 18)],
                      amountToBorrowsOut: [parseUnits('60', 6), parseUnits('120', 6)],
                    },
                  ],
                  borrows: [
                    {
                      collateralAsset: dai,
                      collateralAmount: parseUnits('90', 18),
                      borrowAsset: usdc,
                      amountToBorrow: parseUnits('60', 6),
                      converter: converter1,
                    }, {
                      collateralAsset: dai,
                      collateralAmount: parseUnits('90', 18),
                      borrowAsset: usdc,
                      amountToBorrow: parseUnits('60', 6),
                      converter: converter2,
                    },
                  ],
                  amountCollateralForFacade: parseUnits('180', 18),
                  amountBorrowAssetForTetuConverter: parseUnits('120', 6),
                  amountInIsCollateral: true,
                  prices: {
                    collateral: parseUnits('1', 18),
                    borrow: parseUnits('0.5', 18),
                  },
                },
              );

              const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
              const expected = [parseUnits('180', 18), parseUnits('120', 6)].map(x => BalanceUtils.toString(x)).join();

              expect(ret).eq(expected);
            },
          );
        });
        describe('use threshold, reproduce case openPosition.dust [matic block 40302700]', () => {
          it('should return expected values, single borrow', async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
              usdc,
              weth,
              BigNumber.from('9762660842'),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: weth.address,
                    entryData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
                    aprs18: [parseUnits('1', 18)],
                    amountIn: BigNumber.from('9762660842'),
                    collateralAmountsOut: [BigNumber.from('6850990064'), BigNumber.from('6850990064')],
                    amountToBorrowsOut: [BigNumber.from('1720944043846096427'), BigNumber.from('1712848453478843025')],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: BigNumber.from('6841346331'),
                    borrowAsset: weth,
                    amountToBorrow: BigNumber.from('1718521573012697264'),
                    converter: converter1,
                  },
                ],
                amountBorrowAssetForTetuConverter: BigNumber.from('1718521573012697264'),
                amountCollateralForFacade: BigNumber.from('6841346332'),
                amountInIsCollateral: true,
                prices: {
                  collateral: BigNumber.from('998200000000000000'),
                  borrow: BigNumber.from('1696840000000000000000'),
                },
              },
            );

            console.log('results', r);

            const totalAmountInTermsCollateral = r.collateralAmountOut.add(
              r.borrowedAmountOut
                .mul(BigNumber.from('1696840000000000000000'))
                .mul(parseUnits('1', 6))
                .div(BigNumber.from('998200000000000000'))
                .div(parseUnits('1', 18)),
            );

            const ret = areAlmostEqual(totalAmountInTermsCollateral, BigNumber.from('9762660842'));
            expect(ret).eq(true);
          });
        });
      });
      describe('Entry kind 2', () => {
        it('should return expected values, single borrow', async () => {
          const converter = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(['uint256'], [2]),
            usdc,
            dai,
            parseUnits('7', 18),
            {
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('3', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('7', 18),
                  converter,
                },
              ],
              findBorrowStrategyOutputs: [
                {
                  converters: [converter],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(['uint256'], [2]),
                  aprs18: [parseUnits('1', 18)],
                  amountIn: parseUnits('7', 18),
                  amountToBorrowsOut: [parseUnits('7', 18)],
                  collateralAmountsOut: [parseUnits('3', 6)],
                },
              ],
              amountBorrowAssetForTetuConverter: parseUnits('7', 18),
              amountCollateralForFacade: parseUnits('3', 6),
              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('3', 6), parseUnits('7', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it(
          'should return expected values, two platforms together have exactly required amount (unreal case)',
          async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256'], [2]),
              usdc,
              dai,
              parseUnits('62', 18),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: dai.address,
                    entryData: defaultAbiCoder.encode(['uint256'], [2]),
                    aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                    amountIn: parseUnits('62', 18),
                    collateralAmountsOut: [parseUnits('70', 6), parseUnits('30', 6)],
                    amountToBorrowsOut: [parseUnits('50', 18), parseUnits('12', 18)],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('70', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('50', 18),
                    converter: converter1,
                  }, {
                    collateralAsset: usdc,
                    collateralAmount: parseUnits('30', 6),
                    borrowAsset: dai,
                    amountToBorrow: parseUnits('12', 18),
                    converter: converter2,
                  },
                ],
                amountCollateralForFacade: parseUnits('100', 6),
                amountBorrowAssetForTetuConverter: parseUnits('62', 18),

                amountInIsCollateral: true,
              },
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits('100', 6), parseUnits('62', 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          },
        );
        it('should return expected values, two borrows, platforms don\'t have enough amount', async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(['uint256'], [2]),
            usdc,
            dai,
            parseUnits('62', 18),
            {
              findBorrowStrategyOutputs: [
                {
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(['uint256'], [2]),
                  aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                  amountIn: parseUnits('62', 18),
                  amountToBorrowsOut: [parseUnits('13', 18), parseUnits('41', 18)],
                  collateralAmountsOut: [parseUnits('20', 6), parseUnits('60', 6)],
                },
              ],
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('20', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('13', 18),
                  converter: converter1,
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('60', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('41', 18),
                  converter: converter2,
                },
              ],
              amountCollateralForFacade: parseUnits('80', 6),
              amountBorrowAssetForTetuConverter: parseUnits('54', 18),
              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('80', 6), parseUnits('54', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it('should return expected values, two borrows, platforms have more then required liquidity', async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(['uint256'], [2]),
            usdc,
            dai,
            parseUnits('91', 18),
            {
              findBorrowStrategyOutputs: [
                {
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(['uint256'], [2]),
                  aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                  amountIn: parseUnits('91', 18),
                  collateralAmountsOut: [parseUnits('215', 6), parseUnits('465', 6)],
                  amountToBorrowsOut: [parseUnits('81', 18), parseUnits('93', 18)],
                },
              ],
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('215', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('81', 18),
                  converter: converter1,
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits('50', 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits('10', 18), // 93 * (91-81)/93
                  converter: converter2,
                },
              ],
              amountCollateralForFacade: parseUnits('265', 6), // 215 + 465 * (91-81)/93
              amountBorrowAssetForTetuConverter: parseUnits('91', 18), // 81 + 93 * (91-81)/93
              amountInIsCollateral: true,
            },
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits('265', 6), parseUnits('91', 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        describe('threshold is used, first conversion provides a bit less amount than required', () => {
          it('should return expected values, single borrow', async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(['uint256'], [2]),
              usdc,
              weth,
              BigNumber.from('1720944043846096429'),
              {
                findBorrowStrategyOutputs: [
                  {
                    converters: [converter1, converter2],
                    sourceToken: usdc.address,
                    targetToken: weth.address,
                    entryData: defaultAbiCoder.encode(['uint256'], [2]),
                    aprs18: [parseUnits('1', 18)],
                    amountIn: BigNumber.from('9762660842'),
                    collateralAmountsOut: [
                      BigNumber.from('9762660842'),
                      BigNumber.from('9762660842'),
                    ],
                    amountToBorrowsOut: [
                      BigNumber.from('1720944043846096427'), // () 1720944043846096429 - 2
                      BigNumber.from('1712848453478843025'),
                    ],
                  },
                ],
                borrows: [
                  {
                    collateralAsset: usdc,
                    collateralAmount: BigNumber.from('9762660842'),
                    borrowAsset: weth,
                    amountToBorrow: BigNumber.from('1720944043846096427'),
                    converter: converter1,
                  },
                ],
                amountBorrowAssetForTetuConverter: BigNumber.from('1720944043846096429'),
                amountCollateralForFacade: BigNumber.from('9762660842'),
                amountInIsCollateral: true,
                prices: {
                  collateral: BigNumber.from('998200000000000000'),
                  borrow: BigNumber.from('1696840000000000000000'),
                },
              },
            );

            const ret = [
              r.collateralAmountOut,
              r.borrowedAmountOut,
              r.balanceBorrowAssetTetuConverter,
            ].map(x => BalanceUtils.toString(x)).join();
            const expected = [
              BigNumber.from('9762660842'),
              BigNumber.from('1720944043846096427'),
              BigNumber.from(2),
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Amount < DEFAULT_OPEN_POSITION_AMOUNT_IN_THRESHOLD", () => {
        it("should return zero amounts", async () => {
          const r = await makeOpenPositionTest(
            '0x',
            usdc,
            dai,
            BigNumber.from(1), // (!) we ask for amount that is less than default threshold
            {
              borrows: [],
              findBorrowStrategyOutputs: [],
              amountCollateralForFacade: parseUnits('3', 6),
              amountBorrowAssetForTetuConverter: parseUnits('3', 18),
              amountInIsCollateral: true,
            },
          );

          expect(r.collateralAmountOut.eq(0)).eq(true);
          expect(r.borrowedAmountOut.eq(0)).eq(true);
        });
      })
      describe("No converters were found", () => {
        it("should return zero amounts", async () => {
          const r = await makeOpenPositionTest(
            '0x',
            usdc,
            dai,
            parseUnits('11', 6),
            {
              borrows: [],
              findBorrowStrategyOutputs: [{
                converters: [],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: '0x',
                aprs18: [],
                amountIn: parseUnits('11', 6),
                collateralAmountsOut: [],
                amountToBorrowsOut: [],
              }],
              amountCollateralForFacade: parseUnits('3', 6),
              amountBorrowAssetForTetuConverter: parseUnits('3', 18),
              amountInIsCollateral: true,
            },
          );

          expect(r.collateralAmountOut.eq(0)).eq(true);
          expect(r.borrowedAmountOut.eq(0)).eq(true);
        });
      });
    })
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limits', async () => {
        const converter1 = ethers.Wallet.createRandom().address;
        const converter2 = ethers.Wallet.createRandom().address;
        const r = await makeOpenPositionTest(
          '0x',
          usdc,
          dai,
          parseUnits('103', 6), // (!) we asked too much, lending platforms have DAI for $3 in total
          {
            borrows: [
              {
                collateralAsset: usdc,
                collateralAmount: parseUnits('1', 6),
                borrowAsset: dai,
                amountToBorrow: parseUnits('1', 18),
                converter: converter1,
              }, {
                collateralAsset: usdc,
                collateralAmount: parseUnits('2', 6),
                borrowAsset: dai,
                amountToBorrow: parseUnits('2', 18),
                converter: converter2,
              },
            ],
            findBorrowStrategyOutputs: [
              {
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: '0x',
                aprs18: [parseUnits('1', 18), parseUnits('2', 18)],
                amountIn: parseUnits('3', 6),
                amountToBorrowsOut: [parseUnits('1', 18), parseUnits('2', 18)],
                collateralAmountsOut: [parseUnits('1', 6), parseUnits('2', 6)],
              },
            ],
            amountCollateralForFacade: parseUnits('3', 6),
            amountBorrowAssetForTetuConverter: parseUnits('3', 18),
            amountInIsCollateral: true,
          },
        );

        controlGasLimitsEx(r.gasUsed, GAS_OPEN_POSITION, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("makeRequestedAmount", () => {
    interface IMakeRequestedAmountResults {
      expectedAmountMainAsset: number;
      gasUsed: BigNumber;
      balances: number[];
    }

    interface IMakeRequestedAmountParams {
      requestedAmount: string;
      tokens: MockToken[];
      indexAsset: number;
      balances: string[];
      prices: string[];
      liquidationThresholds: string[];
      liquidations: ILiquidationParams[];
      quoteRepays: IQuoteRepayParams[];
      repays: IRepayParams[];
      isConversionValid?: boolean;
    }

    async function makeRequestedAmountTest(
      p: IMakeRequestedAmountParams
    ): Promise<IMakeRequestedAmountResults> {
      // set up balances
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);

        // set up current balances
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], d));
        console.log("mint", i, p.balances[i]);

        // set up liquidation threshold for token
        await facade.setLiquidationThreshold(p.tokens[i].address, parseUnits(p.liquidationThresholds[i], d));
      }

      // set up price oracle
      const converter = await MockHelper.createMockTetuConverter(signer);
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        p.tokens.map(x => x.address),
        p.prices.map(price => parseUnits(price, 18))
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(controller.address);


      // set up repay and quoteRepay in converter
      for (const repay of p.repays) {
        await setupMockedRepay(converter, facade.address, repay);
      }
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }

      // set up expected liquidations
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
        const isConversionValid = p.isConversionValid === undefined ? true : p.isConversionValid;
        await setupIsConversionValid(converter, liquidation, isConversionValid)
      }

      // make test
      const ret = await facade.callStatic._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        converter.address,
        liquidator.address,
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexAsset]),
      );

      const tx = await facade._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        converter.address,
        liquidator.address,
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexAsset]),
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedAmountMainAsset: +formatUnits(ret, decimals[p.indexAsset]),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(facade.address), decimals[index])
          )
        )
      }
    }

    describe("Good paths", () => {
      describe("two assets, same prices", () => {
        describe("1. All amount is on balance, no debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "5000", // usdc; it should include current balance
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["2500", "0"], // usdc, dai
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [],
              quoteRepays: [],
              repays: [],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(2500 + 0);
          });
          it("should provide requested amount on balance", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2500, 0].join());
          });
        });
        describe("2. Repay debt (usdt=>usdc), swap (usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "3000", // usdc; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "1000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{amountIn: "950", amountOut: "950", tokenIn: usdt, tokenOut: usdc}],
              quoteRepays: [{  // this debt is not used
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "50",
                collateralAmountOut: "100"
              }],
              repays: [{  // this debt is not used
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "50", // usdt
                collateralAmountOut: "100", // usdc
                totalDebtAmountOut: "50",
                totalCollateralAmountOut: "100"
              }],
            });
          }

          it("should return expected expectedAmountMainAsset", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(1000 + 1050); // final balance
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2050, 0].join());
          });
        });
        describe("3. Swap(usdc=>usdt), repay(usdt=>usdc), ", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "16000", // usdc, we need to get as much as possible; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["6000", "999"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "6000", amountOut: "6007", tokenIn: usdc, tokenOut: usdt},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "7006", // 60007 + 999
                collateralAmountOut: "10080"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "7006", // usdt
                collateralAmountOut: "10081", // usdc
                totalDebtAmountOut: "400000",
                totalCollateralAmountOut: "800000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(10080);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([10081, 0].join()); // 10080 - 6000 + 6000
          });
        });
        describe("4. Swap(usdc=>usdt), repay(usdt=>usdc),", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "70000", // usdc, we need to get as much as possible; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["60000", "999"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "10100", amountOut: "10200", tokenIn: usdc, tokenOut: usdt},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "11199", // 10200 - 999
                collateralAmountOut: "22000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "11199", // usdt
                collateralAmountOut: "22001", // usdc
                totalDebtAmountOut: "400000",
                totalCollateralAmountOut: "800000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(71900);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([71901, 0].join()); // 60000 - 10100 + 22001
          });
        });
        describe("5. Swap(usdc=>usdt)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "3004", // usdc; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1004", "1002"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{amountIn: "1002", amountOut: "1003", tokenIn: usdt, tokenOut: usdc}],
              quoteRepays: [],
              repays: [],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(1004 + 1002);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1004 + 1003, 0].join());
          });
        });
        describe("6. Swap(usdc=>usdt)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "3000", // usdc; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "103"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{amountIn: "103", amountOut: "120", tokenIn: usdt, tokenOut: usdc}],
              quoteRepays: [],
              repays: [],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            // 1000 (initial balance) + 103 (103 is converted directly by prices to 103)
            expect(r.expectedAmountMainAsset).eq(1000 + 103);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1000 + 120, 0].join());
          });
        });
        describe("7. Swap(usdc=>usdt), repay(usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "11001", // usdc, we need to get as much as possible; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["3001", "2000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "3001", amountOut: "4000", tokenIn: usdc, tokenOut: usdt},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "6000",
                collateralAmountOut: "12000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "6000", // usdt
                collateralAmountOut: "12000", // usdc
                totalDebtAmountOut: "400000",
                totalCollateralAmountOut: "800000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(12000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([3001 - 3001 + 12000, 0].join());
          });
        });
        describe("8. Swap(usdc=>usdt), repay(usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "17000", // usdc, we need to get as much as possible; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["3000", "2000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "3000", amountOut: "4000", tokenIn: usdc, tokenOut: usdt},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "6000", // 4041 + 999
                collateralAmountOut: "10000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "6000", // usdt
                collateralAmountOut: "10000", // usdc
                totalDebtAmountOut: "6000",
                totalCollateralAmountOut: "10000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(10000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([10000, 0].join()); // 3000 - 3000 + 10000
          });
        });
        describe("9. Repay(usdt=>usdc), swap(usdt=>usdc), ", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "200100", // usdc; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["100", "8000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "7000", amountOut: "7001", tokenIn: usdt, tokenOut: usdc},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "1000",
                collateralAmountOut: "2000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "1000", // usdt
                collateralAmountOut: "2000", // usdc
                totalDebtAmountOut: "1000",
                totalCollateralAmountOut: "2000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(9100);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([9101, 0].join());
          });
        });
        describe("10. Swap(usdc=>usdt), swap(usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "201000", // usdc; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "1500"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                // 500 + 1%
                {amountIn: "505", amountOut: "500", tokenIn: usdc, tokenOut: usdt},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "2000",
                collateralAmountOut: "4000"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "2000", // usdt
                collateralAmountOut: "4000", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "4000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(1000 - 505 + 4000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1000 - 505 + 4000, 0].join());
          });
        });
      });
      describe("three assets, same prices", () => {
        describe("swap(usdc=>dai,usdt), repay(dai,usdt=>usdc), swap(dai,usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "116000", // usdc; it should include current balance
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["6000", "2000", "4000"], // usdc, dai, usdt
              prices: ["1", "1", "1"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              liquidations: [
                {amountIn: "1010", amountOut: "1010", tokenIn: usdc, tokenOut: dai},
                {amountIn: "3030", amountOut: "3030", tokenIn: usdc, tokenOut: usdt},
                {amountIn: "10", amountOut: "9", tokenIn: dai, tokenOut: usdc},
                {amountIn: "30", amountOut: "29", tokenIn: usdt, tokenOut: usdc},
              ],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "3000", collateralAmountOut: "4000"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "7000", collateralAmountOut: "9000"},
              ],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "3000", // dai
                collateralAmountOut: "4000", // usdc
                totalDebtAmountOut: "3000",
                totalCollateralAmountOut: "4000"
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "7000", // usdt
                collateralAmountOut: "9000", // usdc
                totalDebtAmountOut: "7000",
                totalCollateralAmountOut: "9000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(15000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([15038 - 40, 0, 0].join());
          });
        });
        describe("repay(usdc=>dai,usdt), swap(dai,usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "203000", // usdc; it should include current balance
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ["3000", "97", "5000"], // dai, usdc, usdt
              prices: ["1", "1", "1"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "1000", collateralAmountOut: "1900"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "2000", collateralAmountOut: "2900"}
              ],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "1000", // dai
                collateralAmountOut: "1900", // usdc
                totalDebtAmountOut: "1000",
                totalCollateralAmountOut: "1900"
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "2000", // usdt
                collateralAmountOut: "2900", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "2900"
              }],
              liquidations: [
                {amountIn: "3000", amountOut: "3001", tokenIn: usdt, tokenOut: usdc}, // balance - totalDebtAmountOut
                {amountIn: "2000", amountOut: "2001", tokenIn: dai, tokenOut: usdc},  // balance - totalDebtAmountOut
              ],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(9800 + 97);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([0, 9899, 0].join()); // 97 + 2900 + 1900 + 3001 + 2001
          });
        });
      });
      describe("three assets, different prices", () => {
        describe("swap(usdc=>dai,usdt), repay(dai,usdt=>usdc), swap(dai,usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "116000", // usdc; it should include current balance
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["6000", "20000", "400"], // usdc, dai, usdt
              prices: ["1", "0.1", "10"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              liquidations: [
                {amountIn: "1010", amountOut: "10100", tokenIn: usdc, tokenOut: dai}, // + 1%
                {amountIn: "3030", amountOut: "303", tokenIn: usdc, tokenOut: usdt}, // +
                {amountIn: "100", amountOut: "9", tokenIn: dai, tokenOut: usdc},
                {amountIn: "3", amountOut: "29", tokenIn: usdt, tokenOut: usdc},
              ],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "30000", collateralAmountOut: "4000"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "700", collateralAmountOut: "9000"},
              ],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "30000", // dai
                collateralAmountOut: "4000", // usdc
                totalDebtAmountOut: "30000",
                totalCollateralAmountOut: "4000"
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "700", // usdt
                collateralAmountOut: "9000", // usdc
                totalDebtAmountOut: "700",
                totalCollateralAmountOut: "9000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(9000 + 6000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([15038 - 40, 0, 0].join());
          });
        });
        describe("repay(dai,usdt=>usdc), swap(dai,usdt=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "203000", // usdc; it should include current balance
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ["30000", "97", "500"], // dai, usdc, usdt
              prices: ["0.1", "1", "10"],
              liquidationThresholds: ["0", "0", "0"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "10000", collateralAmountOut: "1900"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "200", collateralAmountOut: "2900"}
              ],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "10000", // dai
                collateralAmountOut: "1900", // usdc
                totalDebtAmountOut: "10000",
                totalCollateralAmountOut: "1900"
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "200", // usdt
                collateralAmountOut: "2900", // usdc
                totalDebtAmountOut: "200",
                totalCollateralAmountOut: "2900"
              }],
              liquidations: [
                {amountIn: "300", amountOut: "3001", tokenIn: usdt, tokenOut: usdc}, // balance - totalDebtAmountOut
                {amountIn: "20000", amountOut: "2001", tokenIn: dai, tokenOut: usdc},  // balance - totalDebtAmountOut
              ],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(9800 + 97); // 2900*200/500 + 1900*100/300 + 3000 + 2000, see fix SCB-779
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([0, 9899, 0].join()); // 97 + 2900 + 1900 + 3001 + 2001
          });
        });
      });
      describe("requestAmounts == max int", () => {
        describe("repay(dai, usdt=>usdc), swap(dai,usd=>usdc)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "", // Misc.MAX_UINT, // usdc
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ["3000", "97", "5000"], // dai, usdc, usdt
              prices: ["1", "1", "1"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "1000", collateralAmountOut: "1900"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "2000", collateralAmountOut: "2900"}
              ],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "1000", // dai
                collateralAmountOut: "1900", // usdc
                totalDebtAmountOut: "1000",
                totalCollateralAmountOut: "1900"
              }, {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "2000", // usdt
                collateralAmountOut: "2900", // usdc
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "2900"
              }],
              liquidations: [
                {amountIn: "3000", amountOut: "3001", tokenIn: usdt, tokenOut: usdc}, // balance - totalDebtAmountOut
                {amountIn: "2000", amountOut: "2001", tokenIn: dai, tokenOut: usdc},  // balance - totalDebtAmountOut
              ],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(9800 + 97);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([0, 9899, 0].join()); // 97 + 2900 + 1900 + 3001 + 2001
          });
        });
      });
    });
  });
//endregion Unit tests
});
