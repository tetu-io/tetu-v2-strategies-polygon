import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  ControllerV2__factory,
  IController,
  IERC20Metadata__factory,
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
import { BalanceUtils } from '../../baseUT/utils/BalanceUtils';
import { expect } from 'chai';
import { controlGasLimitsEx } from '../../../scripts/utils/GasLimitUtils';
import {
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST,
} from "../../baseUT/GasLimits";
import {Misc} from "../../../scripts/utils/Misc";
import {UniversalTestUtils} from "../../baseUT/utils/UniversalTestUtils";
import {setupIsConversionValid, setupMockedLiquidation} from "../../baseUT/mocks/MockLiquidationUtils";
import {ILiquidationParams, IQuoteRepayParams, IRepayParams, ITokenAmount} from "../../baseUT/mocks/TestDataTypes";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";

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

  describe("_makeRequestedAmount", () => {
    interface IMakeRequestedAmountResults {
      expectedAmountMainAssetInc: number;
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

      // set up repay
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
        parseUnits(p.requestedAmount, decimals[p.indexAsset])
      );

      const tx = await strategy._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.amountsToConvert.map((x, index) => parseUnits(p.amountsToConvert[index], decimals[index])),
        tetuConverter.address,
        parseUnits(p.requestedAmount, decimals[p.indexAsset])
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedAmountMainAssetInc: +formatUnits(ret, decimals[p.indexAsset]),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(strategy.address), decimals[index])
          )
        )
      }
    }

    describe("Good paths", () => {
      describe("Amounts to convert are zero", () => {
        describe("Partial repayment, balance > toSell", () => {
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
              balances: ["2000", "910"], // usdc, dai
              amountsToConvert: ["0", "0"], // usdc, dai
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
                amountRepay: "1010",
                collateralAmountOut: "1515"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "1010", // dai
                collateralAmountOut: "1515", // 1010 / 2000 * 3000
                totalDebtAmountOut: "2000",
                totalCollateralAmountOut: "3000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAssetInc).eq(505); // 1515 - 1010
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([2505, 910].join());
          });
        });
      });
      describe("One amount to convert is not zero", () => {
        describe("Get as much as possible", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          /**
           * Convert usdt => usdc
           * Swap all usdc to dai
           * repay dai
           * get collateral back
           */
          async function makeRequestedAmountFixture(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmountTest({
              requestedAmount: "100000000000000", // usdc, we need to get as much as possible
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["2000", "0", "3000"], // usdc, dai, usdt
              amountsToConvert: ["0", "0", "3000"], // usdc, dai, usdt
              prices: ["1", "1", "1"], // for simplicity
              liquidationThresholds: ["0", "0", "0"],
              liquidations: [
                {amountIn: "3000", amountOut: "2900", tokenIn: usdt, tokenOut: usdc},
                {amountIn: "4900", amountOut: "4905", tokenIn: usdc, tokenOut: dai},
              ],
              quoteRepays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "4905",
                collateralAmountOut: "7350"
              }],
              repays: [{
                collateralAsset: usdc,
                borrowAsset: dai,
                amountRepay: "4905", // dai
                collateralAmountOut: "7357.5", // usdc
                totalDebtAmountOut: "20000",
                totalCollateralAmountOut: "30000"
              }],
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAssetInc).eq(2450); // 7350 - 2000 - 2900 = 2450
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([7357.5, 0, 0].join());
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
