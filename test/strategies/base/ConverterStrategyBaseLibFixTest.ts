import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../scripts/utils/DeployerUtils';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { ConverterStrategyBaseLibFacade, MockToken, PriceOracleMock } from '../../../typechain';
import { expect } from 'chai';
import { MockHelper } from '../../baseUT/helpers/MockHelper';
import {Misc} from "../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {ILiquidationParams, IQuoteRepayParams, IRepayParams} from "../../baseUT/mocks/TestDataTypes";
import {setupIsConversionValid, setupMockedLiquidation} from "../../baseUT/mocks/MockLiquidationUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_CLOSE_POSITION_USING_MAIN_ASSET,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW
} from "../../baseUT/GasLimits";

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
  let facade: ConverterStrategyBaseLibFacade;
  //endregion Variables

  //region before, after
  before(async function() {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseLibFacade(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 18);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
    console.log("usdc", usdc.address);
    console.log("dai", dai.address);
    console.log("tetu", tetu.address);
    console.log("weth", weth.address);
    console.log("usdt", usdt.address);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
  //endregion before, after

  //region Unit tests
  describe("openPositionEntryKind1", () => {
    let snapshot: string;
    before(async function() { snapshot = await TimeUtils.snapshot(); });
    after(async function() { await TimeUtils.rollback(snapshot); });

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
      liquidationThreshold: string;
      amountsToConvert: string[];
      balances: string[];
      prices: string[];
      liquidations: ILiquidationParams[];
      repays: IRepayParams[];
      isConversionValid?: boolean;
    }
    async function makeConvertAfterWithdraw(p: IConvertAfterWithdrawParams) : Promise<IConvertAfterWithdrawResults> {
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

      // make test
      const ret = await facade.callStatic.convertAfterWithdraw(
        converter.address,
        liquidator.address,
        p.indexAsset,
        parseUnits(p.liquidationThreshold, await p.tokens[p.indexAsset].decimals()),
        p.tokens.map(x => x.address),
        p.amountsToConvert.map(
          (x, index) => parseUnits(x, decimals[index])
        )
      );

      const tx = await facade.convertAfterWithdraw(
        converter.address,
        liquidator.address,
        p.indexAsset,
        parseUnits(p.liquidationThreshold, await p.tokens[p.indexAsset].decimals()),
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
        before(async function () {snapshot = await TimeUtils.snapshot();});
        after(async function () {await TimeUtils.rollback(snapshot);});

        async function  makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
          return makeConvertAfterWithdraw({
            tokens: [dai, usdc, usdt],
            indexAsset: 1, // usdc
            amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
            balances: ["200", "91", "900"], // dai, usdc, usdt
            liquidationThreshold: "0",
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

        it('should return expected collateralOut', async() => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.collateralOut).eq(1404); // 401 + 1003
        });
        it('should return expected repaidAmountsOut', async() => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.repaidAmountsOut.join()).eq(["200", "0", "500"].join());
        });
        it('should set expected balances', async() => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          expect(r.balances.join()).eq(["0", "1495", "400"].join()); // 200-200, 91 + 401 + 1003, 900 - 500
        });
        it('should not exceed gas limits @skip-on-coverage', async() => {
          const r = await loadFixture(makeConvertAfterWithdrawFixture);
          controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
      describe('Repay + liquidation of leftovers (amountsToConvert > repaidAmountsOut)', () => {
        describe("Leftovers > liquidation threshold", () => {
          let snapshot: string;
          before(async function () { snapshot = await TimeUtils.snapshot();});
          after(async function () { await TimeUtils.rollback(snapshot); });

          async function makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
            return makeConvertAfterWithdraw({
              tokens: [dai, usdc, usdt],
              indexAsset: 1, // usdc
              amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
              balances: ["200", "91", "900"], // dai, usdc, usdt
              liquidationThreshold: "0",
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
          before(async function () { snapshot = await TimeUtils.snapshot();});
          after(async function () { await TimeUtils.rollback(snapshot); });

          async function makeConvertAfterWithdrawFixture(): Promise<IConvertAfterWithdrawResults> {
            return makeConvertAfterWithdraw({
              tokens: [dai, usdc, usdt],
              indexAsset: 1, // usdc
              amountsToConvert: ["200", "91", "500"], // dai, usdc, usdt
              balances: ["200", "91", "900"], // dai, usdc, usdt
              liquidationThreshold: "400", // (!) this threshold is greater than collateralAmountOut
              repays: [
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "150",
                  collateralAmountOut: "200",       // (!) less than liquidationThreshold
                  totalDebtAmountOut: "150",
                  totalCollateralAmountOut: "200"
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  amountRepay: "270",
                  collateralAmountOut: "370",       // (!) less than liquidationThreshold
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
            liquidationThreshold: "0",
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
            liquidationThreshold: "0",
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

  describe("_closePositionUsingMainAsset", () => {
    interface IClosePositionUsingMainAssetResults {
      expectedAmountOut: number;
      gasUsed: BigNumber;
      balanceAsset: number;
      balanceToken: number;
    }
    interface IClosePositionUsingMainAssetParams {
      assetToken: MockToken[];
      liquidationThreshold: string;
      balances: string[];
      toSell: string;
      prices: string[];
      liquidations: ILiquidationParams[];
      quoteRepays: IQuoteRepayParams[];
      repays: IRepayParams[];
      isConversionValid?: boolean;
    }
    async function makeClosePositionUsingMainAssetTest(
      p: IClosePositionUsingMainAssetParams
    ) : Promise<IClosePositionUsingMainAssetResults> {
      // set up balances
      const decimals: number[] = [];
      for (let i = 0; i < p.assetToken.length; ++i) {
        const d = await p.assetToken[i].decimals()
        decimals.push(d);

        // set up current balances
        await p.assetToken[i].mint(facade.address, parseUnits(p.balances[i], d));
        console.log("mint", i, p.balances[i]);
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);
      const priceOracle = (await DeployerUtils.deployContract(
        signer,
        'PriceOracleMock',
        p.assetToken.map(x => x.address),
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

      // make test
      const ret = await facade.callStatic._closePositionUsingMainAsset(
        converter.address,
        liquidator.address,
        p.assetToken[0].address,
        p.assetToken[1].address,
        parseUnits(p.toSell, decimals[0]),
        parseUnits(p.liquidationThreshold, decimals[0]),
      );

      const tx = await facade._closePositionUsingMainAsset(
        converter.address,
        liquidator.address,
        p.assetToken[0].address,
        p.assetToken[1].address,
        parseUnits(p.toSell, decimals[0]),
        parseUnits(p.liquidationThreshold, decimals[0]),
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedAmountOut: +formatUnits(ret, decimals[0]),
        gasUsed,
        balanceAsset: +formatUnits(await p.assetToken[0].balanceOf(facade.address), decimals[0]),
        balanceToken: +formatUnits(await p.assetToken[1].balanceOf(facade.address), decimals[1]),
      }
    }

    describe("Good paths", () => {
      describe("No debt-gap", () => {
        describe("Amount to repay is higher than liquidation threshold", () => {
          describe("Expected collateral is higher than amount to sell (normal case)", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeClosePositionUsingMainAssetFixture(): Promise<IClosePositionUsingMainAssetResults> {
              return makeClosePositionUsingMainAssetTest({
                assetToken: [usdc, dai],
                balances: ["200", "91"], // usdc, dai
                liquidationThreshold: "400", // it's lower than collateralAmountOut=401
                toSell: "107",
                liquidations: [{amountIn: "107", amountOut: "305", tokenIn: usdc, tokenOut: dai}],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "305",
                  collateralAmountOut: "401"
                }],
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "305",
                  collateralAmountOut: "401",
                  totalDebtAmountOut: "610",
                  totalCollateralAmountOut: "802"
                }],
                prices: ["1", "1"] // for simplicity
              });
            }

            it("should return expected value of expectedAmountOut", async () => {
              const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
              expect(r.expectedAmountOut).eq(294); // -107 + 401
            });
            it("should set expected balances", async () => {
              const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
              expect(r.balanceAsset).eq(494); // 200 - 107 + 401
              expect(r.balanceToken).eq(91); // 91 + 305 - 305
            });
            it('should not exceed gas limits @skip-on-coverage', async () => {
              const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
              controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CLOSE_POSITION_USING_MAIN_ASSET, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("Expected collateral is lower than amount to sell (weird case)", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeClosePositionUsingMainAssetFixture(): Promise<IClosePositionUsingMainAssetResults> {
              return makeClosePositionUsingMainAssetTest({
                assetToken: [usdc, dai],
                balances: ["200", "91"], // usdc, dai
                liquidationThreshold: "0",
                toSell: "107",
                liquidations: [{amountIn: "107", amountOut: "305", tokenIn: usdc, tokenOut: dai}],
                quoteRepays: [{
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "305",
                  collateralAmountOut: "106" // (!) weird, we paid 107 but get 106...
                }],
                repays: [{
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  amountRepay: "305",
                  collateralAmountOut: "106",
                  totalDebtAmountOut: "610",
                  totalCollateralAmountOut: "802"
                }],
                prices: ["1", "1"] // for simplicity
              });
            }

            it("should return zero expectedAmountOut", async () => {
              const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
              expect(r.expectedAmountOut).eq(0);
            });
            it("should not change balances", async () => {
              const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
              expect(r.balanceAsset).eq(200); // unchanged
              expect(r.balanceToken).eq(91); // unchanged
            });
          });
        });
        describe("Amount to repay is lower than liquidation threshold", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeClosePositionUsingMainAssetFixture(): Promise<IClosePositionUsingMainAssetResults> {
            return makeClosePositionUsingMainAssetTest({
              assetToken: [usdc, dai],
              balances: ["200", "91"], // usdc, dai
              liquidationThreshold: "402", // (!) it's higher than collateralAmountOut==401
              toSell: "107",
              liquidations: [{amountIn: "107", amountOut: "305", tokenIn: usdc, tokenOut: dai}],
              quoteRepays: [{collateralAsset: usdc, borrowAsset: dai, amountRepay: "305", collateralAmountOut: "401"}],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "305",
                collateralAmountOut: "401",
                totalDebtAmountOut: "610",
                totalCollateralAmountOut: "802"
              }],
              prices: ["1", "1"] // for simplicity
            });
          }

          it("should return zero expectedAmountOut", async () => {
            const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
            expect(r.expectedAmountOut).eq(0);
          });
          it("should not change balances", async () => {
            const r = await loadFixture(makeClosePositionUsingMainAssetFixture);
            expect(r.balanceAsset).eq(200); // unchanged
            expect(r.balanceToken).eq(91); // unchanged
          });
        });
      });
      describe("There is debt-gap", () => {
        // todo
      });
    });
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {snapshot = await TimeUtils.snapshot();});
      afterEach(async function () {await TimeUtils.rollback(snapshot);});

      it("should revert if no liquidation rote", async () => {
        await expect(makeClosePositionUsingMainAssetTest({
          assetToken: [usdc, dai],
          balances: ["200", "91"], // usdc, dai
          liquidationThreshold: "400", // it's lower than collateralAmountOut=401
          toSell: "107",
          liquidations: [], // (!) no liquidation
          quoteRepays: [{collateralAsset: usdc, borrowAsset: dai, amountRepay: "305", collateralAmountOut: "401"}],
          repays: [{
            collateralAsset: usdc,
            borrowAsset: dai,
            amountRepay: "305",
            collateralAmountOut: "401",
            totalDebtAmountOut: "610",
            totalCollateralAmountOut: "802"
          }],
          prices: ["1", "1"] // for simplicity
        })).revertedWith("TS-15 No liquidation route"); // NO_LIQUIDATION_ROUTE
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
    }
    async function makeLiquidationTest(p: ILiquidationTestParams) : Promise<ILiquidationTestResults> {
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
      await setupMockedLiquidation(liquidator, p.liquidation);
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
        parseUnits(p.liquidationThreshold, await p.liquidation.tokenOut.decimals()),
      );

      const tx = await facade.liquidate(
        converter.address,
        liquidator.address,
        p.liquidation.tokenIn.address,
        p.liquidation.tokenOut.address,
        parseUnits(p.liquidation.amountIn, await p.liquidation.tokenIn.decimals()),
        p.slippage || 10_000,
        parseUnits(p.liquidationThreshold, await p.liquidation.tokenOut.decimals()),
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
      describe("Amount out > liquidation threshold", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeLiquidationFixture() : Promise<ILiquidationTestResults> {
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
            liquidationThreshold: "799",
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
      describe("Amount out < liquidation threshold", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeLiquidationFixture() : Promise<ILiquidationTestResults> {
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
            liquidationThreshold: "801", // (!)
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
    });
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {snapshot = await TimeUtils.snapshot();});
      afterEach(async function () {await TimeUtils.rollback(snapshot);});

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
          liquidationThreshold: "799",
          isConversionValid: false // (!) price impact is too high
        })).revertedWith("TS-16 price impact"); // PRICE_IMPACT
      });
    });
  });
//endregion Unit tests
});
