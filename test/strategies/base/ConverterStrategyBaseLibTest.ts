import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {ConverterStrategyBaseLibFacade, ITetuConverter, MockToken, PriceOracleMock} from "../../../typechain";
import {expect} from "chai";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_OPEN_POSITION,
  GET_EXPECTED_INVESTED_ASSETS_USD,
  GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS, GET_GET_COLLATERALS, GET_LIQUIDITY_AMOUNT_RATIO
} from "../../baseUT/GasLimits";
import {Misc} from "../../../scripts/utils/Misc";
import {decimalString} from "hardhat/internal/core/config/config-validation";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {BigNumber} from "ethers";

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
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
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
              parseUnits("800000", 8), // weth
            ],
            parseUnits("1000", 33), // decimals of the values don't matter here
            parseUnits("50000", 33), // only values ratio is important
          );

          const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
          const sexpected = [
            parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            parseUnits((800_000 * 1000 / 50_000).toString(), 8),
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
            parseUnits("800000", 8),
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
              {
                indexAsset: 1,
                tokens: [dai.address, usdc.address, usdt.address],
                investedAssets: parseUnits("500", 6),
                tetuConverter: getTetuConverter([],1, [],[])
              }
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
              {
                indexAsset: 1,
                tokens,
                investedAssets: parseUnits("500", 6),
                tetuConverter: getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut)
              }
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
              {
                indexAsset: 1,
                tokens,
                investedAssets: parseUnits("500", 6),
                tetuConverter: getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut)
              }
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
              {
                indexAsset: 1,
                tokens,
                investedAssets: parseUnits("500", 6),
                tetuConverter: getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut)
              }
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
              {
                indexAsset: 1,
                tokens: [dai.address, usdc.address, usdt.address],
                investedAssets: parseUnits("500", 6),
                tetuConverter: getTetuConverter([],1, [],[])
              }
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
              {
                indexAsset: 1,
                tokens,
                investedAssets: parseUnits("500", 6),
                tetuConverter: getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut)
              }
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
          {
            indexAsset: 1,
            tokens,
            investedAssets: parseUnits("500", 6),
            tetuConverter: getTetuConverter([dai, usdc, usdt],1, amountsToRepay, amountsCollateralOut)
          }
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
            parseUnits("200", 8), // more amount than required is on the balance
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
        amountIn
      );

      const gasUsed = await facade.estimateGas.openPosition(
        tetuConverter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn
      );

      return {
        collateralAmountOut: ret.collateralAmountOut,
        borrowedAmountOut: ret.borrowedAmountOut,
        gasUsed
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
      });
      describe("Entry kind 1", () => {
        describe("proportions 1:1", () => {
          it("should return expected values, single borrow", async () => {
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
                  collateralAmountsOut: [parseUnits("15", 6), parseUnits("30", 6)],
                  amountToBorrowsOut: [parseUnits("5", 18), parseUnits("10", 18)],
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("15", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("5", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("30", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("10", 18),
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("45", 6),
                amountBorrowAssetForTetuConverter: parseUnits("15", 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("45", 6), parseUnits("15", 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
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
                  collateralAmountsOut: [parseUnits("45", 6), parseUnits("100", 6)],
                  amountToBorrowsOut: [parseUnits("15", 18), parseUnits("30", 18)],
                }],
                borrows: [{
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("45", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("15", 18),
                  converter: converter1
                }, {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("30", 6),
                  borrowAsset: dai,
                  amountToBorrow: parseUnits("9", 18), // (75 - 45) * 30 / 100
                  converter: converter2
                }],
                amountCollateralForFacade: parseUnits("75", 6),
                amountBorrowAssetForTetuConverter: parseUnits("24", 18),
                amountInIsCollateral: true,
                prices: {
                  collateral: parseUnits("1", 18),
                  borrow: parseUnits("0.5", 18)
                }
              }
            );

            const ret = [r.collateralAmountOut, r.borrowedAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("75", 6), parseUnits("24", 18)].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
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
      });
    });
    describe("Bad paths", () => {
// todo
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
//endregion Unit tests
});