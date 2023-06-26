import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
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
import {setupMockedBorrow, setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW, GAS_PERFORMANCE_FEE, GET_LIQUIDITY_AMOUNT_RATIO
} from "../../baseUT/GasLimits";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 *
 * Following tests are created using fixtures, not snapshots
 */
describe('ConverterStrategyBaseLibFixTest', () => {
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

  describe('convertAfterWithdraw', () => {
    interface IConvertAfterWithdrawResults {
      collateralOut: number;
      repaidAmountsOut: number[];
      gasUsed: BigNumber;
      balances: number[];
    }

    interface IConvertAfterWithdrawParams {
      tokens: MockToken[];
      indexAsset: number;
      liquidationThresholds?: string[];
      amountsToConvert: string[];
      balances: string[];
      prices: string[];
      liquidations: ILiquidationParams[];
      repays: IRepayParams[];
      isConversionValid?: boolean;
    }

    async function makeConvertAfterWithdraw(p: IConvertAfterWithdrawParams): Promise<IConvertAfterWithdrawResults> {
      // set up balances
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);

        // set up current balances
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], d));
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

      // set up repay
      for (const repay of p.repays) {
        await setupMockedRepay(converter, facade.address, repay);
      }

      // set up expected liquidations
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
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

      const liquidationThresholds: BigNumber[] = p.liquidationThresholds
        ? await Promise.all(p.liquidationThresholds.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()),
        ))
        : p.tokens.map(x => BigNumber.from(0));

      // make test
      const ret = await facade.callStatic.convertAfterWithdraw(
        converter.address,
        liquidator.address,
        p.indexAsset,
        liquidationThresholds,
        p.tokens.map(x => x.address),
        p.amountsToConvert.map(
          (x, index) => parseUnits(x, decimals[index])
        )
      );

      const tx = await facade.convertAfterWithdraw(
        converter.address,
        liquidator.address,
        p.indexAsset,
        liquidationThresholds,
        p.tokens.map(x => x.address),
        p.amountsToConvert.map(
          (x, index) => parseUnits(x, decimals[index])
        )
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        collateralOut: +formatUnits(ret.collateralOut, decimals[p.indexAsset]),
        repaidAmountsOut: ret.repaidAmountsOut.map(
          (amount, index) => +formatUnits(amount, decimals[index])
        ),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(facade.address), decimals[index])
          )
        )
      }
    }

    describe('Good paths', () => {
      describe('Repay only, no liquidation (amountsToConvert == repaidAmountsOut)', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
          return makeConvertAfterWithdraw({
            tokens: [dai, usdc, usdt],
            indexAsset: 1, // usdc
            amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
            balances: ["200", "91", "900"], // dai, usdc, usdt
            liquidationThresholds: ["0", "0", "0"],
            repays: [
              {
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "200",
                collateralAmountOut: "401",
                totalDebtAmountOut: "400",
                totalCollateralAmountOut: "802"
              },
              {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "500",
                collateralAmountOut: "1003",
                totalDebtAmountOut: "1800",
                totalCollateralAmountOut: "2006"
              },
            ],
            liquidations: [],
            prices: ["1", "1", "1"] // for simplicity
          });
        }

        it('should return expected collateralOut', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.collateralOut).eq(1404); // 401 + 1003
        });
        it('should return expected repaidAmountsOut', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.repaidAmountsOut.join()).eq(["200", "0", "500"].join());
        });
        it('should set expected balances', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.balances.join()).eq(["0", "1495", "400"].join()); // 200-200, 91 + 401 + 1003, 900 - 500
        });
        it('should not exceed gas limits @skip-on-coverage', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
      describe('Repay + liquidation of leftovers (amountsToConvert > repaidAmountsOut)', () => {
        describe("Leftovers > liquidation threshold", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
            return makeConvertAfterWithdraw({
              tokens: [dai, usdc, usdt],
              indexAsset: 1, // usdc
              amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
              balances: ["200", "91", "900"], // dai, usdc, usdt
              liquidationThresholds: ["0", "0", "0"],
              repays: [
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "150",
                  collateralAmountOut: "200",
                  totalDebtAmountOut: "150",
                  totalCollateralAmountOut: "200"
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  amountRepay: "270",
                  collateralAmountOut: "370",
                  totalDebtAmountOut: "270",
                  totalCollateralAmountOut: "370"
                },
              ],
              liquidations: [
                {tokenIn: dai, tokenOut: usdc, amountIn: "50", amountOut: "90"}, // 200 - 150
                {tokenIn: usdt, tokenOut: usdc, amountIn: "230", amountOut: "311"}, // 500 - 270
              ],
              prices: ["1", "1", "1"] // for simplicity
            });
          }

          it('should return expected collateralOut', async () => {
            const r = await loadFixture(makeConvertAfterWithdrawFixture);
            expect(r.collateralOut).eq(971); // 200 + 370 + 90 + 311
          });
          it('should return expected repaidAmountsOut', async () => {
            const r = await loadFixture(makeConvertAfterWithdrawFixture);
            expect(r.repaidAmountsOut.join()).eq(["200", "0", "500"].join());
          });
          it('should set expected balances', async () => {
            const r = await loadFixture(makeConvertAfterWithdrawFixture);
            expect(r.balances.join()).eq(["0", "1062", "400"].join()); // 200-200, 91 + 200 + 370 + 90 + 311, 900 - 500
          });
        });
        describe("Leftovers < liquidation threshold", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
            return makeConvertAfterWithdraw({
              tokens: [dai, usdc, usdt],
              indexAsset: 1, // usdc
              amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
              balances: ["200", "91", "900"], // dai, usdc, usdt
              liquidationThresholds: ["51", "0", "231"], // (!) these thresholds are greater than liquidation in-amounts
              repays: [
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "150",
                  collateralAmountOut: "200",
                  totalDebtAmountOut: "150",
                  totalCollateralAmountOut: "200"
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  amountRepay: "270",
                  collateralAmountOut: "370",
                  totalDebtAmountOut: "270",
                  totalCollateralAmountOut: "370"
                },
              ],
              liquidations: [
                // we need to register these liquidation, but actually they don't happen because of the high threshold
                {tokenIn: dai, tokenOut: usdc, amountIn: "50", amountOut: "90"}, // 200 - 150
                {tokenIn: usdt, tokenOut: usdc, amountIn: "230", amountOut: "311"}, // 500 - 270
              ],
              prices: ["1", "1", "1"] // for simplicity
            });
          }

          it('should return expected collateralOut', async () => {
            const r = await loadFixture(makeConvertAfterWithdrawFixture);
            expect(r.collateralOut).eq(570); // 200 + 370
          });
          it('should return expected repaidAmountsOut', async () => {
            const r = await loadFixture(makeConvertAfterWithdrawFixture);
            expect(r.repaidAmountsOut.join()).eq(["150", "0", "270"].join());
          });
          it('should set expected balances', async () => {
            const r = await loadFixture(makeConvertAfterWithdrawFixture);
            expect(r.balances.join()).eq(["50", "661", "630"].join()); // 200-150, 91 + 200 + 370, 900 - 270
          });
        });
      });
      describe('usdc + usdt, amountsToConvert is zero for usdt', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
          return makeConvertAfterWithdraw({
            tokens: [usdc, usdt],
            indexAsset: 0, // usdc
            amountsToConvert: ["91", "0"], // usdc, usdt
            balances: ["91", "0"], // usdc, usdt
            liquidationThresholds: ["0", "0"],
            repays: [],
            liquidations: [],
            prices: ["1", "1"] // for simplicity
          });
        }

        it('should return expected collateralOut', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.collateralOut).eq(0);
        });
        it('should return expected repaidAmountsOut', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.repaidAmountsOut.join()).eq(["0", "0"].join());
        });
        it('should set expected balances', async () => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.balances.join()).eq(["91", "0"].join());
        });
      });
    });
    describe('Bad paths', () => {
      describe('Liquidation of leftovers happens with too high price impact', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it('should revert', async () => {
          const p: IConvertAfterWithdrawParams = {
            tokens: [dai, usdc, usdt],
            indexAsset: 1, // usdc
            amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
            balances: ["200", "91", "900"], // dai, usdc, usdt
            liquidationThresholds: ["0", "0", "0"],
            repays: [
              {
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "150",
                collateralAmountOut: "200",
                totalDebtAmountOut: "150",
                totalCollateralAmountOut: "200",
              },
              {
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "270",
                collateralAmountOut: "370",
                totalDebtAmountOut: "270",
                totalCollateralAmountOut: "370"
              },
            ],
            liquidations: [
              {tokenIn: dai, tokenOut: usdc, amountIn: "50", amountOut: "90"}, // 200 - 150
              {tokenIn: usdt, tokenOut: usdc, amountIn: "230", amountOut: "311"}, // 500 - 270
            ],
            prices: ["1", "1", "1"], // for simplicity
            isConversionValid: false // (!)
          };
          await expect(makeConvertAfterWithdraw(p)).revertedWith('TS-16 price impact'); // PRICE_IMPACT
        });
      });
    });
  });

  describe("closePositionsToGetAmount", () => {
    interface IClosePositionToGetRequestedAmountResults {
      expectedAmountMainAssetOut: number;
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
        expectedAmountMainAssetOut: +formatUnits(ret, decimals[p.indexAsset]),
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
            expect(r.expectedAmountMainAssetOut).eq(1870); // 2880 - 1010
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
            expect(r.expectedAmountMainAssetOut).eq(150); // 450-300
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
                { // _getAmountToSell gives 2020 instead 2000, so 20 exceed usdc will be exhanged
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

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedAmountMainAssetOut).eq(1000); // 3000 - 2020 + 20
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
            expect(r.expectedAmountMainAssetOut).eq(780); // 2800 - 2020
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
            expect(r.expectedAmountMainAssetOut).eq(780); // 2800 - 2020
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
            expect(r.expectedAmountMainAssetOut).eq(980); // 3000 - 2020
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
             * Convert 1010+400 usdc to 2115 dai
             * Convert 2115 dai to 2115 usdc
             */
            return makeClosePositionToGetRequestedAmountTest({
              requestedAmount: "500", // usdc
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

          it("should return expected amount", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.expectedAmountMainAssetOut).eq(2115);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
            expect(r.balances.join()).eq([2115, 0].join()); // 2880 + 2000 - 1010
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
          expect(r.expectedAmountMainAssetOut).eq(0);
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
          expect(r.expectedAmountMainAssetOut).eq(0);
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

        it("should return zero expected amount", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedAmountMainAssetOut).eq(0);
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

        it("should return zero expected amount", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedAmountMainAssetOut).eq(0);
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

        it("should return zero expected amount", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedAmountMainAssetOut).eq(0);
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
      if (! p.noLiquidationRoute) {
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

  describe("swapToGivenAmount", () => {
    interface ISwapToGivenAmountParams {
      targetAmount: string;
      tokens: MockToken[];
      indexTargetAsset: number;
      underlying: MockToken;
      liquidationThresholds?: string[];
      overswap: number;

      amounts: string[];
      prices: string[];
      liquidations: ILiquidationParams[];
      balances: string[];
    }

    interface ISwapToGivenAmountResults {
      spentAmounts: number[];
      receivedAmounts: number[];
      balances: number[];
      gasUsed: BigNumber;
    }

    async function makeSwapToGivenAmountTest(p: ISwapToGivenAmountParams): Promise<ISwapToGivenAmountResults> {
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);

        // withdrawn amounts
        await p.tokens[i].mint(facade.address, parseUnits(p.amounts[i], d));
        console.log("mint", i, p.amounts[i]);

        // balances
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], d));
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
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
        await setupIsConversionValid(converter, liquidation, true);
      }

      const liquidationThresholds: BigNumber[] = p.liquidationThresholds
        ? await Promise.all(p.liquidationThresholds.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()),
        ))
        : p.tokens.map(x => BigNumber.from(0));



      const r = await facade.callStatic.swapToGivenAmountAccess(
        parseUnits(p.targetAmount, decimals[p.indexTargetAsset]),
        p.tokens.map(x => x.address),
        p.indexTargetAsset,
        p.underlying.address,
        converter.address,
        liquidator.address,
        liquidationThresholds,
        p.overswap
      );
      console.log("r", r);
      const tx = await facade.swapToGivenAmountAccess(
        parseUnits(p.targetAmount, decimals[p.indexTargetAsset]),
        p.tokens.map(x => x.address),
        p.indexTargetAsset,
        p.underlying.address,
        converter.address,
        liquidator.address,
        liquidationThresholds,
        p.overswap
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        spentAmounts: r.spentAmounts.map((x, index) => +formatUnits(x, decimals[index])),
        receivedAmounts: r.receivedAmounts.map((x, index) => +formatUnits(x, decimals[index])),
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(facade.address), decimals[index])
          )
        ),
        gasUsed
      }
    }

    describe("single liquidation is required", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeSwapToGivenAmountFixture(): Promise<ISwapToGivenAmountResults> {
        return makeSwapToGivenAmountTest({
          targetAmount: "10",
          tokens: [tetu, usdc, usdt, dai],
          indexTargetAsset: 0, // TETU
          underlying: usdc,
          liquidationThresholds: ["0", "0", "0", "0"],
          overswap: 50_000, // we are going to swap twice more than it's necessary according calculations by prices

          amounts: ["1000", "2000", "4000", "5000"], // == $100, $400, $1600, $2500
          prices: ["0.1", "0.2", "0.4", "0.5"],
          liquidations: [{
            amountIn: "3.75",
            amountOut: "15",// 10 tetu + 50% of overswap
            tokenIn: usdt,
            tokenOut: tetu
          }],
          // we assume, that balance of target asset < targetAmount, see requirePayAmountBack implementation
          balances: ["100", "200", "400", "500"],
        });
      }

      it("should return expected spentAmounts", async () => {
        const r = await loadFixture(makeSwapToGivenAmountFixture);
        expect(r.spentAmounts.join()).eq([0, 0, 3.75, 0].join());
      });
      it("should return expected receivedAmounts", async () => {
        const r = await loadFixture(makeSwapToGivenAmountFixture);
        expect(r.receivedAmounts.join()).eq([15, 0, 0, 0].join());
      });
      it("should return expected balances", async () => {
        const r = await loadFixture(makeSwapToGivenAmountFixture);
        // initial balances + amounts (withdrawn) +/- liquidation amounts
        expect(r.balances.join()).eq([1115, 2200, 4396.25, 5500].join());
      });
    });
    describe("two liquidations are required", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeSwapToGivenAmountFixture(): Promise<ISwapToGivenAmountResults> {
        return makeSwapToGivenAmountTest({
          targetAmount: "16010",
          tokens: [tetu, usdc, usdt, dai],
          indexTargetAsset: 0, // TETU
          underlying: usdc,
          liquidationThresholds: ["0", "0", "0", "0"],
          overswap: 50_000, // we are going to swap twice more than it's necessary according calculations by prices

          amounts: ["900", "1800", "3600", "4500"], // == $100, $400, $1600, $2500
          prices: ["0.1", "0.2", "0.4", "0.5"],
          liquidations: [
            {
              amountIn: "4000",
              amountOut: "16000",
              tokenIn: usdt,
              tokenOut: tetu
            },
            {
              amountIn: "3",
              amountOut: "15",
              tokenIn: dai,
              tokenOut: tetu
            },
          ],
          // we assume, that balance of target asset < targetAmount, see requirePayAmountBack implementation
          balances: ["100", "200", "400", "500"],
        });
      }

      it("should return expected spentAmounts", async () => {
        const r = await loadFixture(makeSwapToGivenAmountFixture);
        expect(r.spentAmounts.join()).eq([0, 0, 4000, 3].join());
      });
      it("should return expected receivedAmounts", async () => {
        const r = await loadFixture(makeSwapToGivenAmountFixture);
        expect(r.receivedAmounts.join()).eq([16015, 0, 0, 0].join()); // 16000 + 15
      });
      it("should return expected balances", async () => {
        const r = await loadFixture(makeSwapToGivenAmountFixture);
        expect(r.balances.join()).eq([17015, 2000, 0, 4997].join());
      });
    });
  });

  describe("registerIncome", () => {
    it("should return expected values if after > before", async () => {
      const r = await facade.registerIncome(1, 2);
      expect(r.earned.toNumber()).eq(1);
      expect(r.lost.toNumber()).eq(0);
    });
    it("should return expected values if after < before", async () => {
      const r = await facade.registerIncome(2, 1);
      expect(r.earned.toNumber()).eq(0);
      expect(r.lost.toNumber()).eq(1);
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

    interface ISendTokensToForwarderResults {
      allowanceForForwarder: number[];
      tokensToForwarder: string[];
      amountsToForwarder: number[];
      splitterToForwarder: string;
      isDistributeToForwarder: boolean;
    }

    interface ISendTokensToForwarderParams {
      tokens: MockToken[];
      amounts: string[];
      vault: string;
    }

    async function makeSendTokensToForwarderTest(p: ISendTokensToForwarderParams): Promise<ISendTokensToForwarderResults> {
      const controller = await MockHelper.createMockController(signer);
      const forwarder = await MockHelper.createMockForwarder(signer);
      await controller.setForwarder(forwarder.address);
      const splitter = await MockHelper.createMockSplitter(signer);
      await splitter.setVault(p.vault);

      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        decimals.push(await p.tokens[i].decimals());
        await p.tokens[i].mint(facade.address, parseUnits(p.amounts[i], decimals[i]));
      }

      await facade.sendTokensToForwarder(
        controller.address,
        splitter.address,
        p.tokens.map(x => x.address),
        p.amounts.map((amount, index) => parseUnits(amount, decimals[index]))
      );

      const r = await forwarder.getLastRegisterIncomeResults();
      return {
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
  });

  describe("claimConverterRewards", () => {
    interface IClaimConverterRewardsParams {
      /**
       * Balances of tokens at the moment of the call of {claimConverterRewards}
       */
      balances: ITokenAmountNum[];

      /**
       * Balances of tokens before the call of {depositorClaimRewards} followed by the call of {claimConverterRewards}
       * see _claim()
       */
      balancesBefore: ITokenAmountNum[];

      /**
       * Depositor pool assets
       */
      tokens: MockToken[];

      depositorRewardTokens: MockToken[];
      depositorRewardAmounts: string[];

      converterRewardTokens: MockToken[];
      converterRewardAmounts: string[];
    }

    interface IClaimConverterRewardsResults {
      /**
       * Amounts corresponding to each token name
       */
      amounts: string[];
      /**
       * Result ordered list of token names, i.e. usdc, usdt, dai, tetu...
       */
      tokenNames: string[];
    }

    async function makeClaimConverterRewards(p: IClaimConverterRewardsParams): Promise<IClaimConverterRewardsResults> {
      // set up initial balances
      for (const t of p.balances) {
        await t.token.mint(
          facade.address,
          parseUnits(t.amount, await t.token.decimals())
        )
      }

      // set up rewards in the converter
      const converter = await MockHelper.createMockTetuConverter(signer);
      await converter.setClaimRewards(
        p.converterRewardTokens.map(x => x.address),
        await Promise.all(p.converterRewardAmounts.map(
          async (amount, index) => parseUnits(
            amount,
            await p.converterRewardTokens[index].decimals()
          )
        )),
      )
      for (let i = 0; i < p.converterRewardTokens.length; ++i) {
        await p.converterRewardTokens[i].mint(
          converter.address,
          parseUnits(p.converterRewardAmounts[i], await p.converterRewardTokens[i].decimals())
        )
      }

      // call claimConverterRewards
      const {tokensOut, amountsOut} = await facade.callStatic.claimConverterRewards(
        converter.address,
        p.tokens.map(x => x.address),
        p.depositorRewardTokens.map(x => x.address),
        await Promise.all(p.depositorRewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.depositorRewardTokens[index].decimals())
        )),
        await Promise.all(p.balancesBefore.map(
          async x => parseUnits(x.amount, await x.token.decimals())
        )),
      );

      const orderedResults: { tokenName: string, amount: string }[] = (await Promise.all(
        tokensOut.map(
          async (x, index) => ({
            tokenName: await mapTokenByAddress.get(x)?.symbol() || "?",
            amount: (+formatUnits(
              amountsOut[index],
              await IERC20Metadata__factory.connect(tokensOut[index], signer).decimals()
            )).toString()
          })
        )
      )).sort((x, y) => x.tokenName.localeCompare(y.tokenName));

      return {
        tokenNames: orderedResults.map(x => x.tokenName),
        amounts: orderedResults.map(x => x.amount),
      }
    }

    describe("Good paths", () => {
      describe("Normal case", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "201"},
              {token: usdt, amount: "202"},
              {token: dai, amount: "203"}, // unregistered airdrop
              {token: tetu, amount: "4"}, // dust tokens, we never use them
              {token: bal, amount: "5"}, // dust tokens, we never use them
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "4"},  // dust tokens, we never use them
              {token: bal, amount: "5"},  // dust tokens, we never use them
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [usdc, usdt],
            depositorRewardAmounts: ["201", "202"],
            converterRewardTokens: [tetu, bal],
            converterRewardAmounts: ["111", "222"]
          });
        }

        it("should return list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq(["BAL", "DAI", "TETU", "USDC", "USDT"].join());
        });
        it("should return amounts of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.amounts.join()).eq(["222", "203", "111", "201", "202"].join());
        });
      });
      describe("Converter rewards, pool rewards, pool assets are all different", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "1"},
              {token: usdt, amount: "2"},
              {token: dai, amount: "3"},
              {token: tetu, amount: "0"},
              {token: bal, amount: "0"},
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "0"},
              {token: bal, amount: "0"},
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [bal],
            depositorRewardAmounts: ["11"],
            converterRewardTokens: [tetu],
            converterRewardAmounts: ["7"]
          });
        }

        it("should return list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq(["BAL", "DAI", "TETU", "USDC", "USDT"].join());
        });
        it("should return amounts of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.amounts.join()).eq(["11", "3", "7", "1", "2"].join());
        });
      });
      describe("Converter rewards, pool rewards, pool assets are same", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "201"},
              {token: usdt, amount: "202"},
              {token: dai, amount: "203"},
              {token: tetu, amount: "4"},
              {token: bal, amount: "5"},
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "0"},
              {token: bal, amount: "0"},
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [usdc, usdt, dai, tetu, bal],
            depositorRewardAmounts: ["11", "12", "13", "14", "15"],
            converterRewardTokens: [usdc, usdt, dai, tetu, bal],
            converterRewardAmounts: ["100", "101", "102", "103", "104"]
          });
        }

        it("should return list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq(["BAL", "DAI", "TETU", "USDC", "USDT"].join());
        });
        it("should return amounts of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          // mocked converter sends tokens to the strategy balance
          //
          expect(results.amounts.join()).eq(["119", "305", "117", "301", "303"].join());
        });
      });
    });

    describe("Bad paths", () => {
      describe("Empty arrays", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [],
            depositorRewardAmounts: [],
            converterRewardTokens: [],
            converterRewardAmounts: []
          });
        }

        it("should return empty list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq([].join());
        });
        it("should return empty list of amounts", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          // mocked converter sends tokens to the strategy balance
          expect(results.amounts.join()).eq([].join());
        });
      });
      describe("All amounts zero, dust tokens exist on the balance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "1111111"}, // duct tokens
              {token: bal, amount: "22222222"}, // dust tokens
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "1111111"}, // duct tokens
              {token: bal, amount: "22222222"}, // dust tokens
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [usdc, usdt, dai, tetu, bal],
            depositorRewardAmounts: ["0", "0", "0", "0", "0"],
            converterRewardTokens: [usdc, usdt, dai, tetu, bal],
            converterRewardAmounts: ["0", "0", "0", "0", "0"]
          });
        }

        it("should return empty list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq([].join());
        });
        it("should return empty list of amounts", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          // mocked converter sends tokens to the strategy balance
          // we allow the dust tokens to accumulate on strategy balance forever
          // (it's valid for tokens that don't belong to the list of depositor tokens)
          expect(results.amounts.join()).eq([].join());
        });
      });
    });
  });

  describe('recycle', () => {
    interface IRecycleTestParams {
      compoundRatio: number;

      tokens: MockToken[];
      assetIndex: number;

      liquidations: ILiquidationParams[];
      thresholds: ITokenAmountNum[];
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
        if (! p.isConversionValidDetailed) {
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

      // set up thresholds
      for (const threshold of p.thresholds) {
        await facade.setLiquidationThreshold(
          threshold.token.address,
          parseUnits(threshold.amount, await threshold.token.decimals())
        );
      }

      // make test
      const {amountsToForward, amountToPerformanceAndInsurance} = await facade.callStatic.recycle(
        converter.address,
        p.tokens[p.assetIndex].address,
        p.compoundRatio,
        p.tokens.map(x => x.address),
        liquidator.address,
        p.rewardTokens.map(x => x.address),
        await Promise.all(p.rewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.rewardTokens[index].decimals())
        )),
        p.performanceFee
      );
      console.log(amountsToForward, amountToPerformanceAndInsurance);

      const tx = await facade.recycle(
        converter.address,
        p.tokens[p.assetIndex].address,
        p.compoundRatio,
        p.tokens.map(x => x.address),
        liquidator.address,
        p.rewardTokens.map(x => x.address),
        await Promise.all(p.rewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.rewardTokens[index].decimals())
        )),
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
                thresholds: [],
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
              thresholds: [],
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
              thresholds: [],
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
        describe("DEFAULT_LIQUIDATION_THRESHOLD > Reward amount > liquidationThresholds[reward asset]", () => {
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
        describe("DEFAULT_LIQUIDATION_THRESHOLD > performance > liquidationThresholds[secondary asset]", () => {
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
              thresholds: [],
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

  describe("postWithdrawActions", () => {
    interface IPostWithdrawActionsParams {
      tokens: MockToken[];
      indexAsset: number;
      reservesBeforeWithdraw: string[];
      liquidityAmountWithdrew: string;
      totalSupplyBeforeWithdraw: string;
      amountsToConvert: string[];
      withdrawnAmounts: string[];
      balances: string[];
      quoteRepays: IQuoteRepayParams[];
    }

    interface IPostWithdrawActionsResults {
      expectedMainAssetAmounts: string[];
      amountsToConvert: string[];
    }

    async function postWithdrawActions(p: IPostWithdrawActionsParams): Promise<IPostWithdrawActionsResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up quote repay
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }

      const ret = await facade.callStatic.postWithdrawActions(
        converter.address,
        p.tokens.map(x => x.address),
        p.indexAsset,
        await Promise.all(p.reservesBeforeWithdraw.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
        parseUnits(p.liquidityAmountWithdrew, 18),
        parseUnits(p.totalSupplyBeforeWithdraw, 18),
        await Promise.all(p.amountsToConvert.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
        await Promise.all(p.withdrawnAmounts.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
      );

      return {
        amountsToConvert: await Promise.all(ret._amountsToConvert.map(
          async (x, index) => (+formatUnits(x, await p.tokens[index].decimals())).toString()
        )),
        expectedMainAssetAmounts: await Promise.all(ret.expectedMainAssetAmounts.map(
          async (x, index) => (+formatUnits(x, await p.tokens[p.indexAsset].decimals())).toString()
        )),
      }
    }

    describe("Typical case", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function postWithdrawActionsTest(): Promise<IPostWithdrawActionsResults> {
        return postWithdrawActions({
          tokens: [usdt, dai, usdc, weth, tetu],
          indexAsset: 2,
          balances: ["1000", "2000", "3000", "4000", "5000"], // actual values don't matter here, they are not used
          totalSupplyBeforeWithdraw: "50000",
          liquidityAmountWithdrew: "25000", // 1/2
          reservesBeforeWithdraw: ["100", "200", "300", "400", "500"],
          amountsToConvert: ["1", "2", "3", "4", "5"],
          withdrawnAmounts: ["10", "20", "30", "40", "50"],
          quoteRepays: [
            {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "51", collateralAmountOut: "1"},
            {collateralAsset: usdc, borrowAsset: dai, amountRepay: "102", collateralAmountOut: "2"},
            {collateralAsset: usdc, borrowAsset: weth, amountRepay: "204", collateralAmountOut: "4"},
            {collateralAsset: usdc, borrowAsset: tetu, amountRepay: "255", collateralAmountOut: "5"}
          ]
        });
      }

      it("should return amountsToConvert = amountsToConvert + withdrawnAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.amountsToConvert.join()).eq(["11", "22", "33", "44", "55"].join());
      });
      it("should return expected value of expectedMainAssetAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.expectedMainAssetAmounts.join()).eq([1, 2, 150, 4, 5].join());
      });
    });
  });

  describe("postWithdrawActionsEmpty", () => {
    interface IPostWithdrawActionsEmptyParams {
      tokens: MockToken[];
      indexAsset: number;
      amountsToConvert: string[];
      balances: string[]; // collateral, borrow
      quoteRepays: IQuoteRepayParams[];
    }

    interface IPostWithdrawActionsEmptyResults {
      expectedMainAssetAmounts: string[];
    }

    async function postWithdrawActionsEmpty(p: IPostWithdrawActionsEmptyParams): Promise<IPostWithdrawActionsEmptyResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up quote repay
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }

      const ret = await facade.callStatic.postWithdrawActionsEmpty(
        converter.address,
        p.tokens.map(x => x.address),
        p.indexAsset,
        await Promise.all(p.amountsToConvert.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
      );

      return {
        expectedMainAssetAmounts: await Promise.all(ret.map(
          async (x, index) => (+formatUnits(x, await p.tokens[p.indexAsset].decimals())).toString()
        )),
      }
    }

    describe("Typical case", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function postWithdrawActionsTest(): Promise<IPostWithdrawActionsEmptyResults> {
        return postWithdrawActionsEmpty({
          tokens: [usdt, dai, usdc, weth, tetu],
          indexAsset: 2,
          balances: ["1000", "2000", "3000", "4000", "5000"], // actual values don't matter here, they are not used
          amountsToConvert: ["1", "2", "3", "4", "5"],
          quoteRepays: [
            {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "1", collateralAmountOut: "1"},
            {collateralAsset: usdc, borrowAsset: dai, amountRepay: "2", collateralAmountOut: "2"},
            {collateralAsset: usdc, borrowAsset: weth, amountRepay: "4", collateralAmountOut: "4"},
            {collateralAsset: usdc, borrowAsset: tetu, amountRepay: "5", collateralAmountOut: "5"}
          ]
        });
      }

      it("should return expected value of expectedMainAssetAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.expectedMainAssetAmounts.join()).eq([1, 2, 0, 4, 5].join());
      });
    });
    describe("Zero amounts", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function postWithdrawActionsTest(): Promise<IPostWithdrawActionsEmptyResults> {
        return postWithdrawActionsEmpty({
          tokens: [usdt, dai, usdc, weth, tetu],
          indexAsset: 2,
          balances: ["1000", "2000", "3000", "4000", "5000"], // actual values don't matter here, they are not used
          amountsToConvert: ["0", "0", "0", "0", "0"],
          quoteRepays: []
        });
      }

      it("should return expected value of expectedMainAssetAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.expectedMainAssetAmounts.join()).eq([0, 0, 0, 0, 0].join());
      });
    });
  });

  describe('getLiquidityAmount', () => {
    const DECIMALS_LIQUIDITY = 18;

    interface IGetLiquidityAmountParams {
      tokens: MockToken[];
      indexAsset: number;
      targetAmount: string;
      investedAssets: string;
      depositorLiquidity: string;

      balances: string[];
      quoteRepays: IQuoteRepayParams[];
    }

    interface IGetLiquidityAmountResults {
      resultAmount: number;
      amountsToConvertOut: string[];
    }

    async function getLiquidityAmount(p: IGetLiquidityAmountParams): Promise<IGetLiquidityAmountResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up quote repay
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }
      const ret = await facade.callStatic.getLiquidityAmount(
        parseUnits(p.targetAmount, await p.tokens[p.indexAsset].decimals()),
        ethers.Wallet.createRandom().address,
        p.tokens.map(x => x.address),
        p.indexAsset,
        converter.address,
        parseUnits(p.investedAssets, await p.tokens[p.indexAsset].decimals()),
        parseUnits(p.depositorLiquidity, DECIMALS_LIQUIDITY),
      );

      return {
        amountsToConvertOut: await Promise.all(ret.amountsToConvertOut.map(
          async (x, index) => (+formatUnits(x, await p.tokens[index].decimals())).toString()
        )),
        resultAmount: +formatUnits(ret.resultAmount, DECIMALS_LIQUIDITY)
      }
    }

    describe('Good paths', () => {
      describe('partial', () => {
        describe('zero balances', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              targetAmount: "5",
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["0", "0", "0"],
              quoteRepays: []
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7 * 101 / 100 * 5 / 500);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([0, 0, 0].join());
          });
        });
        describe('amount of first asset is enough to get the required amount', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              targetAmount: "5",
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "27", collateralAmountOut: "14"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(0);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 0].join());
          });
        });
        describe('amount of two assets is enough to get the required amount', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              targetAmount: "9",
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "37", collateralAmountOut: "14"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(0);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
          });
        });
        describe('amount of two assets is NOT enough to get the required amount', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              targetAmount: "19",
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"}, // 2 + 7 < 19
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "37", collateralAmountOut: "2"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7 * 101 / 100 * (19 - 9) / (500 - 9));
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
          });
        });
      });
      describe('all', () => {
        describe('zero balances', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              targetAmount: "0", // all
              investedAssets: "500",
              depositorLiquidity: "7777",
              balances: ["0", "0", "0"],
              quoteRepays: []
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7777);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([0, 0, 0].join());
          });
        });
        describe('balances are not zero', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              targetAmount: "0",
              investedAssets: "500",
              depositorLiquidity: "7777",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "27", collateralAmountOut: "14"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7777);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe('targetAmount > investedAmount, investedAmount == sum(collaterals)', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
          return getLiquidityAmount({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            targetAmount: "500",
            investedAssets: "21",
            depositorLiquidity: "777",
            balances: ["17", "27", "37"],
            quoteRepays: [
              {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
              {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "37", collateralAmountOut: "14"},
            ]
          })
        }

        it('should return expected resultAmount', async () => {
          const results = await loadFixture(getLiquidityAmountTest);
          expect(results.resultAmount).eq(777);
        });
        it('should return zero amounts to convert', async () => {
          const results = await loadFixture(getLiquidityAmountTest);
          expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
        });
      });
    })
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

//endregion Unit tests
});