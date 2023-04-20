import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  ControllerV2__factory,
  IController,
  IStrategyV2,
  MockConverterStrategy,
  MockConverterStrategy__factory,
  MockForwarder,
  MockTetuConverter,
  MockTetuConverterController,
  MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock,
  StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2,
} from '../../../typechain';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../scripts/utils/TimeUtils';
import { MockHelper } from '../../baseUT/helpers/MockHelper';
import { DeployerUtils } from '../../../scripts/utils/DeployerUtils';
import { DeployerUtilsLocal } from '../../../scripts/utils/DeployerUtilsLocal';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { BigNumber } from 'ethers';
import { expect } from 'chai';
import {Misc} from "../../../scripts/utils/Misc";
import {setupIsConversionValid, setupMockedLiquidation} from "../../baseUT/mocks/MockLiquidationUtils";
import {ILiquidationParams, IQuoteRepayParams, IRepayParams, ITokenAmount} from "../../baseUT/mocks/TestDataTypes";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedQuoteRepay, setupMockedRepay, setupPrices} from "../../baseUT/mocks/MockRepayUtils";

/**
 * Test of ConverterStrategyBase
 * using direct access to internal functions
 * through MockConverterStrategy
 * (fixtures-approach)
 */
describe('ConverterStrategyBaseAccessFixTest', () => {
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let bal: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let strategy: MockConverterStrategy;
  let controller: IController;
  let vault: TetuVaultV2;
  let splitter: StrategySplitterV2;
  let tetuConverter: MockTetuConverter;
  let priceOracle: PriceOracleMock;
  let tetuConverterController: MockTetuConverterController;
  let depositorTokens: MockToken[];
  let depositorWeights: number[];
  let depositorReserves: BigNumber[];
  let indexAsset: number;
  let liquidator: MockTetuLiquidatorSingleCall;
  let forwarder: MockForwarder;
  //endregion Variables

  //region before, after
  before(async function() {
    [signer] = await ethers.getSigners();

    const governance = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    bal = await DeployerUtils.deployMockToken(signer, 'BAL');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);

    // Set up strategy
    depositorTokens = [dai, usdc, usdt];
    indexAsset = depositorTokens.findIndex(x => x.address === usdc.address);
    depositorWeights = [1, 1, 1];
    depositorReserves = [
      parseUnits('1000', 18), // dai
      parseUnits('1000', 6),  // usdc
      parseUnits('1000', 6),   // usdt
    ];

    controller = await DeployerUtilsLocal.getController(signer);
    tetuConverter = await MockHelper.createMockTetuConverter(signer);
    const strategyDeployer = async(_splitterAddress: string) => {
      const strategyLocal = MockConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'MockConverterStrategy'), governance);

      await strategyLocal.init(
        controller.address,
        _splitterAddress,
        tetuConverter.address,
        depositorTokens.map(x => x.address),
        depositorWeights,
        depositorReserves,
      );

      return strategyLocal as unknown as IStrategyV2;
    };

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      usdc.address,
      'test',
      strategyDeployer,
      controller,
      governance,
      0, 100, 100,
      false,
    );

    vault = data.vault.connect(signer);
    const splitterAddress = await vault.splitter();
    splitter = await StrategySplitterV2__factory.connect(splitterAddress, signer);
    strategy = data.strategy as unknown as MockConverterStrategy;

    // set up TetuConverter
    priceOracle = (await DeployerUtils.deployContract(
      signer,
      'PriceOracleMock',
      [usdc.address, dai.address, usdt.address],
      [parseUnits('1', 18), parseUnits('1', 18), parseUnits('1', 18)],
    )) as PriceOracleMock;
    tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
    await tetuConverter.setController(tetuConverterController.address);

    // set up mock liquidator and mock forwarder
    liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
    forwarder = await MockHelper.createMockForwarder(signer);
    const controllerGov = ControllerV2__factory.connect(controller.address, governance);
    const _LIQUIDATOR = 4;
    const _FORWARDER = 5;
    await controllerGov.announceAddressChange(_LIQUIDATOR, liquidator.address);
    await controllerGov.announceAddressChange(_FORWARDER, forwarder.address);
    await TimeUtils.advanceBlocksOnTs(86400); // 1 day
    await controllerGov.changeAddress(_LIQUIDATOR);
    await controllerGov.changeAddress(_FORWARDER);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  //endregion before, after

  //region Unit tests
  describe("requirePayAmountBack", () => {
    interface IRequirePayAmountBackTestResults {
      amountOut: number;
      converterUsdcBalances: number[]; // depositorTokens = [dai, usdc, usdt];
      strategyUsdcBalances: number[]; // depositorTokens = [dai, usdc, usdt];
    }

    interface IPrepareWithdrawParams {
      investedAssetsBeforeWithdraw: BigNumber;
      liquidations?: ILiquidationParams[];
      initialBalances?: ITokenAmount[];
      repayments?: IRepayParams[];
    }

    async function prepareWithdraw(
      depositorLiquidity: BigNumber,
      depositorPoolReserves: BigNumber[],
      depositorTotalSupply: BigNumber,
      withdrawnAmounts: BigNumber[],
      params?: IPrepareWithdrawParams
    ) {
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(strategy.address, tokenAmount.amount);
        }
      }
      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          await setupMockedLiquidation(liquidator, liquidation);
          await setupIsConversionValid(tetuConverter, liquidation, true);
        }
      }
      if (params?.repayments) {
        for (const repayment of params.repayments) {
          await setupMockedRepay(tetuConverter, strategy.address, repayment);
        }
      }

      await strategy.setDepositorLiquidity(depositorLiquidity);
      console.log("setDepositorLiquidity", depositorLiquidity);
      await strategy.setDepositorPoolReserves(depositorPoolReserves);
      await strategy.setTotalSupply(depositorTotalSupply);

      await strategy.setDepositorExit(depositorLiquidity, withdrawnAmounts);
      await strategy.setDepositorQuoteExit(depositorLiquidity, withdrawnAmounts);

      // _updateInvestedAssets is called at the end of requirePayAmountBack when the liquidity is 0
      await strategy.setDepositorQuoteExit(0, withdrawnAmounts);
    }

    async function getResults(amountOut: BigNumber): Promise<IRequirePayAmountBackTestResults> {
      return {
        amountOut: +formatUnits(amountOut, await usdc.decimals()),
        converterUsdcBalances: await Promise.all(
          depositorTokens.map(
            async token => +formatUnits(await token.balanceOf(tetuConverter.address), await token.decimals()),
          )
        ),
        strategyUsdcBalances: await Promise.all(
          depositorTokens.map(
            async token=> +formatUnits(await token.balanceOf(strategy.address), await token.decimals()),
          )
        ),
      }
    }

    describe("Good paths", () => {
      describe("There is enough asset on the balance", () => {
        let snapshot: string;
        before(async function () { snapshot = await TimeUtils.snapshot(); });
        after(async function () { await TimeUtils.rollback(snapshot); });

        async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
          await usdc.mint(strategy.address, parseUnits("100", 6));
          const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));
          await strategy.setDepositorQuoteExit(0, [0, 0, 0]);
          const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("99", 6));
          await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("99", 6));
          return getResults(amountOut);
        }

        it("should return expected amount", async () => {
          const r = await loadFixture(makeRequirePayAmountBackTest);
          expect(r.amountOut).eq(99);
        });
        it("should set expected balance of USDC in converter", async () => {
          const r = await loadFixture(makeRequirePayAmountBackTest);
          expect(r.converterUsdcBalances[1]).eq(99);
        });
        it("should set expected balance of USDC in strategy", async () => {
          const r = await loadFixture(makeRequirePayAmountBackTest);
          expect(r.strategyUsdcBalances[1]).eq(1);
        });
      });

      describe("There is NOT enough asset on the balance", () => {
        describe("Liquidity > 0", () => {
          describe("Withdrawn asset + balance >= required amount", () => {
            let snapshot: string;
            before(async function () { snapshot = await TimeUtils.snapshot(); });
            after(async function () { await TimeUtils.rollback(snapshot); });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));

              await prepareWithdraw(
                parseUnits("6", 6), // total liquidity of the user
                [
                  parseUnits("1000", 18), // dai
                  parseUnits("2000", 6), // usdc
                  parseUnits("3000", 6), // usdt
                ],
                parseUnits("6000", 6), // total supply
                [
                  parseUnits("0.505", 18),
                  parseUnits("17", 6),
                  parseUnits("1.515", 6),
                ],
                {
                  investedAssetsBeforeWithdraw: BigNumber.from(3927000000), // total invested amount, value from calcInvestedAmount()
                  initialBalances: [
                    {token: dai, amount: parseUnits("0", 18)},
                    {token: usdc, amount: parseUnits("1000", 6)},
                    {token: usdt, amount: parseUnits("0", 6)},
                  ],
                  repayments: [
                    // {
                    //   collateralAsset: usdc,
                    //   borrowAsset: dai,
                    //   totalDebtAmountOut: parseUnits("0.505", 18),
                    //   amountRepay: parseUnits("0.505", 18),
                    //   totalCollateralAmountOut: parseUnits("1980", 6),
                    // },
                    // {
                    //   collateralAsset: usdc,
                    //   borrowAsset: usdt,
                    //   totalDebtAmountOut: parseUnits("1.515", 6),
                    //   amountRepay: parseUnits("1.515", 6),
                    //   totalCollateralAmountOut: parseUnits("1930", 6),
                    // },
                  ]
                }
              )

              const amountOut= await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("1003", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("1003", 6));

              return getResults(amountOut);
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(1003);
            });
            it("should set expected balance of USDC in converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterUsdcBalances[1]).eq(1003);
            });
            it("should set expected balances in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyUsdcBalances.join()).eq([0.505, 14, 1.515].join()); // 1000 + 17 - 1003 = 14
            });
          });
          describe("Withdrawn underlying + balance < required amount", () => {
            let snapshot: string;
            before(async function () { snapshot = await TimeUtils.snapshot(); });
            after(async function () { await TimeUtils.rollback(snapshot); });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));

              await prepareWithdraw(
                parseUnits("6", 6), // total liquidity of the user
                [
                  parseUnits("1000", 18), // dai
                  parseUnits("2000", 6), // usdc
                  parseUnits("3000", 6), // usdt
                ],
                parseUnits("6000", 6), // total supply
                [
                  parseUnits("1.505", 18),
                  parseUnits("17", 6),
                  parseUnits("1.515", 6),
                ],
                {
                  investedAssetsBeforeWithdraw: BigNumber.from(3927000000), // total invested amount, value from calcInvestedAmount()
                  initialBalances: [
                    {token: dai, amount: parseUnits("0", 18)},
                    {token: usdc, amount: parseUnits("1000", 6)},
                    {token: usdt, amount: parseUnits("0", 6)},
                  ],
                  liquidations: [
                    {
                      amountIn: "1.006", // assume that all prices are 1 and overswap is 300+300=600
                      amountOut: "5", // assume that all prices are 1
                      tokenIn: dai,
                      tokenOut: usdc
                    },
                  ],
                }
              )

              const amountOut= await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("1018", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("1018", 6));

              return getResults(amountOut);
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(1018);
            });
            it("should set expected balance of USDC in converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterUsdcBalances[1]).eq(1018);
            });
            it("should set expected balances in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyUsdcBalances.join()).eq([0.499, 4, 1.515].join()); // dai, usdc, usdt; 1.505 - 1.006 = 0.499
            });
          });
        });
        describe("Liquidity == 0", () => {
          describe("Total amount is enough", () => {
            let snapshot: string;
            before(async function () { snapshot = await TimeUtils.snapshot(); });
            after(async function () { await TimeUtils.rollback(snapshot); });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));

              await prepareWithdraw(
                parseUnits("0", 6), // user has NOT liquidity in the pool
                [
                  parseUnits("1000", 18), // dai
                  parseUnits("2000", 6), // usdc
                  parseUnits("3000", 6), // usdt
                ],
                parseUnits("6000", 6), // total supply
                [
                  parseUnits("0.505", 18),
                  parseUnits("17", 6),
                  parseUnits("1.515", 6),
                ],
                {
                  investedAssetsBeforeWithdraw: BigNumber.from(3927000000),
                  initialBalances: [
                    {token: dai, amount: parseUnits("0", 18)},
                    {token: usdc, amount: parseUnits("1000", 6)},
                    {token: usdt, amount: parseUnits("1000", 6)},
                  ],
                  liquidations: [
                    {
                      amountIn: "1000",
                      amountOut: "1005",
                      tokenIn: usdt,
                      tokenOut: usdc
                    },
                  ],
                }
              );

              const amountOut= await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("2000", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("2000", 6));

              return getResults(amountOut);
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(2000);
            });
            it("should set expected balance of USDC in converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterUsdcBalances[1]).eq(2000);
            });
            it("should set expected balances in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyUsdcBalances.join()).eq([0, 5, 0].join()); // dai, usdc, usdt
            });
          });
          describe("Total amount is NOT enough", () => {
            let snapshot: string;
            before(async function () { snapshot = await TimeUtils.snapshot(); });
            after(async function () { await TimeUtils.rollback(snapshot); });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));

              await prepareWithdraw(
                parseUnits("0", 6), // user has NOT liquidity in the pool
                [
                  parseUnits("1000", 18), // dai
                  parseUnits("2000", 6), // usdc
                  parseUnits("3000", 6), // usdt
                ],
                parseUnits("6000", 6), // total supply
                [
                  parseUnits("0.505", 18),
                  parseUnits("17", 6),
                  parseUnits("1.515", 6),
                ],
                {
                  investedAssetsBeforeWithdraw: BigNumber.from(3927000000),
                  initialBalances: [
                    {token: dai, amount: parseUnits("0", 18)},
                    {token: usdc, amount: parseUnits("1000", 6)},
                    {token: usdt, amount: parseUnits("500", 6)},
                  ],
                  liquidations: [
                    {
                      amountIn: "500",
                      amountOut: "505",
                      tokenIn: usdt,
                      tokenOut: usdc
                    },
                  ],
                }
              );

              const amountOut= await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("2000", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("2000", 6));

              return getResults(amountOut);
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(1505);
            });
            it("should set expected balance of USDC in converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterUsdcBalances[1]).eq(1505);
            });
            it("should set expected balances in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyUsdcBalances.join()).eq([0, 0, 0].join()); // dai, usdc, usdt
            });
          });
        });
      });
    });
    describe('Bad paths', () => {
      let snapshot: string;
      beforeEach(async function () { snapshot = await TimeUtils.snapshot(); });
      afterEach(async function () { await TimeUtils.rollback(snapshot); });

      it('should revert if not tetu converter', async() => {
        await usdc.mint(strategy.address, parseUnits('100', 6));
        const strategyAsNotTC = strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address));
        await expect(
          strategyAsNotTC.requirePayAmountBack(
            usdc.address,
            parseUnits("99", 6)
          )
        ).revertedWith("SB: Denied"); // DENIED
      });
      it('should revert if wrong asset', async() => {
        await usdc.mint(strategy.address, parseUnits('100', 6));
        const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));
        await expect(
          strategyAsTC.requirePayAmountBack(
            weth.address, // (!) wrong asset, not registered in the depositor
            parseUnits("99", 18),
          )
        ).revertedWith("SB: Wrong value"); // StrategyLib.WRONG_VALUE
      });

    });
  });

  /**
   * We need to take amount R.
   * There are following sources of the amount:
   *      Balance       Pool        Debts in converter
   * Balances of secondary assets can be converted to main asset by closing debts (if any) or by direct swap.
   *
   * Assume, that we need to get amount R, let X > R, y < R
   * Simplifying, we have at least following cases:
   *     Balance       Pool        Debts in converter
   * 1.      X           any                any
   * 2.      y            X                 any
   * 3.      y1          y2               (y2=>y3) (y1 + y3 > X)  expectedAmount > requestedAmount * 101/100
   * 3.1     y1          y2               (y2=>y3) (y1 + y3 > X)  requestedAmount < expectedAmount < requestedAmount * 101/100
   * 4.      y            y                  X     (2 * y < X)
   * 5.      y            y              no debts  (2 * y > X)
   * 6.      y            y              no debts  (2 * y < X)
   * 7.      y            y                  y     (3 * y > X)
   * 8.      y            y                  y     (3 * y < X)
   * 9.      y            y1                 y2    (full debt repay amount < y1 + y2, but y + y1 + y2 > X)
   * 9.      y            y1                 y2    (full debt repay amount < y1 + y2, no leftovers)
   */
  describe("_makeRequestedAmount", () => {
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
      amountsToConvert: string[];
      prices: string[];
      liquidationThresholds: string[];
      liquidations: ILiquidationParams[];
      quoteRepays: IQuoteRepayParams[];
      repays: IRepayParams[];
      isConversionValid?: boolean;
      expectedMainAssetAmounts: string[];
    }
    async function makeRequestedAmountTest(
      p: IMakeRequestedAmountParams
    ) : Promise<IMakeRequestedAmountResults> {
      // set up balances
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);

        // set up current balances
        await p.tokens[i].mint(strategy.address, parseUnits(p.balances[i], d));
        console.log("mint", i, p.balances[i]);

        // set up liquidation threshold for token
        await strategy.setLiquidationThreshold(p.tokens[i].address, parseUnits(p.liquidationThresholds[i], d));
      }

      // set up price oracle
      await setupPrices(priceOracle, p.tokens, p.prices);

      // set up repay and quoteRepay in converter
      for (const repay of p.repays) {
        await setupMockedRepay(tetuConverter, strategy.address, repay);
      }
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(tetuConverter, strategy.address, quoteRepay);
      }

      // set up expected liquidations
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
        const isConversionValid = p.isConversionValid === undefined ? true : p.isConversionValid;
        await setupIsConversionValid(tetuConverter, liquidation, isConversionValid)
      }

      // make test
      const ret = await strategy.callStatic._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.amountsToConvert.map((x, index) => parseUnits(p.amountsToConvert[index], decimals[index])),
        tetuConverter.address,
        parseUnits(p.requestedAmount, decimals[p.indexAsset]),
        p.expectedMainAssetAmounts.map((x, index)=> parseUnits(p.expectedMainAssetAmounts[index], decimals[p.indexAsset])),
      );

      const tx = await strategy._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.amountsToConvert.map((x, index) => parseUnits(p.amountsToConvert[index], decimals[index])),
        tetuConverter.address,
        parseUnits(p.requestedAmount, decimals[p.indexAsset]),
        p.expectedMainAssetAmounts.map((x, index)=> parseUnits(p.expectedMainAssetAmounts[index], decimals[p.indexAsset])),
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedAmountMainAsset: +formatUnits(ret, decimals[p.indexAsset]),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(strategy.address), decimals[index])
          )
        )
      }
    }

    describe("Good paths", () => {
      describe("two assets, same prices", () => {
        describe("1. Requested amount is already on balance, Balance=X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2500", // usdc
              tokens: [usdc, dai],
              indexAsset: 0,
              balances: ["2500", "0"], // usdc, dai
              amountsToConvert: ["0", "0"], // usdc, dai
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [],
              quoteRepays: [],
              repays: [],
              expectedMainAssetAmounts: ["0", "0"],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(0);
          });
          it("should provide requested amount on balance", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2500, 0].join());
          });
        });
        describe("2. Withdraw requested amount, Balance=y, Pool=X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2500", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["107", "2000"], // usdc, usdt
              amountsToConvert: ["100", "2000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "2000",
                collateralAmountOut: "4000",
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "2000", // usdt
                collateralAmountOut: "4000", // usdc
                totalDebtAmountOut: "400000",
                totalCollateralAmountOut: "800000"
              }],
              expectedMainAssetAmounts: ["100", "3999"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(4099); // 3999+100
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([4107, 0].join()); // 4000 + 1000
          });
        });
        describe("3. Balance=y1, Pool=y2, Debt=(y2=>y3), y1+y3>X, use convertAfterWithdraw", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1004", "2000"], // usdc, usdt
              amountsToConvert: ["1000", "1100"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "1100",
                collateralAmountOut: "1102"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "1100", // usdt
                collateralAmountOut: "1102", // usdc
                totalDebtAmountOut: "1100",
                totalCollateralAmountOut: "1102"
              }],
              expectedMainAssetAmounts: ["1000", "1101"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(2101);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2106, 900].join());
          });
        });
        describe("3.1. Balance=y1, Pool=y2, Debt=(y2=>y3), y1+y3>X, use closePositionsToGetAmount", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "1000"], // usdc, usdt
              amountsToConvert: ["1000", "1000"], // usdc, usdt
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
              expectedMainAssetAmounts: ["1000", "1000"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(2050);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2050, 0].join());
          });
        });
        describe("4. Debt provides requested amount, all balance is sold, Balance=y, Pool=y, Debt=X, 2*y < X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "10000", // usdc, we need to get as much as possible
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["6000", "999"], // usdc, usdt
              amountsToConvert: ["6000", "999"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "4040", amountOut: "4041", tokenIn: usdc, tokenOut: usdt},
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
              expectedMainAssetAmounts: ["3000", "1000"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(7080); // 10080 - 6000 + 3000
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([10081, 0].join()); // 10080 - 6000 + 6000
          });
        });
        describe("4.1. Debt provides requested amount, a part of balance is sold, Balance=y, Pool=y, Debt=X, 2*y < X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "10000", // usdc, we need to get as much as possible
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["60000", "999"], // usdc, usdt
              amountsToConvert: ["60000", "999"], // usdc, usdt
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
              expectedMainAssetAmounts: ["3000", "1000"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(14900); // 22000 - 10100 + 3000
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([71901, 0].join()); // 22001 - 10100 + 3000 + 57000
          });
        });
        describe("5. Balance + pool provide requested amount, Balance=y, Pool=y, 2*y > X, swap, use convertAfterWithdraw", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "2000"], // usdc, usdt
              amountsToConvert: ["1000", "1000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{amountIn: "1000", amountOut: "1001", tokenIn: usdt, tokenOut: usdc}],
              quoteRepays: [],
              repays: [],
              expectedMainAssetAmounts: ["1300", "1200"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(2500);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2001, 1000].join());
          });
        });
        describe("5.1 Balance + pool provide requested amount, Balance=y, Pool=y, 2*y > X, swap, use closePositionsToGetAmount", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1004", "1002"], // usdc, usdt
              amountsToConvert: ["1001", "1002"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{amountIn: "1002", amountOut: "1003", tokenIn: usdt, tokenOut: usdc}],
              quoteRepays: [],
              repays: [],
              expectedMainAssetAmounts: ["700", "700"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(1002 + 700);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1004 + 1003, 0].join());
          });
        });
        describe("6. Balance + pool provide requested amount, Balance=y, Pool=y, 2*y < X, swap", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "2000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "103"], // usdc, usdt
              amountsToConvert: ["1000", "103"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [{
                amountIn: "103",
                amountOut: "120",
                tokenIn: usdt,
                tokenOut: usdc
              }],
              quoteRepays: [],
              repays: [],
              expectedMainAssetAmounts: ["1000", "121"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            // 1000 (initial balance) + 103 (103 is converted directly by prices to 103)
            expect(r.expectedAmountMainAsset).eq(1103);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1120, 0].join());
          });
        });
        describe("7. Balance=y, Pool=y, Debt=y, 3*y > X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "8000", // usdc, we need to get as much as possible
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["3001", "2000"], // usdc, usdt
              amountsToConvert: ["3000", "2000"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "3001", amountOut: "4000", tokenIn: usdc, tokenOut: usdt},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: usdt,
                amountRepay: "6000", // 4041 + 999
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
              expectedMainAssetAmounts: ["3000", "2000"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(3000 - 3001 + 12000);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([3001 - 3001 + 12000, 0].join());
          });
        });
        describe("8. Balance=y, Pool=y, Debt=y, 3*y < X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "14000", // usdc, we need to get as much as possible
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["3000", "2000"], // usdc, usdt
              amountsToConvert: ["3000", "2000"], // usdc, usdt
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
              expectedMainAssetAmounts: ["3000", "2000"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(10000); // 3000 - 3000 + 10000
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([10000, 0].join()); // 3000 - 3000 + 10000
          });
        });
        describe("9. Balance=y0, Pool=y1, Debt=y2, y2 is closed by y0 with leftovers", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "200000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["100", "8000"], // usdc, usdt
              amountsToConvert: ["100", "8000"], // usdc, usdt
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
              expectedMainAssetAmounts: ["100", "8000"]
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
        describe("9.1 Balance=y0, Pool=y1, Debt=y2, debt is fully repaid, no leftovers", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "200000", // usdc
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "1500"], // usdc, usdt
              amountsToConvert: ["0", "1500"], // usdc, usdt
              prices: ["1", "1"], // for simplicity
              liquidationThresholds: ["0", "0"],
              liquidations: [
                {amountIn: "500", amountOut: "500", tokenIn: usdc, tokenOut: usdt},
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
              expectedMainAssetAmounts: ["0", "1500"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(4000 - 500);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1000 - 500 + 4000, 0].join());
          });
        });
      });
      describe("three assets, same prices", () => {
        describe("4. Debt provides requested amount, all balance is sold, Balance=y, Pool=y, Debt=X, 2*y < X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "110000", // usdc
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["6000", "2000", "4000"], // usdc, dai, usdt
              amountsToConvert: ["6000", "2000", "4000"], // usdc, dai, usdt
              expectedMainAssetAmounts: ["6000", "2000", "4000"],
              prices: ["1", "1", "1"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              liquidations: [
                {amountIn: "1000", amountOut: "1010", tokenIn: usdc, tokenOut: dai},
                {amountIn: "3000", amountOut: "3030", tokenIn: usdc, tokenOut: usdt},
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
            expect(r.expectedAmountMainAsset).eq(15040); // 6000 + 4000 + 9000 - 1000 - 3000 + 10 + 30
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([15038, 0, 0].join());
          });
        });
        describe("9. Balance=y0, Pool=y1, Debt=y2, y2 is closed by y0 with leftovers", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "200000", // usdc
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ["3000", "97", "5000"], // dai, usdc, usdt
              amountsToConvert: ["3000", "0", "5000"], // dai, usdc, usdt
              expectedMainAssetAmounts: ["3000", "0", "5000"],
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
            expect(r.expectedAmountMainAsset).eq(9800); // 2900 + 1900 + 3000 + 2000
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([0, 9899, 0].join()); // 97 + 2900 + 1900 + 3001 + 2001
          });
        });
      });
      describe("three assets, different prices", () => {
        describe("4. Debt provides requested amount, all balance is sold, Balance=y, Pool=y, Debt=X, 2*y < X", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "110000", // usdc
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["6000", "20000", "400"], // usdc, dai, usdt
              amountsToConvert: ["6000", "20000", "400"], // usdc, dai, usdt
              expectedMainAssetAmounts: ["6000", "20000", "400"],
              prices: ["1", "0.1", "10"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              liquidations: [
                {amountIn: "1000", amountOut: "10100", tokenIn: usdc, tokenOut: dai},
                {amountIn: "3000", amountOut: "303", tokenIn: usdc, tokenOut: usdt},
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
            expect(r.expectedAmountMainAsset).eq(15040); // 6000 + 4000 + 9000 - 1000 - 3000 + 10 + 30
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([15038, 0, 0].join());
          });
        });
        describe("9. Balance=y0, Pool=y1, Debt=y2, y2 is closed by y0 with leftovers", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "200000", // usdc
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ["30000", "97", "500"], // dai, usdc, usdt
              amountsToConvert: ["30000", "0", "500"], // dai, usdc, usdt
              expectedMainAssetAmounts: ["30000", "0", "500"],
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
            expect(r.expectedAmountMainAsset).eq(9800); // 2900 + 1900 + 3000 + 2000
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([0, 9899, 0].join()); // 97 + 2900 + 1900 + 3001 + 2001
          });
        });
      });
    });
    describe("Bad paths", () => {
// todo
    });
  });
  //endregion Unit tests
});
