import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../scripts/utils/DeployerUtils';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import {
  ConverterStrategyBaseLibFacade2,
  MockToken,
  PriceOracleMock
} from '../../../typechain';
import { expect } from 'chai';
import { MockHelper } from '../../baseUT/helpers/MockHelper';
import { controlGasLimitsEx } from '../../../scripts/utils/GasLimitUtils';
import {
  GAS_CALC_INVESTED_ASSETS_NO_DEBTS,
  GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT,
  GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS
} from "../../baseUT/GasLimits";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {BigNumber} from "ethers";

/**
 * Test of ConverterStrategyBaseLib2 using ConverterStrategyBaseLibFacade2
 * to direct access of the library functions.
 */
describe('ConverterStrategyBaseLib2Test', () => {
  //region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let facade: ConverterStrategyBaseLibFacade2;
  //endregion Variables

  //region before, after
  before(async function() {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseLibFacade2(signer);
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

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
  //endregion before, after

  //region Unit tests
  describe('getExpectedWithdrawnAmounts', () => {
    describe('Good paths', () => {
      describe('Two assets', () => {
        describe('The asset is first in _depositorPoolAssets, USDC, DAI', async() => {
          it('should return expected values, USDC is main', async() => {
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('200000', 6), // usdc
                parseUnits('100000', 18), // dai
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
          it('should return expected values, DAI is main', async() => {
            // DAI, USDC
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('100000', 18), // dai
                parseUnits('200000', 6), // usdc
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
        });
        describe('The asset is second in _depositorPoolAssets', async() => {
          it('should return expected values for USDC', async() => {
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('100000', 18), // dai
                parseUnits('200000', 6), // usdc
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
          it('should return expected values for DAI', async() => {
            const priceOracle = (await DeployerUtils.deployContract(
              signer,
              'PriceOracleMock',
              [usdc.address, dai.address],
              [parseUnits('4', 18), parseUnits('2', 18)],
            )) as PriceOracleMock;

            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('200000', 6), // usdc
                parseUnits('100000', 18), // dai
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
        });
      });
      describe('Three assets', () => {
        it('should return expected values', async() => {
          const ret = await facade.getExpectedWithdrawnAmounts(
            [
              parseUnits('200000', 6), // usdc
              parseUnits('100000', 18), // dai
              parseUnits('800000', 18), // weth
            ],
            parseUnits('1000', 33), // decimals of the values don't matter here
            parseUnits('50000', 33), // only values ratio is important
          );

          const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
          const sexpected = [
            parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            parseUnits((800_000 * 1000 / 50_000).toString(), 18),
          ].join('\n');

          expect(sret).eq(sexpected);
        });
      });
    });
    describe('Bad paths', () => {
      it('should return zero values if total supply is zero', async() => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits('200000', 6), // usdc
            parseUnits('100000', 18), // dai
          ],
          parseUnits('1000', 33), // decimals of the values don't matter here
          parseUnits('0', 33), // (!) total supply is zero
        );
        const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
        const sexpected = [
          parseUnits('0', 6),
          parseUnits('0', 18),
        ].join('\n');

        expect(sret).eq(sexpected);
      });

      it('should use ratio 1 if liquidityAmount > totalSupply', async() => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits('200000', 6),
            parseUnits('100000', 18),
          ],
          parseUnits('5000', 33), // (!) liquidity is greater than total supply
          parseUnits('1000', 33), // (!) total supply
        );

        const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
        const sexpected = [
          parseUnits((200_000).toString(), 6), // ratio == 1
          parseUnits((100_000).toString(), 18), // ratio == 1
        ].join('\n');

        expect(sret).eq(sexpected);
      });
    });
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limits @skip-on-coverage', async() => {
        const gasUsed = await facade.estimateGas.getExpectedWithdrawnAmounts(
          [
            parseUnits('200000', 6),
            parseUnits('100000', 18),
            parseUnits('800000', 18),
          ],
          parseUnits('1000', 33), // decimals of the values don't matter here
          parseUnits('50000', 33), // only values ratio is important
        );
        controlGasLimitsEx(gasUsed, GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe('getAvailableBalances', () => {
    describe('Good paths', () => {
      it('should return expected values', async() => {
        const assets = [dai, tetu, usdc, usdt];
        const balances: BigNumber[] = [];
        for (let i = 0; i < assets.length; ++i) {
          balances.push(parseUnits((i + 1).toString(), await assets[i].decimals()));
          await assets[i].mint(facade.address, balances[i]);
        }

        const r: BigNumber[] = await facade.getAvailableBalances(assets.map(x => x.address), 2);
        const ret = r.map(x => BalanceUtils.toString(x)).join();
        const expected = [
          parseUnits('1', await dai.decimals()),
          parseUnits('2', await tetu.decimals()),
          0, // balance is not calculated for the main asset
          parseUnits('4', await usdt.decimals()),
        ].map(x => BalanceUtils.toString(x)).join();

        expect(ret).eq(expected);
      });
    });
  });

  describe('calcInvestedAssets', () => {
    interface ICalcInvestedAssetsParams {
      tokens: MockToken[];
      amountsOut?: string[];
      indexAsset: number;
      balances?: string[];
      prices: string[];
      debts?: {
        borrowAsset: MockToken;
        debtAmount: string;
        collateralAmount: string;
        /** We need if for reverse debts. Byt default it's equal to underlying */
        collateralAsset?: MockToken;
      }[];
    }

    interface ICalcInvestedAssetsResults {
      amountOut: number;
      gasUsed: BigNumber;
    }

    async function makeCalcInvestedAssetsTest(params: ICalcInvestedAssetsParams): Promise<ICalcInvestedAssetsResults> {
      const decimals = await Promise.all(
        params.tokens.map(
          async x => x.decimals(),
        ),
      );
      if (params.balances) {
        for (let i = 0; i < params.tokens.length; ++i) {
          await params.tokens[i].mint(facade.address, parseUnits(params.balances[i], decimals[i]));
        }
      }
      const tc = await MockHelper.createMockTetuConverter(signer);
      if (params.debts) {
        for (const item of params.debts) {
          const collateralAsset = (item.collateralAsset ?? params.tokens[params.indexAsset]);
          await tc.setGetDebtAmountCurrent(
            facade.address,
            collateralAsset.address,
            item.borrowAsset.address,
            parseUnits(item.debtAmount, await item.borrowAsset.decimals()),
            parseUnits(item.collateralAmount, await collateralAsset.decimals()),
            false,
            false
          );
        }
      }
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        params.tokens.map(x => x.address),
        params.prices.map(x => parseUnits(x, 18)),
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await tc.setController(controller.address);

      const amountOut = await facade.callStatic.calcInvestedAssets(
        params.tokens.map(x => x.address),
        params.amountsOut
          ? params.amountsOut.map((x, index) => parseUnits(x, decimals[index]))
          : params.tokens.map(x => BigNumber.from(0)),
        params.indexAsset,
        tc.address,
      );
      console.log('amountOut', amountOut);

      const gasUsed = await facade.estimateGas.calcInvestedAssets(
        params.tokens.map(x => x.address),
        params.amountsOut || params.tokens.map(x => BigNumber.from(0)),
        params.indexAsset,
        tc.address,
      );

      return {
        amountOut: +formatUnits(amountOut, decimals[params.indexAsset]),
        gasUsed,
      };
    }

    describe('Good paths', () => {
      describe('All amounts are located on the strategy balance only (liquidity is zero)', () => {
        describe('No debts', () => {
          it('should return expected values', async() => {
            const ret = (await makeCalcInvestedAssetsTest({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ['100', '1987', '300'],
              prices: ['20', '10', '60'],
            })).amountOut;
            const expected = 100 * 20 / 10 + 300 * 60 / 10;

            expect(ret).eq(expected);
          });
        });
        describe("Direct debts only", () => {
          describe('There is a debt', () => {
            describe('Amount to repay == amount of the debt', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['117', '1987', '300'],
                  prices: ['20', '10', '60'],
                  debts: [
                    {
                      debtAmount: '117',
                      collateralAmount: '1500',
                      borrowAsset: dai,
                    },
                  ],
                })).amountOut;
                const expected = 1500 + 300 * 60 / 10;

                expect(ret).eq(expected);
              });
            });
            describe('Amount to repay > amount of the debt', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['117', '1987', '300'],
                  prices: ['20', '10', '60'],
                  debts: [
                    {
                      debtAmount: '17',
                      collateralAmount: '500',
                      borrowAsset: dai,
                    },
                  ],
                })).amountOut;
                const expected = 500 + (117 - 17) * 20 / 10 + 300 * 60 / 10;

                expect(ret).eq(expected);
              });
            });
            describe('Amount to repay < amount of the debt, the repayment is profitable', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['117', '1987', '300'],
                  prices: ['20', '10', '60'],
                  debts: [
                    {
                      debtAmount: '217',
                      collateralAmount: '500',
                      borrowAsset: dai,
                    },
                  ],
                })).amountOut;
                const availableMainAsset = 300 * 60 / 10;
                const amountToPayTheDebt = (217 - 117) * 20 / 10;
                const expected = availableMainAsset + 500 - amountToPayTheDebt;

                expect(ret).eq(expected);
              });
            });
            describe('Amount to repay < amount of the debt, the repayment is NOT profitable', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['117', '1987', '300'],
                  prices: ['20', '10', '60'],
                  debts: [
                    {
                      debtAmount: '5117',
                      collateralAmount: '500',
                      borrowAsset: dai,
                    },
                  ],
                })).amountOut;
                const availableMainAsset = 300 * 60 / 10;
                const amountToPayTheDebt = (5117 - 117) * 20 / 10;
                const expected = 0; // amountToPayTheDebt > availableMainAsset + 500 (collateral)

                expect(ret).eq(expected);
              });
            });
          });
          describe('There are two debts', () => {
            /**
             * Fix coverage for calcInvestedAssets:
             * else part for "if (v.debts.length == 0)"
             */
            describe('Amount to repay < total amount of the debts', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['116', '1987', '299'],
                  prices: ['20', '10', '60'],
                  debts: [{
                    debtAmount: '117',
                    collateralAmount: '500',
                    borrowAsset: dai,
                  }, {
                    debtAmount: '300',
                    collateralAmount: '700',
                    borrowAsset: usdt,
                  }],
                })).amountOut;
                const expected = 495 + 697; // 116*500/117 = 495, 299*700/300 = 697

                expect(ret).eq(expected);
              });
            });
          });
        });
        describe("Reverse debts only", () => {
          describe('Single reverse debt', () => {
            it('should return expected values', async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                balances: ['200', '1987', '300'],
                prices: ['20', '10', '60'],
                debts: [
                  {
                    debtAmount: '800',
                    collateralAmount: '1100',
                    borrowAsset: usdc,
                    collateralAsset: dai
                  },
                ],
              })).amountOut;

              expect(ret).eq((1100 + 200) * 20 / 10 + 300 * 60 / 10 - 800);
            });
          });
          describe('Two reverse debts', () => {
            it('should return expected values', async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                balances: ['116', '1987', '299'],
                prices: ['20', '10', '60'],
                debts: [{
                  debtAmount: '117',
                  collateralAmount: '500',
                  borrowAsset: usdc,
                  collateralAsset: dai,
                }, {
                  debtAmount: '300',
                  collateralAmount: '700',
                  borrowAsset: usdc,
                  collateralAsset: usdt
                }],
              })).amountOut;

              expect(ret).eq((500 + 116) * 20 / 10 + (299 + 700) * 60 / 10 - 300 - 117);
            });
          });
          describe('There are reverse and direct debts at the same time (incorrect situation that should be avoided)', () => {
            it('should return expected values', async () => {
              const ret = (await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                balances: ['116', '1987', '299'],
                prices: ['20', '10', '60'],
                debts: [{ // reverse debt
                  debtAmount: '117',
                  collateralAmount: '500',
                  borrowAsset: usdc,
                  collateralAsset: dai,
                }, { // direct debt
                  debtAmount: '600',
                  collateralAmount: '990',
                  borrowAsset: dai,
                }],
              })).amountOut;

              expect(ret).eq((500 + 116 - 600) * 20 / 10 + 299 * 60 / 10 - 117 + 990);
            });
          });
        });
      });
      describe('All amounts are deposited to the pool', () => {
        it('should return expected values', async() => {
          const ret = (await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            amountsOut: ['100', '200', '300'],
            balances: ['0', '0', '0'],
            prices: ['20', '10', '60'],
          })).amountOut;
          const expected = 200 + 100 * 20 / 10 + 300 * 60 / 10;

          expect(ret).eq(expected);
        });
      });
      describe('Amount to repay < amount available in the pool+balance', () => {
        it('should return expected values', async() => {
          const ret = (await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            balances: ['100', '1987', '300'],
            amountsOut: ['700', '1000', '400'],
            prices: ['20', '10', '60'],
            debts: [
              {
                debtAmount: '200',
                collateralAmount: '1501',
                borrowAsset: dai,
              },
            ],
          })).amountOut;
          const amountToPayTheDebt = 200 * 20 / 10;
          const availableMainAsset = 1000 + (300 + 400) * 60 / 10 + (700 + 100) * 20 / 10;
          const expected = availableMainAsset + 1501 - amountToPayTheDebt;

          expect(ret).eq(expected);
        });
      });
      describe('Amount to repay >= amount available in the pool+balance', () => {
        it('should return expected values', async() => {
          const ret = (await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            balances: ['100', '1987', '300'],
            amountsOut: ['700', '1000', '400'],
            prices: ['20', '10', '60'],
            debts: [
              {
                debtAmount: '900',
                collateralAmount: '1501',
                borrowAsset: dai,
              },
            ],
          })).amountOut;
          const amountToPayTheDebt = 900 * 20 / 10;
          const availableMainAsset = 1000 + (300 + 400) * 60 / 10 + (700 + 100) * 20 / 10;
          const expected = availableMainAsset + 1501 - amountToPayTheDebt;

          expect(ret).eq(expected);
        });
      });
    });
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limits, no debts', async() => {
        const r = await makeCalcInvestedAssetsTest({
          tokens: [dai, usdc, usdt],
          indexAsset: 1,
          balances: ['100', '1987', '300'],
          prices: ['20', '10', '60'],
        });

        controlGasLimitsEx(r.gasUsed, GAS_CALC_INVESTED_ASSETS_NO_DEBTS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
      it('should not exceed gas limits, debt exists', async() => {
        const r = await makeCalcInvestedAssetsTest({
          tokens: [dai, usdc, usdt],
          indexAsset: 1,
          balances: ['100', '1987', '300'],
          amountsOut: ['700', '1000', '400'],
          prices: ['20', '10', '60'],
          debts: [
            {
              debtAmount: '200',
              collateralAmount: '1501',
              borrowAsset: dai,
            },
          ],
        });
        controlGasLimitsEx(r.gasUsed, GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });
  //endregion Unit tests
});
