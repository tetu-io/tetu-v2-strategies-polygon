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
import {
  IBorrowParamsNum,
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams,
  ITokenAmountNum
} from "../../baseUT/mocks/TestDataTypes";
import {setupIsConversionValid, setupMockedLiquidation} from "../../baseUT/mocks/MockLiquidationUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedBorrow, setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW
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
  before(async function() {
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
    ) : Promise<IClosePositionToGetRequestedAmountResults> {
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
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
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
      describe("Partial repayment, balance > toSell", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

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
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

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
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "0"],
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
        it("should return expected amount", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedAmountMainAssetOut).eq(1000); // 3000 - 2000
        });
        it("should set expected balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([6000, 0].join());
        });
      });
      describe("QuoteRepay != repay", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "0"],
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
          expect(r.expectedAmountMainAssetOut).eq(800); // 2800 - 2000
        });
        it("should set expected balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([6000, 0].join());
        });
      });
      describe("Not zero liquidation threshold", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "1999"], // (!) less than amoutOut in liquidation
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
          expect(r.expectedAmountMainAssetOut).eq(800); // 2800 - 2000
        });
        it("should set expected balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([6000, 0].join());
        });
      });
      describe("requestedAmount is max uint", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "", // MAX_UINT, usdc
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "0"],
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
        it("should return expected amount", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.expectedAmountMainAssetOut).eq(1000); // 3000 - 2000
        });
        it("should set expected balances", async () => {
          const r = await loadFixture(makeClosePositionToGetRequestedAmountFixture);
          expect(r.balances.join()).eq([6000, 0].join());
        });
      });
    });
    describe("Bad paths", () => {
      describe("Zero balance", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

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
      describe("There are no debts", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

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
      describe("Liquidation threshold is too high", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot();});
        after(async function () { await TimeUtils.rollback(snapshot); });

        async function makeClosePositionToGetRequestedAmountFixture(): Promise<IClosePositionToGetRequestedAmountResults> {
          return makeClosePositionToGetRequestedAmountTest({
            requestedAmount: "1000000", // usdc - we need as much as possible USDC
            tokens: [usdc, dai],
            indexAsset: 0,
            balances: ["5000", "0"], // usdc, dai - we have enough USDC on balance to completely pay the debt
            prices: ["1", "1"], // for simplicity
            liquidationThresholds: ["0", "2001"], // (!) the threshold for dai is higher than amountOut
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
          expect(r.balances.join()).eq([5000, 0].join());
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
    async function makeGetAmountToSellTest(p: IGetAmountToSellParams) : Promise<IGetAmountToSellResults> {
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
              expect(r.amountOut).eq(500); // 600 * 101/100 = 606 > max allowed 500 usdc, so 500
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
              expect(r.amountOut).eq(10100);
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
              expect(r.amountOut).eq(40000); // == $800 == totalDebt
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
              expect(r.amountOut).eq(40500); // == $810 == totalDebt - balanceBorrowAsset
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
      liquidationThresholdForTargetAsset: string;
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
    async function makeSwapToGivenAmountTest(p: ISwapToGivenAmountParams) : Promise<ISwapToGivenAmountResults> {
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

      const r = await facade.callStatic.swapToGivenAmountAccess(
        parseUnits(p.targetAmount, decimals[p.indexTargetAsset]),
        p.tokens.map(x => x.address),
        p.indexTargetAsset,
        p.underlying.address,
        converter.address,
        liquidator.address,
        parseUnits(p.liquidationThresholdForTargetAsset, decimals[p.indexTargetAsset]),
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
        parseUnits(p.liquidationThresholdForTargetAsset, decimals[p.indexTargetAsset]),
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

      async function makeSwapToGivenAmountFixture() : Promise<ISwapToGivenAmountResults> {
        return makeSwapToGivenAmountTest({
          targetAmount: "10",
          tokens: [tetu, usdc, usdt, dai],
          indexTargetAsset: 0, // TETU
          underlying: usdc,
          liquidationThresholdForTargetAsset: "0",
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
      async function makeSwapToGivenAmountFixture() : Promise<ISwapToGivenAmountResults> {
        return makeSwapToGivenAmountTest({
          targetAmount: "16010",
          tokens: [tetu, usdc, usdt, dai],
          indexTargetAsset: 0, // TETU
          underlying: usdc,
          liquidationThresholdForTargetAsset: "0",
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
      const r = await facade.registerIncome(1, 2, 30, 40);
      expect(r._earned.toNumber()).eq(31);
      expect(r._lost.toNumber()).eq(40);
    });
    it("should return expected values if after < before", async () => {
      const r = await facade.registerIncome(2, 1, 30, 40);
      expect(r._earned.toNumber()).eq(30);
      expect(r._lost.toNumber()).eq(41);
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
      const controller = await  MockHelper.createMockController(signer);
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

      const orderedResults: {tokenName: string, amount: string}[] = (await Promise.all(
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
    }

    interface IRecycleTestResults {
      gasUsed: BigNumber;

      amountsToForward: string[];
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
        await setupIsConversionValid(
          converter,
          liquidation,
          p.isConversionValid === undefined
            ? true
            : p.isConversionValid
        )
      }

      // set up thresholds
      for (const threshold of p.thresholds) {
        await facade.setLiquidationThreshold(
          threshold.token.address,
          parseUnits(threshold.amount, await threshold.token.decimals())
        );
      }

      // make test
      const amountsToForward = await facade.callStatic.recycle(
        converter.address,
        p.tokens[p.assetIndex].address,
        p.compoundRatio,
        p.tokens.map(x => x.address),
        liquidator.address,
        p.rewardTokens.map(x => x.address),
        await Promise.all(p.rewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.rewardTokens[index].decimals())
        ))
      );
      console.log(amountsToForward);

      const tx = await facade.recycle(
        converter.address,
        p.tokens[p.assetIndex].address,
        p.compoundRatio,
        p.tokens.map(x => x.address),
        liquidator.address,
        p.rewardTokens.map(x => x.address),
        await Promise.all(p.rewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.rewardTokens[index].decimals())
        ))
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        gasUsed,
        amountsToForward: await Promise.all(amountsToForward.map(
          async (amount, index) => (+formatUnits(amount, await p.rewardTokens[index].decimals())).toString()
        )),
        tokenBalances: await Promise.all(p.tokens.map(
          async t => (+formatUnits(await t.balanceOf(facade.address), await t.decimals())).toString()
        )),
        rewardTokenBalances: await Promise.all(p.rewardTokens.map(
          async t => (+formatUnits(await t.balanceOf(facade.address), await t.decimals())).toString()
        )),
      }
    }

    describe('Good paths', () => {
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
              liquidations: []
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
              liquidations: []
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
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "90", amountOut: "97"}]
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
              ]
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
              liquidations: []
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
              ]
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
    describe('Bad paths', () => {
      describe("liquidationThresholds[main asset] is set", () => {
        describe("Reward amount > liquidationThresholds[main asset]", () => {
          let snapshot: string;
          before(async function () {snapshot = await TimeUtils.snapshot();});
          after(async function () {await TimeUtils.rollback(snapshot);});

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: usdc, amount: "0.11"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 0.15 > 0.11
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}]
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
        describe("liquidationThresholds[main asset] > Reward amount > DEFAULT_LIQUIDATION_THRESHOLD==100_000", () => {
          let snapshot: string;
          before(async function () {snapshot = await TimeUtils.snapshot();});
          after(async function () {await TimeUtils.rollback(snapshot);});

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: usdc, amount: "0.2"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 200_000 > 0.15e6 > 100_000
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}]
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
        describe("DEFAULT_LIQUIDATION_THRESHOLD > Reward amount > liquidationThresholds[main asset]", () => {
          let snapshot: string;
          before(async function () {snapshot = await TimeUtils.snapshot();});
          after(async function () {await TimeUtils.rollback(snapshot);});

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: usdc, amount: "0.05"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 0.1 > 0.09 > 0.05
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.09"}]
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
      });
      describe("liquidationThresholds[reward token] is set", () => {
        describe("amountToCompound > liquidationThresholds[reward token]", () => {
          let snapshot: string;
          before(async function () {snapshot = await TimeUtils.snapshot();});
          after(async function () {await TimeUtils.rollback(snapshot);});

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 1,
              tokens: [usdt, usdc, dai],
              rewardTokens: [tetu],
              rewardAmounts: ["6"],
              thresholds: [{token: tetu, amount: "0.7"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
                {token: tetu, amount: "6"}
              ],
              compoundRatio: 30_000,

              // 6*0.3 > 0.7 > 0.0000000000001
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}]
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
          before(async function () {snapshot = await TimeUtils.snapshot();});
          after(async function () {await TimeUtils.rollback(snapshot);});

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
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "1.8", amountOut: "0.15"}]
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
        describe("DEFAULT_LIQUIDATION_THRESHOLD > amountToCompound > liquidationThresholds[main asset]", () => {
          let snapshot: string;
          before(async function () {snapshot = await TimeUtils.snapshot();});
          after(async function () {await TimeUtils.rollback(snapshot);});

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              assetIndex: 0,
              tokens: [usdc, dai],
              rewardTokens: [usdt],
              rewardAmounts: ["0.04"],
              thresholds: [{token: usdc, amount: "0.01"}],
              initialBalances: [
                {token: usdt, amount: "1"},
                {token: usdc, amount: "2"},
                {token: dai, amount: "3"},
              ],
              compoundRatio: 40_000,

              // 0.1 > 0.04*0.4 > 0.01
              liquidations: [{tokenIn: tetu, tokenOut: usdc, amountIn: "0.02", amountOut: "0.09"}]
            });
          }

          it("should return expected amounts for the forwarder", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).eq(["0.024"].join());
          });
          it("should not change balances of secondary depositor assets", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.tokenBalances.join()).eq(["2", "3"].join());
          });
          it("should set expected balances of rewards tokens", async () => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.rewardTokenBalances.join()).eq(["1"].join());
          });
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
              {collateralAsset: usdc, borrowAsset: usdt, collateralAmount: "100", maxTargetAmount: "101", converter: ethers.Wallet.createRandom().address},
              {collateralAsset: usdc, borrowAsset: tetu, collateralAmount: "200", maxTargetAmount: "201", converter: ethers.Wallet.createRandom().address},
              {collateralAsset: usdc, borrowAsset: dai, collateralAmount: "300", maxTargetAmount: "301", converter: ethers.Wallet.createRandom().address},
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

        it("should revert", async () => {
          await expect(
            makeGetTokenAmounts({
              tokens: [usdt, tetu, dai, usdc],
              assetIndex: 3,
              threshold: "0",
              initialBalances: ["0", "0", "0", "1000"],
              collaterals: ["100", "200", "300", "400"],
              borrows: [
                {collateralAsset: usdc, borrowAsset: usdt, collateralAmount: "100", maxTargetAmount: "101", converter: ethers.Wallet.createRandom().address},
                {collateralAsset: usdc, borrowAsset: tetu, collateralAmount: "200", maxTargetAmount: "0", converter: Misc.ZERO_ADDRESS},
                {collateralAsset: usdc, borrowAsset: dai, collateralAmount: "300", maxTargetAmount: "0", converter: Misc.ZERO_ADDRESS},
              ]
            })
          ).revertedWith("TS-10 zero borrowed amount"); // ZERO_AMOUNT_BORROWED
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
              {collateralAsset: usdc, borrowAsset: usdt, collateralAmount: "100", maxTargetAmount: "101", converter: ethers.Wallet.createRandom().address},
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
              {collateralAsset: usdc, borrowAsset: usdt, collateralAmount: "100", maxTargetAmount: "101", converter: ethers.Wallet.createRandom().address},
              {collateralAsset: usdc, borrowAsset: tetu, collateralAmount: "200", maxTargetAmount: "201", converter: ethers.Wallet.createRandom().address},
              {collateralAsset: usdc, borrowAsset: dai, collateralAmount: "300", maxTargetAmount: "301", converter: ethers.Wallet.createRandom().address},
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
      beforeEach(async function () {snapshot = await TimeUtils.snapshot();});
      afterEach(async function () {await TimeUtils.rollback(snapshot);});

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
    describe("Good paths", () => {
      describe("Full repayment, no debt gap", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });
// todo
      });
      describe("Full repayment with debt gap", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

// todo
      });
      describe("Partial repayment", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

// todo
      });
    });
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {snapshot = await TimeUtils.snapshot();});
      afterEach(async function () {await TimeUtils.rollback(snapshot);});

      describe("Try to pay too much", () => {
// todo
      });
    });
  });

  describe("postWithdrawActions", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
// todo
      });
    });
    describe("Bad paths", () => {

    });
  });

  describe("postWithdrawActionsEmpty", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
// todo
      });
    });
    describe("Bad paths", () => {

    });
  });

  describe("swapToGivenAmountAndSendToConverter", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
// todo
      });
    });
    describe("Bad paths", () => {

    });
  });

  describe("_getCollateralToBorrowRatio", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
// todo
      });
    });
    describe("Bad paths", () => {

    });
  });
//endregion Unit tests
});