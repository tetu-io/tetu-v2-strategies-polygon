import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";
import {ConverterStrategyBaseLibFacade, MockToken, PriceOracleMock} from "../../../typechain";
import {expect} from "chai";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
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
              [parseUnits("4", 18), parseUnits("2", 18)],
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n");
            const sexpected = [
              parseUnits((200_000 * 4 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 2 * 1000 / 50_000).toString(), 18),
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
              [parseUnits("4", 18), parseUnits("2", 18)],
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
            const sexpected = [
              parseUnits((100_000 * 4 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 2 * 1000 / 50_000).toString(), 6),
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
              [parseUnits("4", 18), parseUnits("2", 18)],
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
            const sexpected = [
              parseUnits((100_000 * 4 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 2 * 1000 / 50_000).toString(), 6),
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
              [parseUnits("2", 18), parseUnits("4", 18)],
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
            const sexpected = [
              parseUnits((200_000 * 2 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 4 * 1000 / 50_000).toString(), 18),
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
            [
              parseUnits("4", 18),
              parseUnits("2", 18),
              parseUnits("8", 18)
            ],
          );

          const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
          const sexpected = [
            parseUnits((200_000 * 4 * 1000 / 50_000).toString(), 6),
            parseUnits((100_000 * 2 * 1000 / 50_000 ).toString(), 18),
            parseUnits((800_000 * 8 * 1000 / 50_000).toString(), 8),
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
          [parseUnits("4", 18), parseUnits("2", 18)],
        );
        const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
        const sexpected = [
          parseUnits("0", 6),
          parseUnits("0", 18),
        ].join("\n");

        expect(sret).eq(sexpected);
      });
      // it("should revert if main asset price is zero", async () => {
      //   await expect(
      //     facade.getExpectedWithdrawnAmounts(
      //       [
      //         parseUnits("200000", 6), // usdc
      //         parseUnits("100000", 18), // dai
      //       ],
      //       parseUnits("1000", 33), // decimals of the values don't matter here
      //       parseUnits("5000", 33), // total supply
      //       [
      //         parseUnits("0", 18), // (!) usdc price is zero
      //         parseUnits("2", 18)
      //       ],
      //     )
      //   ).revertedWith("TS-8 zero price");
      // });
      // it("should revert if secondary asset price is zero", async () => {
      //   await expect(
      //     facade.getExpectedWithdrawnAmounts(
      //       [
      //         parseUnits("200000", 6),
      //         parseUnits("100000", 18),
      //       ],
      //       parseUnits("1000", 33), // decimals of the values don't matter here
      //       parseUnits("5000", 33), // total supply
      //       [
      //         parseUnits("2", 6),
      //         parseUnits("0", 18), // (!) dai price is zero
      //       ],
      //     )
      //   ).revertedWith("TS-8 zero price");
      // });
      it("should use ratio 1 if liquidityAmount > totalSupply", async () => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
          ],
          parseUnits("5000", 33), // (!) liquidity is greater than total supply
          parseUnits("1000", 33), // (!) total supply
          [parseUnits("2", 18), parseUnits("4", 18)],
        );

        const sret = ret.map(x => BalanceUtils.toString(x)).join("\n")
        const sexpected = [
          parseUnits((200_000 * 2).toString(), 6), // ratio == 1
          parseUnits((100_000 * 4).toString(), 18), // ratio == 1
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
          [
            parseUnits("4", 18),
            parseUnits("2", 18),
            parseUnits("8", 18)
          ],
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
              parseUnits("1", 18).mul(101).mul(19-9).div(500).div(100),
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

//endregion Unit tests
});