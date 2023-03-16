import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {
  ConverterStrategyBaseLibFacade, MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock
} from "../../../typechain";
import {expect} from "chai";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CALC_INVESTED_ASSETS_NO_DEBTS,
  GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT,
  GAS_OPEN_POSITION, GAS_PERFORMANCE_FEE,
  GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS,
  GET_GET_COLLATERALS,
  GET_LIQUIDITY_AMOUNT_RATIO
} from "../../baseUT/GasLimits";
import {Misc} from "../../../scripts/utils/Misc";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {BigNumber, BigNumberish} from "ethers";
import {areAlmostEqual} from "../../baseUT/utils/MathUtils";
import {ILiquidationParams} from "../../baseUT/utils/TestDataTypes";
import {setupMockedLiquidation} from "./utils/MockLiquidationUtils";

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 */
describe("ConverterStrategyBaseLibTest", () => {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let facade: ConverterStrategyBaseLibFacade;
//endregion Variables

//region before, after
  before(async function () {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseFacade(signer);
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

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("getExpectedWithdrawnAmounts", () => {
    describe("Good paths", () => {
      describe("Two assets", () => {
        describe("The asset is first in _depositorPoolAssets, USDC, DAI", async () => {
          it("should return expected values, USDC is main", async () => {
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits("200000", 6), // usdc
                parseUnits("100000", 18), // dai
              ],
              parseUnits("1000", 33), // decimals of the values don't matter here
              parseUnits("50000", 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n");
            const sexpected = [
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            ].join("\n");

            expect(sret).eq(sexpected);
          });
          it("should return expected values, DAI is main", async () => {
            // DAI, USDC
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits("100000", 18), // dai
                parseUnits("200000", 6), // usdc
              ],
              parseUnits("1000", 33), // decimals of the values don't matter here
              parseUnits("50000", 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
            const sexpected = [
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            ].join("\n");

            expect(sret).eq(sexpected);
          });
        });
        describe("The asset is second in _depositorPoolAssets", async () => {
          it("should return expected values for USDC", async () => {
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits("100000", 18), // dai
                parseUnits("200000", 6), // usdc
              ],
              parseUnits("1000", 33), // decimals of the values don't matter here
              parseUnits("50000", 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
            const sexpected = [
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            ].join("\n");

            expect(sret).eq(sexpected);
          });
          it("should return expected values for DAI", async () => {
            const priceOracle = (await DeployerUtils.deployContract(
              signer,
              'PriceOracleMock',
              [usdc.address, dai.address],
              [parseUnits("4", 18), parseUnits("2", 18)]
            )) as PriceOracleMock;

            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits("200000", 6), // usdc
                parseUnits("100000", 18), // dai
              ],
              parseUnits("1000", 33), // decimals of the values don't matter here
              parseUnits("50000", 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
            const sexpected = [
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            ].join("\n");

            expect(sret).eq(sexpected);
          });
        });
      });
      describe("Three assets", () => {
        it("should return expected values", async () => {
          const ret = await facade.getExpectedWithdrawnAmounts(
            [
              parseUnits("200000", 6), // usdc
              parseUnits("100000", 18), // dai
              parseUnits("800000", 18), // weth
            ],
            parseUnits("1000", 33), // decimals of the values don't matter here
            parseUnits("50000", 33), // only values ratio is important
          );

          const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
          const sexpected = [
            parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            parseUnits((800_000 * 1000 / 50_000).toString(), 18),
          ].join("\n");

          expect(sret).eq(sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      it("should return zero values if total supply is zero", async () => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits("200000", 6), // usdc
            parseUnits("100000", 18), // dai
          ],
          parseUnits("1000", 33), // decimals of the values don't matter here
          parseUnits("0", 33), // (!) total supply is zero
        );
        const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
        const sexpected = [
          parseUnits("0", 6),
          parseUnits("0", 18),
        ].join("\n");

        expect(sret).eq(sexpected);
      });

      it("should use ratio 1 if liquidityAmount > totalSupply", async () => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
          ],
          parseUnits("5000", 33), // (!) liquidity is greater than total supply
          parseUnits("1000", 33), // (!) total supply
        );

        const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
        const sexpected = [
          parseUnits((200_000).toString(), 6), // ratio == 1
          parseUnits((100_000).toString(), 18), // ratio == 1
        ].join("\n");

        expect(sret).eq(sexpected);
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits @skip-on-coverage", async () => {
        const gasUsed = await facade.estimateGas.getExpectedWithdrawnAmounts(
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
            parseUnits("800000", 18),
          ],
          parseUnits("1000", 33), // decimals of the values don't matter here
          parseUnits("50000", 33), // only values ratio is important
        );
        controlGasLimitsEx(gasUsed, GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("getLiquidityAmountRatio", () => {
    async function getTetuConverter(
      tokens: MockToken[],
      indexAsset: number,
      amountsToRepay: BigNumber[],
      amountsCollateralOut: BigNumber[]
    ): Promise<string> {
      const tc = await MockHelper.createMockTetuConverter(signer);
      for (let i = 0; i < tokens.length; ++i) {
        if (indexAsset === i) continue;
        await tc.setQuoteRepay(
          ethers.Wallet.createRandom().address,
          tokens[indexAsset].address,
          tokens[i].address,
          amountsToRepay[i],
          amountsCollateralOut[i]
        );
      }
      return tc.address;
    }

    describe("Good paths", () => {
      describe("partial", () => {
        describe("zero base amounts", () => {
          it("should return expected liquidityRatioOut and zero amounts to convert", async () => {
            const r = await facade.callStatic.getLiquidityAmountRatio(
              parseUnits("5", 6),
              ethers.Wallet.createRandom().address,
              [dai.address, usdc.address, usdt.address],
              1,
              getTetuConverter([],1, [],[]),
              parseUnits("500", 6),
            )
            const ret = [r.liquidityRatioOut, ...r.amountsToConvertOut].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("1", 18).mul(101).mul(5).div(500).div(100),
              0,
              0,
              0,
            ].map(x => BalanceUtils.toString(x)).join("\n");
            await expect(ret).eq(expected);
          });
        });
        describe("base amount of first asset is enough to get the required amount", () => {
          it("should return expected values", async () => {
            const tokens = [dai.address, usdc.address, usdt.address];
            const amountsToRepay = [
                parseUnits("17", 18),
                parseUnits("27", 6),
                parseUnits("37", 6),
            ];
            const amountsCollateralOut = [
                parseUnits("7", 6), // 7 > 5
                parseUnits("0", 6),
                parseUnits("14", 6),
            ];
            for (let i = 0; i < tokens.length; ++ i) {
              await facade.setBaseAmounts(tokens[i], amountsToRepay[i]);
            }

            const r = await facade.callStatic.getLiquidityAmountRatio(
              parseUnits("5", 6),
              ethers.Wallet.createRandom().address,
              tokens,
              1,
              getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut),
              parseUnits("500", 6),
            );

            const ret = [r.liquidityRatioOut, ...r.amountsToConvertOut].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              0,
              parseUnits("17", 18),
              0,
              0,
            ].map(x => BalanceUtils.toString(x)).join("\n");
            await expect(ret).eq(expected);

          });
        });
        describe("base amount of two assets is enough to get the required amount", () => {
          it("should return expected values", async () => {
            const tokens = [dai.address, usdc.address, usdt.address];
            const amountsToRepay = [
              parseUnits("17", 18),
              parseUnits("27", 6),
              parseUnits("37", 6),
            ];
            const amountsCollateralOut = [
              parseUnits("7", 6), // 7 < 9
              parseUnits("24", 6), // not used
              parseUnits("2", 6), // 2 + 7 == 9
            ];
            for (let i = 0; i < tokens.length; ++ i) {
              await facade.setBaseAmounts(tokens[i], amountsToRepay[i]);
            }

            const r = await facade.callStatic.getLiquidityAmountRatio(
              parseUnits("9", 6),
              ethers.Wallet.createRandom().address,
              tokens,
              1,
              getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut),
              parseUnits("500", 6),
            );

            const ret = [r.liquidityRatioOut, ...r.amountsToConvertOut].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              0,
              parseUnits("17", 18),
              0,
              parseUnits("37", 6),
            ].map(x => BalanceUtils.toString(x)).join("\n");
            await expect(ret).eq(expected);

          });
        });
        describe("base amount of two assets is NOT enough to get the required amount", () => {
          it("should return expected values", async () => {
            const tokens = [dai.address, usdc.address, usdt.address];
            const amountsToRepay = [
              parseUnits("17", 18),
              parseUnits("27", 6),
              parseUnits("37", 6),
            ];
            const amountsCollateralOut = [
              parseUnits("7", 6), // 7 < 19
              parseUnits("24", 6), // not used
              parseUnits("2", 6), // 2 + 7 < 19
            ];
            for (let i = 0; i < tokens.length; ++ i) {
              await facade.setBaseAmounts(tokens[i], amountsToRepay[i]);
            }

            const r = await facade.callStatic.getLiquidityAmountRatio(
              parseUnits("19", 6),
              ethers.Wallet.createRandom().address,
              tokens,
              1,
              getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut),
              parseUnits("500", 6),
            );

            const ret = [r.liquidityRatioOut, ...r.amountsToConvertOut].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("1", 18).mul(101).mul(19-9).div(500-9).div(100),
              parseUnits("17", 18),
              0,
              parseUnits("37", 6),
            ].map(x => BalanceUtils.toString(x)).join("\n");
            await expect(ret).eq(expected);

          });
        });
      });
      describe("all", () => {
        describe("zero base amounts", () => {
          it("should return expected liquidityRatioOut and zero amounts to convert", async () => {
            const r = await facade.callStatic.getLiquidityAmountRatio(
              parseUnits("0", 6),
              ethers.Wallet.createRandom().address,
              [dai.address, usdc.address, usdt.address],
              1,
              getTetuConverter([],1, [],[]),
              parseUnits("500", 6),
            )
            const ret = [r.liquidityRatioOut, ...r.amountsToConvertOut].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("1", 18),
              0,
              0,
              0,
            ].map(x => BalanceUtils.toString(x)).join("\n");
            await expect(ret).eq(expected);
          });
        });
        describe("base amount are not zero", () => {
          it("should return expected values", async () => {
            const tokens = [dai.address, usdc.address, usdt.address];
            const amountsToRepay = [
              parseUnits("17", 18),
              parseUnits("27", 6),
              parseUnits("37", 6),
            ];
            const amountsCollateralOut = [
              parseUnits("7", 6), // 7 > 5
              parseUnits("22222", 6),
              parseUnits("14", 6),
            ];
            for (let i = 0; i < tokens.length; ++ i) {
              await facade.setBaseAmounts(tokens[i], amountsToRepay[i]);
            }

            const r = await facade.callStatic.getLiquidityAmountRatio(
              parseUnits("0", 6), // all
              ethers.Wallet.createRandom().address,
              tokens,
              1,
              getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut),
              parseUnits("500", 6),
            );

            const ret = [r.liquidityRatioOut, ...r.amountsToConvertOut].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("1", 18),
              parseUnits("17", 18),
              0,
              parseUnits("37", 6),
            ].map(x => BalanceUtils.toString(x)).join("\n");
            await expect(ret).eq(expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
// nothing to do
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const tokens = [dai.address, usdc.address, usdt.address];
        const amountsToRepay = [
          parseUnits("17", 18),
          parseUnits("27", 6),
          parseUnits("37", 6),
        ];
        const amountsCollateralOut = [
          parseUnits("7", 6), // 7 < 19
          parseUnits("24", 6), // not used
          parseUnits("2", 6), // 2 + 7 < 19
        ];
        for (let i = 0; i < tokens.length; ++ i) {
          await facade.setBaseAmounts(tokens[i], amountsToRepay[i]);
        }

        const gasUsed = await facade.estimateGas.getLiquidityAmountRatio(
          parseUnits("19", 6),
          ethers.Wallet.createRandom().address,
          tokens,
          1,
          getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut),
          parseUnits("500", 6),
        );

        controlGasLimitsEx(gasUsed, GET_LIQUIDITY_AMOUNT_RATIO, (u, t) => {
          expect(u).to.be.below(t + 1);
        });

      });
    });
  });

  describe("getCollaterals", () => {
    describe("Good paths", () => {
      describe("Same prices, same weights", () => {
        it("should return expected values", async () => {
          const assetAmount = parseUnits("1000", 6);
          const priceOracle = await MockHelper.createPriceOracle(
            signer,
            [dai.address, weth.address, usdc.address, tetu.address],
            [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18]
          );
          const ret = await facade.getCollaterals(
            assetAmount,
            [dai.address, weth.address, usdc.address, tetu.address],
            [1, 1, 1, 1],
            4,
            2,
            priceOracle.address
          );

          const expected = [
            parseUnits("250", 6),
            parseUnits("250", 6),
            parseUnits("250", 6),
            parseUnits("250", 6),
          ];

          expect(ret.join()).eq(expected.join());
        });
      });
      describe("Same prices, different weights", () => {
        it("should return expected values", async () => {
          const assetAmount = parseUnits("1000", 6);
          const priceOracle = await MockHelper.createPriceOracle(
            signer,
            [dai.address, weth.address, usdc.address, tetu.address],
            [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18]
          );
          const ret = await facade.getCollaterals(
            assetAmount,
            [dai.address, weth.address, usdc.address, tetu.address],
            [1, 2, 3, 4],
            10,
            2,
            priceOracle.address
          );

          const expected = [
            parseUnits("100", 6),
            parseUnits("200", 6),
            parseUnits("300", 6),
            parseUnits("400", 6),
          ];

          expect(ret.join()).eq(expected.join());
        });
      });
      describe("Some amounts are already on balance", () => {
        it("should return expected values", async () => {
          const assets = [dai, weth, usdc, tetu];
          const assetAmount = parseUnits("1000", 6);
          const priceOracle = await MockHelper.createPriceOracle(
            signer,
            assets.map(x => x.address),
            [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18]
          );
          const amountsOnBalance = [
            parseUnits("30", 18), // part of required amount is on the balance
            parseUnits("200", 18), // more amount than required is on the balance
            parseUnits("1000", 6), // USDC is the main asset
            parseUnits("100", 18), // full required amount is on balance
          ]
          for (let i = 0; i < assets.length; ++i) {
            await assets[i].mint(facade.address, amountsOnBalance[i]);
          }

          const ret = await facade.getCollaterals(
            assetAmount,
            assets.map(x => x.address),
            [1, 1, 1, 1],
            10,
            2,
            priceOracle.address
          );

          const expected = [
            parseUnits("70", 6),
            parseUnits("0", 6),
            parseUnits("100", 6),
            parseUnits("0", 6),
          ];

          expect(ret.join()).eq(expected.join());
        });
      });
    });
    describe("Bad paths", () => {
      // todo
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const assetAmount = parseUnits("1000", 6);
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [dai.address, weth.address, usdc.address, tetu.address],
          [Misc.ONE18, Misc.ONE18, Misc.ONE18, Misc.ONE18]
        );
        const gasUsed = await facade.estimateGas.getCollaterals(
          assetAmount,
          [dai.address, weth.address, usdc.address, tetu.address],
          [1, 1, 1, 1],
          4,
          2,
          priceOracle.address
        );

        controlGasLimitsEx(gasUsed, GET_GET_COLLATERALS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("getAssetIndex", () => {
    describe("Good paths", () => {
      it("should return expected index", async () => {
        const assets = [usdc.address, tetu.address, usdt.address];
        for (let i = 0; i < assets.length; ++i) {
          await expect(await facade.getAssetIndex(assets, assets[i])).eq(i);
        }
      });
    });
    describe("Bad paths", () => {
      it("should type(uint).max if the asset is not found", async () => {
        const assets = [usdc.address, tetu.address, usdt.address];
        const ret = await facade.getAssetIndex(assets, weth.address);
        expect(ret.eq(Misc.MAX_UINT)).eq(true);
      });
    });
  });

  describe("openPosition", () => {
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
      }
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
      params: IOpenPositionTestInputParams
    ) : Promise<IOpenPositionTestResults> {
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
            b.amountToBorrow
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
            1 // period
          );
        }
      }

      if (params.prices) {
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [collateralAsset.address, borrowAsset.address],
          [params.prices.collateral, params.prices.borrow]
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
        0
      );

      const tx = await facade.openPosition(
        tetuConverter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        0
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        collateralAmountOut: ret.collateralAmountOut,
        borrowedAmountOut: ret.borrowedAmountOut,
        gasUsed,
        balanceBorrowAssetTetuConverter: await borrowAsset.balanceOf(tetuConverter.address),
        balanceCollateralAssetFacade: await collateralAsset.balanceOf(facade.address)
      }
    }

    describe("Good paths", () => {
      describe("Entry kind 0", () => {
        it("should return expected values, single borrow", async () => {
          const converter = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            "0x",
            usdc,
            dai,
            parseUnits("11", 6),
            {
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("11", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("17", 18),
                converter
              }],
              findBorrowStrategyOutputs: [{
                converters: [converter],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: "0x",
                aprs18: [parseUnits("1", 18)],
                amountIn: parseUnits("11", 6),
                collateralAmountsOut: [parseUnits("11", 6)],
                amountToBorrowsOut: [parseUnits("17", 18)],
              }],
              amountCollateralForFacade: parseUnits("11", 6),
              amountBorrowAssetForTetuConverter: parseUnits("17", 18),
              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("11", 6), parseUnits("17", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it("should return expected values, two borrows", async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            "0x",
            usdc,
            dai,
            parseUnits("3", 6),
            {
              borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("1", 6),
                  borrowAsset: dai,
                  amountToBorrow:  parseUnits("1", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("2", 6),
                  borrowAsset: dai,
                  amountToBorrow:  parseUnits("2", 18),
                  converter: converter2
              }],
              findBorrowStrategyOutputs: [{
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: "0x",
                aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                amountIn: parseUnits("3", 6),
                amountToBorrowsOut: [parseUnits("1", 18), parseUnits("2", 18)],
                collateralAmountsOut: [parseUnits("1", 6), parseUnits("2", 6)]
              }],
              amountCollateralForFacade: parseUnits("11", 6),
              amountBorrowAssetForTetuConverter: parseUnits("17", 18),

              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("3", 6), parseUnits("3", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it("should return expected values, two borrows, platforms don't have enough amount", async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            "0x",
            usdc,
            dai,
            parseUnits("103", 6), // (!) we asked too much, lending platforms have DAI for $3 in total
            {
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("1", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("1", 18),
                converter: converter1
              }, {
                collateralAsset: usdc,
                collateralAmount: parseUnits("2", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("2", 18),
                converter: converter2
              }],
              findBorrowStrategyOutputs: [{
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: "0x",
                aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                amountIn: parseUnits("3", 6),
                amountToBorrowsOut: [parseUnits("1", 18), parseUnits("2", 18)],
                collateralAmountsOut: [parseUnits("1", 6), parseUnits("2", 6)]
              }],
              amountCollateralForFacade: parseUnits("11", 6),
              amountBorrowAssetForTetuConverter: parseUnits("17", 18),
              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("3", 6), parseUnits("3", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it("should return expected values, two borrows, platforms have more then required liquidity", async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            "0x",
            usdc,
            dai,
            parseUnits("100", 6),
            {
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("10", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("15", 18),
                converter: converter1
              }, {
                collateralAsset: usdc,
                collateralAmount: parseUnits("90", 6), // (!) we will take only 100-10 = 90
                borrowAsset: dai,
                amountToBorrow:  parseUnits("180", 18), // (!) we will take only 200*90/100 = 180
                converter: converter2
              }],
              findBorrowStrategyOutputs: [{
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: "0x",
                aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                amountIn: parseUnits("3", 6),
                amountToBorrowsOut: [parseUnits("15", 18), parseUnits("200", 18)],
                collateralAmountsOut: [parseUnits("10", 6), parseUnits("100", 6)]
              }],
              amountCollateralForFacade: parseUnits("100", 6),
              amountBorrowAssetForTetuConverter: parseUnits("195", 18),
              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("100", 6), parseUnits("195", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        describe("threshold is used, first conversion provides a bit less amount than required", () => {
          it("should return expected values, single borrow", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256"], [0]),
              usdc,
              weth,
              BigNumber.from("9762660842"),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: weth.address,
                  entryData: defaultAbiCoder.encode(["uint256"], [0]),
                  aprs18: [parseUnits("1", 18)],
                  amountIn: BigNumber.from("9762660842"),
                  collateralAmountsOut: [
                    BigNumber.from("9762660841"), // (!) 9762660842-1
                    BigNumber.from("9762660842")
                  ],
                  amountToBorrowsOut: [
                    BigNumber.from("1720944043846096427"),
                    BigNumber.from("1712848453478843025")
                  ]
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: BigNumber.from("9762660841"), // (!) 9762660842-1
                  borrowAsset: weth,
                  amountToBorrow: BigNumber.from("1718521573012697263"),
                  converter: converter1
                }],
                amountBorrowAssetForTetuConverter: BigNumber.from("1720944043846096427"),
                amountCollateralForFacade: BigNumber.from("9762660842"),
                amountInIsCollateral: true,
                prices: {
                  collateral: BigNumber.from("998200000000000000"),
                  borrow: BigNumber.from("1696840000000000000000")
                }
              }
            );

            const ret = [
              r.collateralAmountOut,
              r.borrowedAmountOut,
              r.balanceCollateralAssetFacade
            ].map(x => BalanceUtils.toString(x)).join();
            const expected = [
              BigNumber.from("9762660841"),
              BigNumber.from("1718521573012697263"),
              BigNumber.from(1)
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        })
      });
      describe("Entry kind 1", () => {
        describe("proportions 1:1", () => {
          it("should return expected values, single borrow, single converter", async () => {
            const converter = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
              usdc,
              dai,
              parseUnits("100", 6),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
                  aprs18: [parseUnits("1", 18)],
                  amountIn: parseUnits("100", 6),
                  amountToBorrowsOut: [parseUnits("50", 18)],
                  collateralAmountsOut: [parseUnits("75", 6)]
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("75", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("50", 18),
                  converter
                }],
                amountBorrowAssetForTetuConverter: parseUnits("50", 18),
                amountCollateralForFacade: parseUnits("75", 6),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("75", 6), parseUnits("50", 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it("should return expected values, single borrow, multiple converters", async () => {
            const converter = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
              usdc,
              dai,
              parseUnits("100", 6),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter, converter],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
                  aprs18: [parseUnits("1", 18)],
                  amountIn: parseUnits("100", 6),
                  amountToBorrowsOut: [parseUnits("50", 18), parseUnits("40", 18)],
                  collateralAmountsOut: [parseUnits("75", 6), parseUnits("70", 6)]
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("75", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("50", 18),
                  converter
                }],
                amountBorrowAssetForTetuConverter: parseUnits("50", 18),
                amountCollateralForFacade: parseUnits("75", 6),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("75", 6), parseUnits("50", 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it("should return expected values, two borrows", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
              usdc,
              dai,
              parseUnits("100", 6),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
                  aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                  amountIn: parseUnits("100", 6),
                  collateralAmountsOut: [parseUnits("15", 6), parseUnits("60", 6)],
                  amountToBorrowsOut: [parseUnits("5", 18), parseUnits("20", 18)],
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("15", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("5", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("60", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("20", 18),
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("75", 6),
                amountBorrowAssetForTetuConverter: parseUnits("25", 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("75", 6), parseUnits("25", 18)].map(x => BalanceUtils.toString(x)).join();

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
          it("should return expected values, two borrows, platforms don't have enough amount", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
              usdc,
              dai,
              parseUnits("100", 6),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
                  aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                  amountIn: parseUnits("100", 6),
                  collateralAmountsOut: [parseUnits("45", 6), parseUnits("15", 6)],
                  amountToBorrowsOut: [parseUnits("30", 18), parseUnits("10", 18)],
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("45", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("30", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("15", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("10", 18),
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("60", 6),
                amountBorrowAssetForTetuConverter: parseUnits("40", 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("60", 6), parseUnits("40", 18)].map(x => BalanceUtils.toString(x)).join();

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
          it("should return expected values, two borrows, platforms have more then required liquidity", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
              usdc,
              dai,
              parseUnits("100", 6),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
                  aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                  amountIn: parseUnits("100", 6),
                  collateralAmountsOut: [parseUnits("45", 6), parseUnits("75", 6)],
                  amountToBorrowsOut: [parseUnits("30", 18), parseUnits("50", 18)],
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("45", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("30", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("30", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("20", 18), // (75 - 45) * 30 / 100
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("75", 6),
                amountBorrowAssetForTetuConverter: parseUnits("50", 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("75", 6), parseUnits("50", 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
        describe("proportions 1:2", () => {
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
          it("should return expected values, two borrows, platforms have more then required liquidity, usdc => dai", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 2, 3]),
              usdc,
              dai,
              parseUnits("220", 6),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: dai.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 2, 3]),
                  aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                  amountIn: parseUnits("220", 6),
                  collateralAmountsOut: [parseUnits("90", 6), parseUnits("180", 6)],
                  amountToBorrowsOut: [parseUnits("60", 18), parseUnits("120", 18)],
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("90", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("60", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("90", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("60", 18),
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("180", 6),
                amountBorrowAssetForTetuConverter: parseUnits("120", 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("180", 6), parseUnits("120", 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it("should return expected values, two borrows, platforms have more then required liquidity, dai => usdc", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 2, 3]),
              dai,
              usdc,
              parseUnits("220", 18),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: dai.address,
                  targetToken: usdc.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 2, 3]),
                  aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                  amountIn: parseUnits("220", 18),
                  collateralAmountsOut: [parseUnits("90", 18), parseUnits("180", 18)],
                  amountToBorrowsOut: [parseUnits("60", 6), parseUnits("120", 6)],
                }],
                borrows: [{
                  collateralAsset: dai,
                  collateralAmount: parseUnits("90", 18),
                  borrowAsset: usdc,
                  amountToBorrow: parseUnits("60", 6),
                  converter: converter1
                }, {
                  collateralAsset: dai,
                  collateralAmount: parseUnits("90", 18),
                  borrowAsset: usdc,
                  amountToBorrow: parseUnits("60", 6),
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("180", 18),
                amountBorrowAssetForTetuConverter: parseUnits("120", 6),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("180", 18), parseUnits("120", 6)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
        describe("use threshold, reproduce case openPosition.dust [matic block 40302700]", () => {
          it("should return expected values, single borrow", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
              usdc,
              weth,
              BigNumber.from("9762660842"),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: weth.address,
                  entryData: defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [1, 1, 1]),
                  aprs18: [parseUnits("1", 18)],
                  amountIn: BigNumber.from("9762660842"),
                  collateralAmountsOut: [BigNumber.from("6850990064"), BigNumber.from("6850990064")],
                  amountToBorrowsOut: [BigNumber.from("1720944043846096427"), BigNumber.from("1712848453478843025")]
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: BigNumber.from("6841346331"),
                  borrowAsset: weth,
                  amountToBorrow: BigNumber.from("1718521573012697263"),
                  converter: converter1
                }],
                amountBorrowAssetForTetuConverter: BigNumber.from("1718521573012697263"),
                amountCollateralForFacade: BigNumber.from("6841346332"),
                amountInIsCollateral: true,
                prices: {
                  collateral: BigNumber.from("998200000000000000"),
                  borrow: BigNumber.from("1696840000000000000000")
                }
              }
            );

            console.log("results", r);

            const totalAmountInTermsCollateral = r.collateralAmountOut.add(
              r.borrowedAmountOut
                .mul(BigNumber.from("1696840000000000000000"))
                .mul(parseUnits("1", 6))
                .div(BigNumber.from("998200000000000000"))
                .div(parseUnits("1", 18))
            );

            const ret = areAlmostEqual(totalAmountInTermsCollateral, BigNumber.from("9762660842"));
            expect(ret).eq(true);
          });
        })
      });
      describe("Entry kind 2", () => {
        it("should return expected values, single borrow", async () => {
          const converter = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(["uint256"], [2]),
            usdc,
            dai,
            parseUnits("7", 18),
            {
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("3", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("7", 18),
                converter
              }],
              findBorrowStrategyOutputs: [{
                converters: [converter],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: defaultAbiCoder.encode(["uint256"], [2]),
                aprs18: [parseUnits("1", 18)],
                amountIn: parseUnits("7", 18),
                amountToBorrowsOut: [parseUnits("7", 18)],
                collateralAmountsOut: [parseUnits("3", 6)]
              }],
              amountBorrowAssetForTetuConverter: parseUnits("7", 18),
              amountCollateralForFacade: parseUnits("3", 6),
              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("3", 6), parseUnits("7", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it("should return expected values, two platforms together have exactly required amount (unreal case)", async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(["uint256"], [2]),
            usdc,
            dai,
            parseUnits("62", 18),
            {
              findBorrowStrategyOutputs: [{
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: defaultAbiCoder.encode(["uint256"], [2]),
                aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                amountIn: parseUnits("62", 18),
                collateralAmountsOut: [parseUnits("70", 6), parseUnits("30", 6)],
                amountToBorrowsOut: [parseUnits("50", 18), parseUnits("12", 18)],
              }],
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("70", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("50", 18),
                converter: converter1
              }, {
                collateralAsset: usdc,
                collateralAmount: parseUnits("30", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("12", 18),
                converter: converter2
              }],
              amountCollateralForFacade: parseUnits("100", 6),
              amountBorrowAssetForTetuConverter: parseUnits("62", 18),

              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("100", 6), parseUnits("62", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it("should return expected values, two borrows, platforms don't have enough amount", async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(["uint256"], [2]),
            usdc,
            dai,
            parseUnits("62", 18),
            {
              findBorrowStrategyOutputs: [{
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: defaultAbiCoder.encode(["uint256"], [2]),
                aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                amountIn: parseUnits("62", 18),
                amountToBorrowsOut: [parseUnits("13", 18), parseUnits("41", 18)],
                collateralAmountsOut: [parseUnits("20", 6), parseUnits("60", 6)]
              }],
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("20", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("13", 18),
                converter: converter1
              }, {
                collateralAsset: usdc,
                collateralAmount: parseUnits("60", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("41", 18),
                converter: converter2
              }],
              amountCollateralForFacade: parseUnits("80", 6),
              amountBorrowAssetForTetuConverter: parseUnits("54", 18),
              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("80", 6), parseUnits("54", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        it("should return expected values, two borrows, platforms have more then required liquidity", async () => {
          const converter1 = ethers.Wallet.createRandom().address;
          const converter2 = ethers.Wallet.createRandom().address;
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(["uint256"], [2]),
            usdc,
            dai,
            parseUnits("91", 18),
            {
              findBorrowStrategyOutputs: [{
                converters: [converter1, converter2],
                sourceToken: usdc.address,
                targetToken: dai.address,
                entryData: defaultAbiCoder.encode(["uint256"], [2]),
                aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
                amountIn: parseUnits("91", 18),
                collateralAmountsOut: [parseUnits("215", 6), parseUnits("465", 6)],
                amountToBorrowsOut: [parseUnits("81", 18), parseUnits("93", 18)],
              }],
              borrows: [{
                collateralAsset: usdc,
                collateralAmount: parseUnits("215", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("81", 18),
                converter: converter1
              }, {
                collateralAsset: usdc,
                collateralAmount: parseUnits("50", 6),
                borrowAsset: dai,
                amountToBorrow:  parseUnits("10", 18), // 93 * (91-81)/93
                converter: converter2
              }],
              amountCollateralForFacade: parseUnits("265", 6), // 215 + 465 * (91-81)/93
              amountBorrowAssetForTetuConverter: parseUnits("91", 18), // 81 + 93 * (91-81)/93
              amountInIsCollateral: true
            }
          );

          const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
          const expected = [parseUnits("265", 6), parseUnits("91", 18)].map(x => BalanceUtils.toString(x)).join();

          expect(ret).eq(expected);
        });
        describe("threshold is used, first conversion provides a bit less amount than required", () => {
          it("should return expected values, single borrow", async () => {
            const converter1 = ethers.Wallet.createRandom().address;
            const converter2 = ethers.Wallet.createRandom().address;
            const r = await makeOpenPositionTest(
              defaultAbiCoder.encode(["uint256"], [2]),
              usdc,
              weth,
              BigNumber.from("1720944043846096429"),
              {
                findBorrowStrategyOutputs: [{
                  converters: [converter1, converter2],
                  sourceToken: usdc.address,
                  targetToken: weth.address,
                  entryData: defaultAbiCoder.encode(["uint256"], [2]),
                  aprs18: [parseUnits("1", 18)],
                  amountIn: BigNumber.from("9762660842"),
                  collateralAmountsOut: [
                    BigNumber.from("9762660842"),
                    BigNumber.from("9762660842")
                  ],
                  amountToBorrowsOut: [
                    BigNumber.from("1720944043846096427"), // () 1720944043846096429 - 2
                    BigNumber.from("1712848453478843025")
                  ]
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: BigNumber.from("9762660842"),
                  borrowAsset: weth,
                  amountToBorrow: BigNumber.from("1720944043846096427"),
                  converter: converter1
                }],
                amountBorrowAssetForTetuConverter: BigNumber.from("1720944043846096429"),
                amountCollateralForFacade: BigNumber.from("9762660842"),
                amountInIsCollateral: true,
                prices: {
                  collateral: BigNumber.from("998200000000000000"),
                  borrow: BigNumber.from("1696840000000000000000")
                }
              }
            );

            const ret = [
              r.collateralAmountOut,
              r.borrowedAmountOut,
              r.balanceBorrowAssetTetuConverter
            ].map(x => BalanceUtils.toString(x)).join();
            const expected = [
              BigNumber.from("9762660842"),
              BigNumber.from("1720944043846096427"),
              BigNumber.from(2)
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        })
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const converter1 = ethers.Wallet.createRandom().address;
        const converter2 = ethers.Wallet.createRandom().address;
        const r = await makeOpenPositionTest(
          "0x",
          usdc,
          dai,
          parseUnits("103", 6), // (!) we asked too much, lending platforms have DAI for $3 in total
          {
            borrows: [{
              collateralAsset: usdc,
              collateralAmount: parseUnits("1", 6),
              borrowAsset: dai,
              amountToBorrow:  parseUnits("1", 18),
              converter: converter1
            }, {
              collateralAsset: usdc,
              collateralAmount: parseUnits("2", 6),
              borrowAsset: dai,
              amountToBorrow:  parseUnits("2", 18),
              converter: converter2
            }],
            findBorrowStrategyOutputs: [{
              converters: [converter1, converter2],
              sourceToken: usdc.address,
              targetToken: dai.address,
              entryData: "0x",
              aprs18: [parseUnits("1", 18), parseUnits("2", 18)],
              amountIn: parseUnits("3", 6),
              amountToBorrowsOut: [parseUnits("1", 18), parseUnits("2", 18)],
              collateralAmountsOut: [parseUnits("1", 6), parseUnits("2", 6)]
            }],
            amountCollateralForFacade: parseUnits("3", 6),
            amountBorrowAssetForTetuConverter: parseUnits("3", 18),
            amountInIsCollateral: true
          }
        );

        controlGasLimitsEx(r.gasUsed, GAS_OPEN_POSITION, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("getAvailableBalances", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const assets = [dai, tetu, usdc, usdt];
        const balances: BigNumber[] = [];
        for (let i = 0; i < assets.length; ++i) {
          balances.push(parseUnits((i + 1).toString(), await assets[i].decimals()));
          await assets[i].mint(facade.address, balances[i]);
        }

        const r: BigNumber[] = await facade.getAvailableBalances(assets.map(x => x.address), 2);
        const ret = r.map(x => BalanceUtils.toString(x)).join();
        const expected = [
          parseUnits("1", await dai.decimals()),
          parseUnits("2", await tetu.decimals()),
          0, // balance is not calculated for the main asset
          parseUnits("4", await usdt.decimals()),
        ].map(x => BalanceUtils.toString(x)).join();

        expect(ret).eq(expected);
      });
    });
  });

  describe("calcInvestedAssets", () => {
    interface ICalcInvestedAssetsParams {
      tokens: MockToken[];
      amountsOut?: string[];
      indexAsset: number;
      baseAmounts?: string[];
      prices: string[];
      debts?: {
        borrowAsset: MockToken;
        debtAmount: string;
        collateralAmount: string;
      }[];
    }
    interface ICalcInvestedAssetsResults {
      amountOut: number;
      gasUsed: BigNumber;
    }
    async function makeCalcInvestedAssetsTest(params: ICalcInvestedAssetsParams) : Promise<ICalcInvestedAssetsResults> {
      const decimals = await Promise.all(
        params.tokens.map(
          async x => x.decimals()
        )
      );
      if (params.baseAmounts) {
        for (let i = 0; i < params.tokens.length; ++i) {
          await facade.setBaseAmounts(
            params.tokens[i].address,
            parseUnits(params.baseAmounts[i], decimals[i])
          )
        }
      }
      const tc = await MockHelper.createMockTetuConverter(signer);
      if (params.debts) {
        for (let i = 0; i < params.debts.length; ++i) {
          await tc.setGetDebtAmountCurrent(
            facade.address,
            params.tokens[params.indexAsset].address,
            params.debts[i].borrowAsset.address,
            parseUnits(params.debts[i].debtAmount, decimals[i]),
            parseUnits(params.debts[i].collateralAmount, decimals[params.indexAsset]),
          );
        }
      }
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        params.tokens.map(x => x.address),
        params.prices.map(x => parseUnits(x, 18))
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await tc.setController(controller.address);

      const amountOut = await facade.callStatic.calcInvestedAssets(
        params.tokens.map(x => x.address),
        params.amountsOut
          ? params.amountsOut.map((x, index) => parseUnits(x, decimals[index]))
          : params.tokens.map(x => BigNumber.from(0)),
        params.indexAsset,
        tc.address
      );
      console.log("amountOut", amountOut);

      const gasUsed = await facade.estimateGas.calcInvestedAssets(
        params.tokens.map(x => x.address),
        params.amountsOut || params.tokens.map(x => BigNumber.from(0)),
        params.indexAsset,
        tc.address
      );

      return {
        amountOut: +formatUnits(amountOut, decimals[params.indexAsset]),
        gasUsed
      };
    }

    describe("Good paths", () => {
      describe("All amounts are located on the strategy balance only (liquidity is zero)", () => {
        describe("No debts", () => {
          it("should return expected values", async () => {
            const ret = (await makeCalcInvestedAssetsTest({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              baseAmounts: ["100", "1987", "300"],
              prices: ["20", "10", "60"]
            })).amountOut;
            const expected = 100 * 20 / 10 + 300 * 60 / 10;

            expect(ret).eq(expected);
          });
        });
        describe("There is a debt", () => {
          describe("Amount to repay == amount of the debt", () => {
            it("should return expected values", async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                baseAmounts: ["117", "1987", "300"],
                prices: ["20", "10", "60"],
                debts: [{
                  debtAmount: "117",
                  collateralAmount: "1500",
                  borrowAsset: dai
                }]
              })).amountOut;
              const expected = 1500 + 300 * 60 / 10;

              expect(ret).eq(expected);
            });
          });
          describe("Amount to repay > amount of the debt", () => {
            it("should return expected values", async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                baseAmounts: ["117", "1987", "300"],
                prices: ["20", "10", "60"],
                debts: [{
                  debtAmount: "17",
                  collateralAmount: "500",
                  borrowAsset: dai
                }]
              })).amountOut;
              const expected = 500 + (117 - 17) * 20 / 10 +  300 * 60 / 10;

              expect(ret).eq(expected);
            });
          });
          describe("Amount to repay < amount of the debt, the repayment is profitable", () => {
            it("should return expected values", async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                baseAmounts: ["117", "1987", "300"],
                prices: ["20", "10", "60"],
                debts: [{
                  debtAmount: "217",
                  collateralAmount: "500",
                  borrowAsset: dai
                }]
              })).amountOut;
              const availableMainAsset = 300 * 60 / 10;
              const amountToPayTheDebt = (217 - 117) * 20 / 10;
              const expected = availableMainAsset + 500 - amountToPayTheDebt;

              expect(ret).eq(expected);
            });
          });
          describe("Amount to repay < amount of the debt, the repayment is NOT profitable", () => {
            it("should return expected values", async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                baseAmounts: ["117", "1987", "300"],
                prices: ["20", "10", "60"],
                debts: [{
                  debtAmount: "5117",
                  collateralAmount: "500",
                  borrowAsset: dai
                }]
              })).amountOut;
              const availableMainAsset = 300 * 60 / 10;
              const amountToPayTheDebt = (5117 - 117) * 20 / 10;
              const expected = 0; // amountToPayTheDebt > availableMainAsset + 500 (collateral)

              expect(ret).eq(expected);
            });
          });
        });
      });
      describe("All amounts are deposited to the pool", () => {
        it("should return expected values", async () => {
          const ret = (await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            amountsOut: ["100", "200", "300"],
            baseAmounts: ["0", "0", "0"],
            prices: ["20", "10", "60"]
          })).amountOut;
          const expected = 200 + 100 * 20 / 10 + 300 * 60 / 10;

          expect(ret).eq(expected);
        });
      });
      describe("Amount to repay < amount available in the pool+balance", () => {
        it("should return expected values", async () => {
          const ret = (await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            baseAmounts: ["100", "1987", "300"],
            amountsOut: ["700", "1000", "400"],
            prices: ["20", "10", "60"],
            debts: [{
              debtAmount: "200",
              collateralAmount: "1501",
              borrowAsset: dai
            }]
          })).amountOut;
          const amountToPayTheDebt = 200 * 20 / 10;
          const availableMainAsset = 1000 + (300 + 400) * 60 / 10 + (700 + 100) * 20 / 10;
          const expected = availableMainAsset + 1501 - amountToPayTheDebt;

          expect(ret).eq(expected);
        });
      });
      describe("Amount to repay >= amount available in the pool+balance", () => {
        it("should return expected values", async () => {
          const ret = (await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            baseAmounts: ["100", "1987", "300"],
            amountsOut: ["700", "1000", "400"],
            prices: ["20", "10", "60"],
            debts: [{
              debtAmount: "900",
              collateralAmount: "1501",
              borrowAsset: dai
            }]
          })).amountOut;
          const amountToPayTheDebt = 900 * 20 / 10;
          const availableMainAsset = 1000 + (300 + 400) * 60 / 10 + (700 + 100) * 20 / 10;
          const expected = availableMainAsset + 1501 - amountToPayTheDebt;

          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits, no debts", async () => {
        const r = await makeCalcInvestedAssetsTest({
          tokens: [dai, usdc, usdt],
          indexAsset: 1,
          baseAmounts: ["100", "1987", "300"],
          prices: ["20", "10", "60"]
        });

        controlGasLimitsEx(r.gasUsed, GAS_CALC_INVESTED_ASSETS_NO_DEBTS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
      it("should not exceed gas limits, debt exists", async () => {
        const r = await makeCalcInvestedAssetsTest({
          tokens: [dai, usdc, usdt],
          indexAsset: 1,
          baseAmounts: ["100", "1987", "300"],
          amountsOut: ["700", "1000", "400"],
          prices: ["20", "10", "60"],
          debts: [{
            debtAmount: "200",
            collateralAmount: "1501",
            borrowAsset: dai
          }]
        });
        controlGasLimitsEx(r.gasUsed, GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("sendPerformanceFee", () => {
    interface ISendPerformanceFeeParams {
      fee: number;
      rewardTokens: MockToken[];
      rewardAmounts: number[];
    }
    interface ISendPerformanceFeeResults {
      rewardAmounts: number[];
      performanceAmounts: number[];
      facadeBalances: number[];
      receiverBalances: number[];
      gasUsed: BigNumber;
    }
    async function sendPerformanceFeeTest(
      params: ISendPerformanceFeeParams
    ) : Promise<ISendPerformanceFeeResults> {
      const receiver = ethers.Wallet.createRandom().address;
      for (let i = 0; i < params.rewardTokens.length; ++i) {
        await params.rewardTokens[i].mint(facade.address, params.rewardAmounts[i]);
      }
      const r = await facade.callStatic.sendPerformanceFee(
        params.fee,
        receiver,
        params.rewardTokens.map(x => x.address),
        params.rewardAmounts
      );

      const tx = await facade.sendPerformanceFee(
        params.fee,
        receiver,
        params.rewardTokens.map(x => x.address),
        params.rewardAmounts
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const facadeBalances = await Promise.all(
        params.rewardTokens.map(
          async rewardToken => rewardToken.balanceOf(facade.address)
        )
      );
      const receiverBalances = await Promise.all(
        params.rewardTokens.map(
          async rewardToken => rewardToken.balanceOf(receiver)
        )
      );

      return {
        gasUsed,
        performanceAmounts: r.performanceAmounts.map(x => x.toNumber()),
        rewardAmounts: r.rewardAmounts.map(x => x.toNumber()),
        facadeBalances: facadeBalances.map(x => x.toNumber()),
        receiverBalances: receiverBalances.map(x => x.toNumber()),
      }
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const r = await sendPerformanceFeeTest({
          fee: 10_000,
          rewardTokens: [tetu, usdc, usdt, dai],
          rewardAmounts: [10, 20, 30, 40]
        });

        const ret = [
          r.performanceAmounts.join(),
          r.rewardAmounts.join(),
          r.facadeBalances.join(),
          r.receiverBalances.join()
        ].join("\n");

        const expected = [
          [1, 2, 3, 4].join(),
          [9, 18, 27, 36].join(),
          [9, 18, 27, 36].join(),
          [1, 2, 3, 4].join()
        ].join("\n");

        return expect(ret).eq(expected);
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const r = await sendPerformanceFeeTest({
          fee: 10_000,
          rewardTokens: [tetu, usdc, usdt, dai],
          rewardAmounts: [10, 20, 30, 40]
        });
        controlGasLimitsEx(r.gasUsed, GAS_PERFORMANCE_FEE, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("_swapToGetAmount", () => {
    interface ISwapToGetAmountParams {
      tokens: MockToken[];
      targetAmount: string;
      receivedTargetAmount: string;
      amounts: string[];
      prices: string[];
      overswap: number;
      indexTargetAsset: number;
      indexTokenIn: number;
      liquidations: ILiquidationParams[];
      underlying: MockToken;
      liquidationThresholdForTargetAsset: string;
    }
    interface ISwapToGetAmountResults {
      amountSpent: BigNumber;
      amountReceived: BigNumber;
    }
    async function makeSwapToGetAmountTest(p: ISwapToGetAmountParams) : Promise<ISwapToGetAmountResults> {
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);
        await p.tokens[i].mint(facade.address, parseUnits(p.amounts[i], d));
      }
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
      }
      const params = {
        targetAmount: parseUnits(p.targetAmount, decimals[p.indexTargetAsset]),
        tokens: p.tokens.map(x => x.address),
        indexTargetAsset: p.indexTargetAsset,
        underlying: p.underlying.address,
        amounts: p.amounts.map((x, index) => parseUnits(x, decimals[index])),
        converter: ethers.Wallet.createRandom().address,
        liquidator: liquidator.address,
        liquidationThresholdForTargetAsset: parseUnits(p.liquidationThresholdForTargetAsset, decimals[p.indexTargetAsset]),
        overswap: p.overswap
      };
      const vars = {
        len: p.tokens.length,
        prices: p.prices.map(x => parseUnits(x, 18)),
        decs: decimals.map(x => parseUnits("1", x)),
        debts: [] // not used
      };
      const receivedTargetAmount = parseUnits(p.receivedTargetAmount, decimals[p.indexTargetAsset]);
      const r = await facade.callStatic.swapToGetAmountAccess(receivedTargetAmount, params, vars, p.indexTokenIn);
      await facade.swapToGetAmountAccess(receivedTargetAmount, params, vars, p.indexTokenIn);
      return {
        amountReceived: r.amountReceived,
        amountSpent: r.amountSpent
      }
    }
    describe("overswap == 0", () => {
      describe("liquidationThresholdForTargetAsset < amountOut", () => {
        it("tetu=>usdt, should return expected values", async () => {
          const r = await makeSwapToGetAmountTest({
            tokens: [usdc, usdt, tetu],
            prices: ["1", "1", "0.5"],
            overswap: 0,
            liquidationThresholdForTargetAsset: "0",
            amounts: ["1234", "0", "1000"], // no USDT on balance, but we have some USDC and TETU
            underlying: usdc,
            targetAmount: "117", // we need to get 117 USDT
            indexTargetAsset: 1,
            indexTokenIn: 2,
            receivedTargetAmount: "17", // assume that we already received 100 USDT
            liquidations: [{
              amountIn: parseUnits("200", 18), // we need 200 tetu to get 100 USDT
              amountOut: parseUnits("99", 6), // assume that we lost 1 USDT on conversion
              tokenIn: tetu,
              tokenOut: usdt
            }]
          });

          const ret = [
            +formatUnits(r.amountSpent, 18),
            +formatUnits(r.amountReceived, 6),
            +formatUnits(await usdt.balanceOf(facade.address), 6),
            +formatUnits(await tetu.balanceOf(facade.address), 18),
          ].join();

          const expected = [
            +formatUnits(parseUnits("200", 18), 18),
            +formatUnits(parseUnits("99", 6), 6),
            +formatUnits(parseUnits("99", 6), 6),
            +formatUnits(parseUnits("800", 18), 18),
          ].join();

          expect(ret).eq(expected);
        });
      });
    });
    describe("liquidationThresholdForTargetAsset > amountOut", () => {
      it("tetu=>usdt, should return zero values", async () => {
        const r = await makeSwapToGetAmountTest({
          tokens: [usdc, usdt, tetu],
          prices: ["1", "1", "0.5"],
          overswap: 0,
          liquidationThresholdForTargetAsset: "199", // (!) the threshold 199 exceeds amountOut = 99
          amounts: ["1234", "0", "1000"], // no USDT on balance, but we have some USDC and TETU
          underlying: usdc,
          targetAmount: "117", // we need to get 117 USDT
          indexTargetAsset: 1,
          indexTokenIn: 2,
          receivedTargetAmount: "17", // assume that we already received 100 USDT
          liquidations: [{
            amountIn: parseUnits("200", 18), // we need 200 tetu to get 100 USDT
            amountOut: parseUnits("99", 6), // assume that we lost 1 USDT on conversion
            tokenIn: tetu,
            tokenOut: usdt
          }]
        });

        const ret = [
          +formatUnits(r.amountSpent, 18),
          +formatUnits(r.amountReceived, 6),
          +formatUnits(await usdt.balanceOf(facade.address), 6),
          +formatUnits(await tetu.balanceOf(facade.address), 18),
        ].join();

        const expected = [
          +formatUnits(parseUnits("0", 18), 18),
          +formatUnits(parseUnits("0", 6), 6),
          +formatUnits(parseUnits("0", 6), 6),
          +formatUnits(parseUnits("1000", 18), 18),
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("overswap != 0", () => {
      it("tetu=>usdt, should return expected values", async () => {
        const r = await makeSwapToGetAmountTest({
          tokens: [usdc, usdt, tetu],
          prices: ["1", "1", "0.5"],
          overswap: 50_000, // (!) we are going to swap twice more than it's necessary according calculations by prices
          liquidationThresholdForTargetAsset: "0",
          amounts: ["1234", "0", "1000"], // no USDT on balance, but we have some USDC and TETU
          underlying: usdc,
          targetAmount: "117", // we need to get 117 USDT
          indexTargetAsset: 1,
          indexTokenIn: 2,
          receivedTargetAmount: "17", // assume that we already received 100 USDT
          liquidations: [{
            amountIn: parseUnits("300", 18), // we need 200 tetu to get 100 USDT
            amountOut: parseUnits("198", 6), // assume that we lost some USDT on conversion
            tokenIn: tetu,
            tokenOut: usdt
          }]
        });

        const ret = [
          +formatUnits(r.amountSpent, 18),
          +formatUnits(r.amountReceived, 6),
          +formatUnits(await usdt.balanceOf(facade.address), 6),
          +formatUnits(await tetu.balanceOf(facade.address), 18),
        ].join();

        const expected = [
          +formatUnits(parseUnits("300", 18), 18),
          +formatUnits(parseUnits("198", 6), 6),
          +formatUnits(parseUnits("198", 6), 6),
          +formatUnits(parseUnits("700", 18), 18),
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("there is not enough amount", () => {
      it("tetu=>usdt, should return expected values", async () => {
        const r = await makeSwapToGetAmountTest({
          tokens: [usdc, usdt, tetu],
          prices: ["1", "1", "0.5"],
          overswap: 50_000, // we are going to swap twice more than it's necessary according calculations by prices
          liquidationThresholdForTargetAsset: "0",
          amounts: ["1234", "0", "200"], // (!) we need to swap 300 tetu, but we have only 200 tetu
          underlying: usdc,
          targetAmount: "117", // we need to get 117 USDT
          indexTargetAsset: 1,
          indexTokenIn: 2,
          receivedTargetAmount: "17", // assume that we already received 100 USDT
          liquidations: [{
            amountIn: parseUnits("200", 18), // we need 200 tetu to get 100 USDT
            amountOut: parseUnits("99", 6), // assume that we lost some USDT on conversion
            tokenIn: tetu,
            tokenOut: usdt
          }]
        });

        const ret = [
          +formatUnits(r.amountSpent, 18),
          +formatUnits(r.amountReceived, 6),
          +formatUnits(await usdt.balanceOf(facade.address), 6),
          +formatUnits(await tetu.balanceOf(facade.address), 18),
        ].join();

        const expected = [
          +formatUnits(parseUnits("200", 18), 18),
          +formatUnits(parseUnits("99", 6), 6),
          +formatUnits(parseUnits("99", 6), 6),
          +formatUnits(parseUnits("0", 18), 18),
        ].join();

        expect(ret).eq(expected);
      });
    });
  });

  describe("_swapToGivenAmount", () => {
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
    }
    interface ISwapToGivenAmountResults {
      spentAmounts: BigNumber[];
      withdrawnAmountsOut: BigNumber[];
    }
    async function makeSwapToGivenAmountTest(p: ISwapToGivenAmountParams) : Promise<ISwapToGivenAmountResults> {
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);
        await p.tokens[i].mint(facade.address, parseUnits(p.amounts[i], d));
      }
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
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

      const r = await facade.callStatic._swapToGivenAmountAccess({
        targetAmount: parseUnits(p.targetAmount, decimals[p.indexTargetAsset]),
        tokens: p.tokens.map(x => x.address),
        indexTargetAsset: p.indexTargetAsset,
        underlying: p.underlying.address,
        amounts: p.amounts.map((x, index) => parseUnits(x, decimals[index])),
        converter: converter.address,
        liquidator: liquidator.address,
        liquidationThresholdForTargetAsset: parseUnits(p.liquidationThresholdForTargetAsset, decimals[p.indexTargetAsset]),
        overswap: p.overswap
      });
      console.log("r", r);
      await facade._swapToGivenAmountAccess({
        targetAmount: parseUnits(p.targetAmount, decimals[p.indexTargetAsset]),
        tokens: p.tokens.map(x => x.address),
        indexTargetAsset: p.indexTargetAsset,
        underlying: p.underlying.address,
        amounts: p.amounts.map((x, index) => parseUnits(x, decimals[index])),
        converter: converter.address,
        liquidator: liquidator.address,
        liquidationThresholdForTargetAsset: parseUnits(p.liquidationThresholdForTargetAsset, decimals[p.indexTargetAsset]),
        overswap: p.overswap
      });
      return {
        spentAmounts: r.spentAmounts,
        withdrawnAmountsOut: r.receivedAmounts
      }
    }
    describe("Two assets", () => {
      describe("Target asset is underlying", () => {
        it("should return expected values", async () => {
          const r = await makeSwapToGivenAmountTest({
            targetAmount: "100", // we need to get 100 USDC
            tokens: [usdc, tetu],
            indexTargetAsset: 0, // USDC
            underlying: usdc,
            liquidationThresholdForTargetAsset: "0",
            overswap: 50_000, // we are going to swap twice more than it's necessary according calculations by prices

            amounts: ["0", "1000"],
            prices: ["1", "0.5"],
            liquidations: [{
              amountIn: parseUnits("300", 18), // we need to converter 200 tetu + overswap 50% = 300 tetu
              amountOut: parseUnits("127", 6),
              tokenIn: tetu,
              tokenOut: usdc
            }]
          });

          const ret = [
            r.spentAmounts.map(x => BalanceUtils.toString(x)).join(),
            r.withdrawnAmountsOut.map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          const expected = [
            [
              parseUnits("0", 6),
              parseUnits("300", 18)
            ].map(x => BalanceUtils.toString(x)).join(),
            [
              parseUnits("127", 6),
              parseUnits("0", 18)
            ].map(x => BalanceUtils.toString(x)).join(),
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("Target asset is not underlying", () => {

      });
    });
    describe("Three assets", () => {
      describe("Not-underlying is enough", () => {
        it("should convert not-underlying only", async () => {

        });
      });
      describe("Not-underlying is NOT enough", () => {
        it("should convert not-underlying and underlying", async () => {

        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });

//endregion Unit tests
});