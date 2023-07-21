import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {
  ControllerV2__factory,
  IController, IERC20Metadata__factory, ISplitter__factory,
  IStrategyV2, ITetuVaultV2__factory,
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
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {MockHelper} from '../../baseUT/helpers/MockHelper';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {DeployerUtilsLocal} from '../../../scripts/utils/DeployerUtilsLocal';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {BigNumber} from 'ethers';
import {expect} from 'chai';
import {Misc} from "../../../scripts/utils/Misc";
import {setupIsConversionValid, setupMockedLiquidation} from "../../baseUT/mocks/MockLiquidationUtils";
import {
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams,
  ITokenAmount,
  ITokenAmountNum
} from "../../baseUT/mocks/TestDataTypes";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedQuoteRepay, setupMockedRepay, setupPrices} from "../../baseUT/mocks/MockRepayUtils";
import {UniversalTestUtils} from "../../baseUT/utils/UniversalTestUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST} from "../../baseUT/GasLimits";

/**
 * Test of ConverterStrategyBase
 * using direct access to internal functions
 * through MockConverterStrategy
 * (fixtures-approach)
 */
describe('ConverterStrategyBaseTest', () => {
  //region Variables
  let snapshotBefore: string;
  let governance: SignerWithAddress;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let bal: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let liquidator: MockTetuLiquidatorSingleCall;
  let forwarder: MockForwarder;
  //endregion Variables

  //region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    governance = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    bal = await DeployerUtils.deployMockToken(signer, 'BAL');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);

    liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
    forwarder = await MockHelper.createMockForwarder(signer);

    console.log("usdc", usdc.address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
  //endregion before, after

  //region Fixtures
  interface IStrategySetupParams {
    depositorTokens?: MockToken[];
    depositorWeights?: number[];
    depositorReserves?: string[];
    underlying?: MockToken;
  }
  interface IStrategySetupResults {
    strategy: MockConverterStrategy;
    controller: IController;
    vault: TetuVaultV2;
    splitter: StrategySplitterV2;
    tetuConverter: MockTetuConverter;
    priceOracle: PriceOracleMock;
    tetuConverterController: MockTetuConverterController;
    depositorTokens: MockToken[];
    depositorWeights: number[];
    depositorReserves: BigNumber[];
    indexAsset: number;
  }

  async function setupMockedStrategy(p?: IStrategySetupParams): Promise<IStrategySetupResults> {
    // Set up strategy
    const depositorTokens = p?.depositorTokens || [dai, usdc, usdt];
    const indexAsset = depositorTokens.findIndex(x => x.address === (p?.underlying?.address || usdc.address));
    const depositorWeights = p?.depositorWeights || [1, 1, 1];
    const depositorReserves = await Promise.all((p?.depositorReserves || ["1000", "1000", "1000"]).map(
      async (x, index) => parseUnits(x, await depositorTokens[index].decimals())
    ));

    const controller = await DeployerUtilsLocal.getController(signer);
    const tetuConverter = await MockHelper.createMockTetuConverter(signer);
    const strategyDeployer = async (_splitterAddress: string) => {
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

    const vault = data.vault.connect(signer);
    const splitterAddress = await vault.splitter();
    const splitter = await StrategySplitterV2__factory.connect(splitterAddress, signer);
    const strategy = data.strategy as unknown as MockConverterStrategy;

    // set up TetuConverter
    const priceOracle = (await DeployerUtils.deployContract(
      signer,
      'PriceOracleMock',
      [usdc.address, dai.address, usdt.address],
      [parseUnits('1', 18), parseUnits('1', 18), parseUnits('1', 18)],
    )) as PriceOracleMock;
    const tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
    await tetuConverter.setController(tetuConverterController.address);

    // set up mock liquidator and mock forwarder
    const controllerGov = ControllerV2__factory.connect(controller.address, governance);
    const _LIQUIDATOR = 4;
    const _FORWARDER = 5;
    await controllerGov.announceAddressChange(_LIQUIDATOR, liquidator.address);
    await controllerGov.announceAddressChange(_FORWARDER, forwarder.address);
    await TimeUtils.advanceBlocksOnTs(86400); // 1 day
    await controllerGov.changeAddress(_LIQUIDATOR);
    await controllerGov.changeAddress(_FORWARDER);

    return {
      strategy,
      controller,
      vault,
      splitter,
      tetuConverter,
      priceOracle,
      tetuConverterController,
      depositorTokens,
      depositorWeights,
      depositorReserves,
      indexAsset,
    }
  }
  //endregion Fixture

  //region Unit tests

  // todo enable after SCB-718
  describe.skip("requirePayAmountBack", () => {
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
      ms: IStrategySetupResults,
      depositorLiquidity: BigNumber,
      depositorPoolReserves: BigNumber[],
      depositorTotalSupply: BigNumber,
      withdrawnAmounts: BigNumber[],
      params?: IPrepareWithdrawParams
    ) {
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(ms.strategy.address, tokenAmount.amount);
        }
      }
      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          await setupMockedLiquidation(liquidator, liquidation);
          await setupIsConversionValid(ms.tetuConverter, liquidation, true);
        }
      }
      if (params?.repayments) {
        for (const repayment of params.repayments) {
          await setupMockedRepay(ms.tetuConverter, ms.strategy.address, repayment);
        }
      }

      await ms.strategy.setDepositorLiquidity(depositorLiquidity);
      console.log("setDepositorLiquidity", depositorLiquidity);
      await ms.strategy.setDepositorPoolReserves(depositorPoolReserves);
      await ms.strategy.setTotalSupply(depositorTotalSupply);

      await ms.strategy.setDepositorExit(depositorLiquidity, withdrawnAmounts);
      await ms.strategy.setDepositorQuoteExit(depositorLiquidity, withdrawnAmounts);

      // _updateInvestedAssets is called at the end of requirePayAmountBack when the liquidity is 0
      await ms.strategy.setDepositorQuoteExit(0, withdrawnAmounts);
    }

    async function getResults(ms: IStrategySetupResults, amountOut: BigNumber): Promise<IRequirePayAmountBackTestResults> {
      return {
        amountOut: +formatUnits(amountOut, await usdc.decimals()),
        converterUsdcBalances: await Promise.all(
          ms.depositorTokens.map(
            async token => +formatUnits(await token.balanceOf(ms.tetuConverter.address), await token.decimals()),
          )
        ),
        strategyUsdcBalances: await Promise.all(
          ms.depositorTokens.map(
            async token => +formatUnits(await token.balanceOf(ms.strategy.address), await token.decimals()),
          )
        ),
      }
    }

    describe("Good paths", () => {
      describe("There is enough asset on the balance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
          const ms = await setupMockedStrategy();
          await usdc.mint(ms.strategy.address, parseUnits("100", 6));
          const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));
          await ms.strategy.setDepositorQuoteExit(0, [0, 0, 0]);
          const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("99", 6));
          await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("99", 6));
          return getResults(ms, amountOut);
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
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const ms = await setupMockedStrategy();
              const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));

              await prepareWithdraw(
                ms,
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

              const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("1003", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("1003", 6));

              return getResults(ms, amountOut);
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
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const ms = await setupMockedStrategy();
              const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));

              await prepareWithdraw(
                ms,
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

              const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("1018", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("1018", 6));

              return getResults(ms, amountOut);
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
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const ms = await setupMockedStrategy();
              const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));

              await prepareWithdraw(
                ms,
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

              const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("2000", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("2000", 6));

              return getResults(ms, amountOut);
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
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
              const ms = await setupMockedStrategy();
              const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));

              await prepareWithdraw(
                ms,
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

              const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("2000", 6));
              await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("2000", 6));

              return getResults(ms, amountOut);
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
      describe("Zero amount", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackTestResults> {
          const ms = await setupMockedStrategy();
          await usdc.mint(ms.strategy.address, parseUnits("100", 6));
          const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));
          await ms.strategy.setDepositorQuoteExit(0, [0, 0, 0]);
          const amountOut = await strategyAsTC.callStatic.requirePayAmountBack(usdc.address, parseUnits("0", 6));
          await strategyAsTC.requirePayAmountBack(usdc.address, parseUnits("0", 6));
          return getResults(ms, amountOut);
        }

        it("should return zero amount", async () => {
          const r = await loadFixture(makeRequirePayAmountBackTest);
          expect(r.amountOut).eq(0);
        });
      });
    });
    describe('Bad paths', () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it('should revert if not tetu converter', async () => {
        const ms = await setupMockedStrategy();
        await usdc.mint(ms.strategy.address, parseUnits('100', 6));
        const strategyAsNotTC = ms.strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address));
        await expect(
          strategyAsNotTC.requirePayAmountBack(
            usdc.address,
            parseUnits("99", 6)
          )
        ).revertedWith("SB: Denied"); // DENIED
      });
      it('should revert if wrong asset', async () => {
        const ms = await setupMockedStrategy();
        await usdc.mint(ms.strategy.address, parseUnits('100', 6));
        const strategyAsTC = ms.strategy.connect(await Misc.impersonate(ms.tetuConverter.address));
        await expect(
          strategyAsTC.requirePayAmountBack(
            weth.address, // (!) wrong asset, not registered in the depositor
            parseUnits("99", 18),
          )
        ).revertedWith("SB: Wrong value"); // StrategyLib.WRONG_VALUE
      });

    });
  });

  describe("onTransferAmounts", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    async function prepareCalcInvestedAssetsMocks(ms: IStrategySetupResults) {
      await ms.strategy.setDepositorLiquidity(0);
      await ms.strategy.setDepositorQuoteExit(0, ms.depositorTokens.map(x => 0));
    }

    describe("Good paths", () => {
      it("should not revert (currently the implementation is empty)", async () => {
        const ms = await setupMockedStrategy();
        await prepareCalcInvestedAssetsMocks(ms);
        const tx = await ms.strategy.connect(
          await Misc.impersonate(ms.tetuConverter.address)
        ).onTransferAmounts([usdc.address, weth.address], [1, 2]);

        const gasUsed = (await tx.wait()).gasUsed;
        expect(gasUsed.gt(0)).eq(true); // not reverted
      });
    });

    describe("Bad paths", () => {
      it("should revert if not tetu converter", async () => {
        const ms = await setupMockedStrategy();
        await prepareCalcInvestedAssetsMocks(ms);
        await expect(
          ms.strategy.connect(
            await Misc.impersonate(ethers.Wallet.createRandom().address)
          ).onTransferAmounts([usdc.address, weth.address], [1, 2])
        ).revertedWith("SB: Denied"); // StrategyLib.DENIED
      });
      it("should revert if arrays have different lengths", async () => {
        const ms = await setupMockedStrategy();
        await prepareCalcInvestedAssetsMocks(ms);
        await expect(
          ms.strategy.connect(
            await Misc.impersonate(ms.tetuConverter.address)
          ).onTransferAmounts([usdc.address, weth.address], [1])
        ).revertedWith("TS-19 lengths"); // INCORRECT_LENGTHS
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
    ): Promise<IMakeRequestedAmountResults> {
      const ms = await setupMockedStrategy();
      // set up balances
      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        const d = await p.tokens[i].decimals()
        decimals.push(d);

        // set up current balances
        await p.tokens[i].mint(ms.strategy.address, parseUnits(p.balances[i], d));
        console.log("mint", i, p.balances[i]);

        // set up liquidation threshold for token
        await ms.strategy.setLiquidationThreshold(p.tokens[i].address, parseUnits(p.liquidationThresholds[i], d));
      }

      // set up price oracle
      await setupPrices(ms.priceOracle, p.tokens, p.prices);

      // set up repay and quoteRepay in converter
      for (const repay of p.repays) {
        await setupMockedRepay(ms.tetuConverter, ms.strategy.address, repay);
      }
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(ms.tetuConverter, ms.strategy.address, quoteRepay);
      }

      // set up expected liquidations
      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
        const isConversionValid = p.isConversionValid === undefined ? true : p.isConversionValid;
        await setupIsConversionValid(ms.tetuConverter, liquidation, isConversionValid)
      }

      // make test
      const ret = await ms.strategy.callStatic._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.amountsToConvert.map((x, index) => parseUnits(p.amountsToConvert[index], decimals[index])),
        ms.tetuConverter.address,
        liquidator.address,
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexAsset]),
        p.expectedMainAssetAmounts.map((x, index) => parseUnits(p.expectedMainAssetAmounts[index], decimals[p.indexAsset])),
      );

      const tx = await ms.strategy._makeRequestedAmountAccess(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.amountsToConvert.map((x, index) => parseUnits(p.amountsToConvert[index], decimals[index])),
        ms.tetuConverter.address,
        liquidator.address,
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexAsset]),
        p.expectedMainAssetAmounts.map((x, index) => parseUnits(p.expectedMainAssetAmounts[index], decimals[p.indexAsset])),
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedAmountMainAsset: +formatUnits(ret, decimals[p.indexAsset]),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(ms.strategy.address), decimals[index])
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
              requestedAmount: "5000", // usdc; it should include current balance
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
              requestedAmount: "2607", // usdc; it should include current balance
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
              requestedAmount: "3000", // usdc; it should include current balance
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
              requestedAmount: "16000", // usdc, we need to get as much as possible; it should include current balance
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
              requestedAmount: "70000", // usdc, we need to get as much as possible; it should include current balance
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
              requestedAmount: "3004", // usdc; it should include current balance
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
              requestedAmount: "3000", // usdc; it should include current balance
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
              requestedAmount: "11001", // usdc, we need to get as much as possible; it should include current balance
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
              requestedAmount: "17000", // usdc, we need to get as much as possible; it should include current balance
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
              requestedAmount: "200100", // usdc; it should include current balance
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
              requestedAmount: "201000", // usdc; it should include current balance
              tokens: [usdc, usdt],
              indexAsset: 0,
              balances: ["1000", "1500"], // usdc, usdt
              amountsToConvert: ["0", "1500"], // usdc, usdt
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
              expectedMainAssetAmounts: ["0", "1500"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.expectedAmountMainAsset).eq(4000 - 505);
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([1000 - 505 + 4000, 0].join());
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
              requestedAmount: "116000", // usdc; it should include current balance
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["6000", "2000", "4000"], // usdc, dai, usdt
              amountsToConvert: ["6000", "2000", "4000"], // usdc, dai, usdt
              expectedMainAssetAmounts: ["6000", "2000", "4000"],
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
            expect(r.expectedAmountMainAsset).eq(15040-40); // 6000 + 4000 + 9000 - 1000 - 3000 + 10 + 30 - 40
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([15038-40, 0, 0].join());
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
              requestedAmount: "203000", // usdc; it should include current balance
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
              requestedAmount: "116000", // usdc; it should include current balance
              tokens: [usdc, dai, usdt],
              indexAsset: 0,
              balances: ["6000", "20000", "400"], // usdc, dai, usdt
              amountsToConvert: ["6000", "20000", "400"], // usdc, dai, usdt
              expectedMainAssetAmounts: ["6000", "20000", "400"],
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
            expect(r.expectedAmountMainAsset).eq(15040-40); // 6000 + 4000 + 9000 - 1000 - 3000 + 10 + 30 - 40
          });
          it("should set expected balances", async () => {
            const r = await loadFixture(makeRequestedAmountFixture);
            expect(r.balances.join()).eq([15038-40, 0, 0].join());
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
              requestedAmount: "203000", // usdc; it should include current balance
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
      describe("requestAmounts == max int", () => {
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
              requestedAmount: "", // Misc.MAX_UINT, // usdc
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
    });
  });

  describe("calcInvestedAssets", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    describe("Good paths", () => {
      it("should return not zero amount", async () => {
        const ms = await setupMockedStrategy();
        // set not zero balances
        for (const token of ms.depositorTokens) {
          await token.mint(ms.strategy.address, 1000);
        }
        await ms.strategy.setDepositorLiquidity(0);
        await ms.strategy.setDepositorQuoteExit(0, ms.depositorTokens.map(x => 0));

        const operator = await UniversalTestUtils.getAnOperator(ms.strategy.address, signer);
        const investedAssets = await ms.strategy.connect(operator).callStatic.calcInvestedAssets();
        expect(investedAssets.gt(0)).eq(true);
      });
    });

    describe("Bad paths", () => {
      it("should revert if not operator", async () => {
        const ms = await setupMockedStrategy();
        // set not zero balances
        for (const token of ms.depositorTokens) {
          await token.mint(ms.strategy.address, 1000);
        }
        await ms.strategy.setDepositorLiquidity(0);
        await ms.strategy.setDepositorQuoteExit(0, ms.depositorTokens.map(x => 0));

        const notOperator = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await expect(
          ms.strategy.connect(notOperator).calcInvestedAssets()
        ).revertedWith("SB: Denied"); // StrategyLib.DENIED
      });
    });
  });

  describe('_doHardWork, doHardwork', () => {
    interface IEarnedLost {
      earned: number;
      lost: number;
    }

    interface IDoHardworkResults extends IEarnedLost {
      investedAssetsBefore: number;
      investedAssetsAfter: number;
      callDoHardwork?: IEarnedLost;
      insuranceBefore: number;
      insuranceAfter: number;
      vaultTotalAssetsBefore: number;
      vaultTotalAssetsAfter: number;
    }

    interface ISetupInvestedAssets {
      depositorLiquidity18: string;
      depositorQuoteExit: {
        liquidityAmount18: string;
        amountsOut: string[];
      }
    }

    interface IDoHardworkParams {
      tokens: MockToken[];
      assetIndex: number;

      setUpInvestedAssetsInitial: ISetupInvestedAssets;
      setUpInvestedAssets: ISetupInvestedAssets;

      handleRewardsResults: {
        earned: string;
        lost: string;
        balanceChange?: string;
      }

      initialBalance: string;
      initialInsuranceBalance?: string;
      balanceChange: string;

      assetProviderBalance: string;
      reInvest?: boolean;
      reinvestThresholdPercent?: number;
      /**
       * undefined - don't call doHardwork()
       * true - make call doHardwork by splitter
       * false - make call doHardwork by random caller
       */
      callDoHardworkBySplitter?: boolean;
      useMockedDepositToPoolUni?: boolean;
    }

    async function makeDoHardwork(p: IDoHardworkParams): Promise<IDoHardworkResults> {
      const ms = await setupMockedStrategy({
        depositorTokens: p.tokens,
        underlying: p.tokens[p.assetIndex],
        depositorReserves: p.tokens.map(x => "1000"),
        depositorWeights: p.tokens.map(x => 1),
      });
      const insurance = await ITetuVaultV2__factory.connect(
        await ISplitter__factory.connect(await ms.strategy.splitter(), signer).vault(),
        signer
      ).insurance();

      const assetDecimals = await Promise.all(p.tokens.map(async token => token.decimals()));
      const assetProvider = ethers.Wallet.createRandom().address;
      await usdc.mint(assetProvider, parseUnits(p.assetProviderBalance, assetDecimals[p.assetIndex]));
      await usdc.connect(await Misc.impersonate(assetProvider)).approve(ms.strategy.address, Misc.MAX_UINT);

      await usdc.mint(ms.strategy.address, parseUnits(p.initialBalance, assetDecimals[p.assetIndex]));
      if (p.initialInsuranceBalance) {
        await usdc.mint(insurance, parseUnits(p.initialInsuranceBalance, assetDecimals[p.assetIndex]));
      }

      const insuranceBefore = await usdc.balanceOf(insurance);
      const vaultBalanceBefore = await usdc.balanceOf(ms.vault.address);

      if (p.reinvestThresholdPercent) {
        await ms.strategy.setReinvestThresholdPercent(p.reinvestThresholdPercent);
      }
      // run updateInvestedAssetsTestAccess first time to set up initial value of _investedAssets
      await ms.strategy.setDepositorLiquidity(parseUnits(p.setUpInvestedAssetsInitial.depositorLiquidity18, 18));
      await ms.strategy.setDepositorQuoteExit(
        parseUnits(p.setUpInvestedAssetsInitial.depositorQuoteExit.liquidityAmount18, 18),
        p.tokens.map((x, index) => parseUnits(
          p.setUpInvestedAssetsInitial.depositorQuoteExit.amountsOut[index], assetDecimals[index])
        )
      );
      await ms.strategy.updateInvestedAssetsTestAccess();
      const investedAssetsBefore = await ms.strategy.investedAssets();
      console.log("investedAssets1", investedAssetsBefore);

      // set up _depositToPoolUni during reinvesting
      if (p.useMockedDepositToPoolUni) {
        await ms.strategy.setMockedDepositToPoolUni(parseUnits(p.balanceChange, 6), assetProvider, 0, 0);
      }

      // set up _updateInvestedAssets in the hardwork
      await ms.strategy.setDepositorLiquidity(parseUnits(p.setUpInvestedAssets.depositorLiquidity18, 18));
      await ms.strategy.setDepositorQuoteExit(
        parseUnits(p.setUpInvestedAssets.depositorQuoteExit.liquidityAmount18, 18),
        p.tokens.map((x, index) => parseUnits(
          p.setUpInvestedAssets.depositorQuoteExit.amountsOut[index], assetDecimals[index])
        )
      );

      // set up handleRewards
      await ms.strategy.setMockedHandleRewardsResults(
        parseUnits(p.handleRewardsResults.earned, assetDecimals[p.assetIndex]),
        parseUnits(p.handleRewardsResults.lost, assetDecimals[p.assetIndex]),
        parseUnits(p.handleRewardsResults.balanceChange || "0", assetDecimals[p.assetIndex]),
        assetProvider,
      );

      const callDoHardwork = p.callDoHardworkBySplitter === undefined
        ? undefined
        : p.callDoHardworkBySplitter
          ? await ms.strategy.connect(await Misc.impersonate(ms.splitter.address)).callStatic.doHardWork()
          : await ms.strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).callStatic.doHardWork();

      const reInvest: boolean = p?.reInvest === undefined ? true : p.reInvest;
      const r = await ms.strategy.callStatic._doHardWorkAccess(reInvest);
      await ms.strategy._doHardWorkAccess(reInvest);


      const insuranceAfter = await usdc.balanceOf(insurance);

      return {
        earned: +formatUnits(r.earned, assetDecimals[p.assetIndex]),
        lost: +formatUnits(r.lost, assetDecimals[p.assetIndex]),
        investedAssetsBefore: +formatUnits(investedAssetsBefore, assetDecimals[p.assetIndex]),
        investedAssetsAfter: +formatUnits(await ms.strategy.investedAssets(), assetDecimals[p.assetIndex]),
        callDoHardwork: callDoHardwork
          ? {
            earned: +formatUnits(callDoHardwork.earned, assetDecimals[p.assetIndex]),
            lost: +formatUnits(callDoHardwork.lost, assetDecimals[p.assetIndex]),
          }
          : undefined,
        insuranceBefore: +formatUnits(insuranceBefore, 6),
        insuranceAfter: +formatUnits(insuranceAfter, 6),
        vaultTotalAssetsBefore:
          +formatUnits(vaultBalanceBefore, assetDecimals[p.assetIndex])
          + +formatUnits(investedAssetsBefore, assetDecimals[p.assetIndex])
          + Number(p.initialBalance),
        vaultTotalAssetsAfter:
          +formatUnits(await usdc.balanceOf(ms.vault.address), assetDecimals[p.assetIndex])
          + +formatUnits(await ms.strategy.investedAssets(), assetDecimals[p.assetIndex])
          + +formatUnits(await usdc.balanceOf(ms.strategy.address), assetDecimals[p.assetIndex])
      }
    }

    describe('Good paths', () => {
      describe("Only invested assets amount changes", async () => {
        async function changeAssetAmountTest(
          amount0: string,
          amount1: string,
          initialInsuranceBalance?: string
        ): Promise<IDoHardworkResults> {
          return makeDoHardwork({
            tokens: [usdc, dai],
            assetIndex: 0,

            setUpInvestedAssetsInitial: {
              depositorLiquidity18: "1",
              depositorQuoteExit: {
                liquidityAmount18: "1",
                amountsOut: [amount0, "0"],
              }
            },
            setUpInvestedAssets: {
              depositorLiquidity18: "2",
              depositorQuoteExit: {
                liquidityAmount18: "2",
                amountsOut: [amount1, "0"],
              }
            },

            initialBalance: "2",
            initialInsuranceBalance,
            balanceChange: "0",

            handleRewardsResults: {
              earned: "0",
              lost: "0",
            },
            assetProviderBalance: "1000"
          });
        }

        describe("Invested assets amount was increased because of price changing", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function incInvestedAssetAmountTest(): Promise<IDoHardworkResults> {
            return changeAssetAmountTest("1001", "1003");
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.earned).to.eq(0);
            expect(result.lost).to.eq(0);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.investedAssetsBefore).to.eq(1001);
            expect(result.investedAssetsAfter).to.eq(1003);
          });
          it("should send expected amount to the insurance", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.insuranceBefore).to.eq(0);
            expect(result.insuranceAfter).to.eq(2);
          });
          it("should not change totalAsset value", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.vaultTotalAssetsBefore).to.eq(1003);
            expect(result.vaultTotalAssetsAfter).to.eq(1003);
          });
        });
        describe("Invested assets amount was decreased because of price changing", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function decInvestedAssetAmountTest(): Promise<IDoHardworkResults> {
            return changeAssetAmountTest("1001", "1000", "2000");
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.earned).to.eq(0);
            expect(result.lost).to.eq(0);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.investedAssetsBefore).to.eq(1001);
            expect(result.investedAssetsAfter).to.eq(1000);
          });
          it("should cover losses from insurance", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.insuranceBefore).to.eq(2000);
            expect(result.insuranceAfter).to.eq(1999);
          });
          it("should not change totalAsset value", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.vaultTotalAssetsBefore).to.eq(1003);
            expect(result.vaultTotalAssetsAfter).to.eq(1003);
          });
        });
      });

      describe("Only handle-rewards-amount changes", async () => {
        async function changeHandleRewardsAmount(earned: string, lost: string): Promise<IDoHardworkResults> {
          return makeDoHardwork({
            tokens: [usdc, dai],
            assetIndex: 0,

            setUpInvestedAssetsInitial: {
              depositorLiquidity18: "1",
              depositorQuoteExit: {
                liquidityAmount18: "1",
                amountsOut: ["1", "0"],
              }
            },
            setUpInvestedAssets: {
              depositorLiquidity18: "2",
              depositorQuoteExit: {
                liquidityAmount18: "2",
                amountsOut: ["1", "0"],
              }
            },
            initialBalance: "0",
            balanceChange: "0",
            handleRewardsResults: {
              earned,
              lost,
            },
            assetProviderBalance: "1000"
          });
        }

        describe("Handle-rewards-amount was increased", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function incInvestedAssetAmountTest(): Promise<IDoHardworkResults> {
            return changeHandleRewardsAmount("7", "3");
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.earned).to.eq(7);
            expect(result.lost).to.eq(3);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.investedAssetsBefore).to.eq(1);
            expect(result.investedAssetsAfter).to.eq(1);
          });
        });
        describe("Handle-rewards-amount was decreased", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function decInvestedAssetAmountTest(): Promise<IDoHardworkResults> {
            return changeHandleRewardsAmount("3", "7");
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.earned).to.eq(3);
            expect(result.lost).to.eq(7);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.investedAssetsBefore).to.eq(1);
            expect(result.investedAssetsAfter).to.eq(1);
          });
        });
      });

      describe("Only deposit-to-pool amounts were changed", async () => {
        async function changeDepositToPoolAmounts(initialBalance: string, balanceChange: string): Promise<IDoHardworkResults> {
          return makeDoHardwork({
            tokens: [usdc, dai],
            assetIndex: 0,

            setUpInvestedAssetsInitial: {
              depositorLiquidity18: "1",
              depositorQuoteExit: {
                liquidityAmount18: "1",
                amountsOut: ["1", "0"],
              }
            },
            setUpInvestedAssets: {
              depositorLiquidity18: "2",
              depositorQuoteExit: {
                liquidityAmount18: "2",
                amountsOut: ["1", "0"],
              }
            },

            initialBalance,
            balanceChange,

            handleRewardsResults: {
              earned: "0",
              lost: "0",
              balanceChange: "0",
            },
            assetProviderBalance: "1000",
            useMockedDepositToPoolUni: true
          });
        }

        describe("Balance was increased during reinvesting", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function incInvestedAssetAmountTest(): Promise<IDoHardworkResults> {
            return changeDepositToPoolAmounts("3", "7");
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.earned).to.eq(7);
            expect(result.lost).to.eq(0);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(incInvestedAssetAmountTest);
            expect(result.investedAssetsBefore).to.eq(1);
            expect(result.investedAssetsAfter).to.eq(1);
          });
        });
        describe("Balance was decreased during reinvesting", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function decInvestedAssetAmountTest(): Promise<IDoHardworkResults> {
            return changeDepositToPoolAmounts("7", "-5");
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.earned).to.eq(0);
            expect(result.lost).to.eq(5);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(decInvestedAssetAmountTest);
            expect(result.investedAssetsBefore).to.eq(1);
            expect(result.investedAssetsAfter).to.eq(1);
          });
        });
      });

      describe("All amounts were changed", async () => {
        describe("3 earned amounts", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTestThreeEarnedAmounts(): Promise<IDoHardworkResults> {
            return makeDoHardwork({
              tokens: [usdc, dai],
              assetIndex: 0,

              setUpInvestedAssetsInitial: {
                depositorLiquidity18: "1",
                depositorQuoteExit: {
                  liquidityAmount18: "1",
                  amountsOut: ["1", "0"],
                }
              },
              setUpInvestedAssets: {
                depositorLiquidity18: "2",
                depositorQuoteExit: {
                  liquidityAmount18: "2",
                  amountsOut: ["6", "0"],
                }
              },

              initialBalance: "100",
              balanceChange: "50",

              handleRewardsResults: {
                earned: "500",
                lost: "0",
              },
              assetProviderBalance: "1000",
              callDoHardworkBySplitter: true,
              useMockedDepositToPoolUni: true
            });
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.earned).to.eq(550);
            expect(result.lost).to.eq(0);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.investedAssetsBefore).to.eq(1);
            expect(result.investedAssetsAfter).to.eq(6);
          });
          it("doHardwork() should return expected results", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.callDoHardwork?.earned).to.eq(550);
            expect(result.callDoHardwork?.lost).to.eq(0);
          });
        });
        describe("2 earned amounts + 2 losses", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTestThreeEarnedAmounts(): Promise<IDoHardworkResults> {
            return makeDoHardwork({
              tokens: [usdc, dai],
              assetIndex: 0,

              setUpInvestedAssetsInitial: {
                depositorLiquidity18: "1",
                depositorQuoteExit: {
                  liquidityAmount18: "1",
                  amountsOut: ["1000", "0"],
                }
              },
              setUpInvestedAssets: {
                depositorLiquidity18: "2",
                depositorQuoteExit: {
                  liquidityAmount18: "2",
                  amountsOut: ["6000", "0"],
                }
              },

              initialBalance: "100",
              balanceChange: "-50",

              handleRewardsResults: {
                earned: "500",
                lost: "400",
              },
              assetProviderBalance: "1000",
              callDoHardworkBySplitter: true,
              useMockedDepositToPoolUni: true
            });
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.earned).to.eq(500);
            expect(result.lost).to.eq(450);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.investedAssetsBefore).to.eq(1000);
            expect(result.investedAssetsAfter).to.eq(6000);
          });
          it("doHardwork() should return expected results", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.callDoHardwork?.earned).to.eq(500);
            expect(result.callDoHardwork?.lost).to.eq(450);
          });
        });
        describe("3 lost amounts", async () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTestThreeLostAmounts(): Promise<IDoHardworkResults> {
            return makeDoHardwork({
              tokens: [usdc, dai],
              assetIndex: 0,

              setUpInvestedAssetsInitial: {
                depositorLiquidity18: "1",
                depositorQuoteExit: {
                  liquidityAmount18: "1",
                  amountsOut: ["5000", "0"],
                }
              },
              setUpInvestedAssets: {
                depositorLiquidity18: "2",
                depositorQuoteExit: {
                  liquidityAmount18: "2",
                  amountsOut: ["4990", "0"],
                }
              },

              initialBalance: "100",
              balanceChange: "-50",

              handleRewardsResults: {
                earned: "0",
                lost: "500",
              },
              assetProviderBalance: "1000",
              callDoHardworkBySplitter: true,
              useMockedDepositToPoolUni: true
            });
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(makeTestThreeLostAmounts);
            expect(result.earned).to.eq(0);
            expect(result.lost).to.eq(550);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(makeTestThreeLostAmounts);
            expect(result.investedAssetsBefore).to.eq(5000);
            expect(result.investedAssetsAfter).to.eq(4990);
          });
          it("doHardwork() should return expected results", async () => {
            const result = await loadFixture(makeTestThreeLostAmounts);
            expect(result.callDoHardwork?.earned).to.eq(0);
            expect(result.callDoHardwork?.lost).to.eq(550);
          });

        });
        describe("Skipping reinvesting", async () => {
          describe("reInvest is false", async () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeTestThreeEarnedAmountsSkipReinvest(): Promise<IDoHardworkResults> {
              return makeDoHardwork({
                tokens: [usdc, dai],
                assetIndex: 0,

                setUpInvestedAssetsInitial: {
                  depositorLiquidity18: "1",
                  depositorQuoteExit: {
                    liquidityAmount18: "1",
                    amountsOut: ["1", "0"],
                  }
                },
                setUpInvestedAssets: {
                  depositorLiquidity18: "2",
                  depositorQuoteExit: {
                    liquidityAmount18: "2",
                    amountsOut: ["6", "0"],
                  }
                },

                initialBalance: "100",
                balanceChange: "50",

                handleRewardsResults: {
                  earned: "500",
                  lost: "0",
                },
                assetProviderBalance: "1000",
                reInvest: false, // (!)
                useMockedDepositToPoolUni: true
              });
            }

            it("should return expected lost and earned values", async () => {
              const result = await loadFixture(makeTestThreeEarnedAmountsSkipReinvest);
              expect(result.earned).to.eq(550);
              expect(result.lost).to.eq(0);
            });
            it("should set expected investedAssets value", async () => {
              const result = await loadFixture(makeTestThreeEarnedAmountsSkipReinvest);
              expect(result.investedAssetsBefore).to.eq(1);
              expect(result.investedAssetsAfter).to.eq(6);
            });
          });
          describe("Available amount is less than the threshold", async () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeTestThreeLostAmountsThreshold(): Promise<IDoHardworkResults> {
              return makeDoHardwork({
                tokens: [usdc, dai],
                assetIndex: 0,

                setUpInvestedAssetsInitial: {
                  depositorLiquidity18: "1",
                  depositorQuoteExit: {
                    liquidityAmount18: "1",
                    amountsOut: ["40000", "0"],
                  }
                },
                setUpInvestedAssets: {
                  depositorLiquidity18: "2",
                  depositorQuoteExit: {
                    liquidityAmount18: "2",
                    amountsOut: ["40000", "0"],
                  }
                },

                initialBalance: "3999", // (!)
                balanceChange: "10000",

                handleRewardsResults: {
                  earned: "0",
                  lost: "500",
                },
                assetProviderBalance: "1000",

                reInvest: true,
                reinvestThresholdPercent: 10_000, // (!) assetBalance must be greater than 40_000 * 10% = 4000
              });
            }

            it("should return expected lost and earned values", async () => {
              const result = await loadFixture(makeTestThreeLostAmountsThreshold);
              expect(result.earned).to.eq(0);
              expect(result.lost).to.eq(500);
            });
            it("should set expected investedAssets value", async () => {
              const result = await loadFixture(makeTestThreeLostAmountsThreshold);
              expect(result.investedAssetsBefore).to.eq(40_000);
              expect(result.investedAssetsAfter).to.eq(40_000);
            });
          });
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
      it("doHardwork() should revert if not splitter", async () => {
        const p = {
          tokens: [usdc, dai],
          assetIndex: 0,

          setUpInvestedAssetsInitial: {
            depositorLiquidity18: "1",
            depositorQuoteExit: {
              liquidityAmount18: "1",
              amountsOut: ["1", "0"],
            }
          },
          setUpInvestedAssets: {
            depositorLiquidity18: "2",
            depositorQuoteExit: {
              liquidityAmount18: "2",
              amountsOut: ["6", "0"],
            }
          },

          initialBalance: "100",
          balanceChange: "50",

          handleRewardsResults: {
            earned: "500",
            lost: "0",
          },
          assetProviderBalance: "1000",
          callDoHardworkBySplitter: false // (!)
        }
        await expect(makeDoHardwork(p)).to.be.revertedWith("SB: Denied"); // DENIED
      });
    });
  });

  describe("isReadyToHardWork", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    it("should return true", async () => {
      const ms = await setupMockedStrategy();
      expect(await ms.strategy.isReadyToHardWork()).eq(true);
    });
  });

  describe("_withdrawUniversal-trivial", () => {
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should return zeros if amount is zero", async () => {
        const ms = await setupMockedStrategy();

        // set up _updateInvestedAssets()
        await ms.strategy.setDepositorLiquidity(parseUnits("1", 18));
        await ms.strategy.setDepositorQuoteExit(
          parseUnits("1", 18),
          ms.depositorTokens.map((x, index) => parseUnits("0", 18))
        );
        const r = await ms.strategy.callStatic.withdrawUniversalTestAccess(0, false, 0, 0);

        expect(r.expectedWithdrewUSD.eq(0)).eq(true);
        expect(r.assetPrice.eq(0)).eq(true);
      });
    });
  });

  describe("__ConverterStrategyBase_init", () => {
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });
      it("should revert on second initialization", async () => {
        const ms = await setupMockedStrategy();
        await expect(
          ms.strategy.init2(ms.controller.address, ms.splitter.address, ms.tetuConverter.address)
        ).revertedWith("Initializable: contract is not initializing"); // openzeppelin/Initializable.sol
      });
    });
  });

  describe('_recycle', () => {
    interface IRecycleTestParams {
      asset: MockToken;
      compoundRate: number;
      rewardTokens: MockToken[];
      rewardAmounts: string[];

      liquidations: ILiquidationParams[];
      thresholds: ITokenAmountNum[];
      initialBalances: ITokenAmountNum[];

      // disable performanceFee by default
      performanceFee: number;
      // governance is used as a performance receiver by default
      performanceReceiver: string;

      // 100_000 - send full amount toPerf, 0 - send full amount toInsurance.
      performanceFeeRatio?: number;
    }

    interface IRecycleTestResults {
      gasUsed: BigNumber;

      forwarderTokens: string[];
      forwarderAmounts: number[];

      amountsToForward: number[];
      performanceAmounts: number;
      insuranceAmounts: number;

      finalRewardTokenBalances: number[];
    }

    async function makeRecycle(p: IRecycleTestParams): Promise<IRecycleTestResults> {
      const ms = await setupMockedStrategy();
      await ms.strategy.connect(await Misc.impersonate(await ms.controller.platformVoter())).setCompoundRatio(p.compoundRate);

      // disable performance fee by default
      await ms.strategy.connect(await Misc.impersonate(await ms.controller.governance())).setupPerformanceFee(p.performanceFee,p.performanceReceiver, p?.performanceFeeRatio || 50_000);

      for (const tokenAmount of p.initialBalances) {
        await tokenAmount.token.mint(
          ms.strategy.address,
          parseUnits(tokenAmount.amount, await tokenAmount.token.decimals())
        );
      }

      for (const liquidation of p.liquidations) {
        await setupMockedLiquidation(liquidator, liquidation);
        await setupIsConversionValid(ms.tetuConverter, liquidation, true);
      }

      const operators = await ControllerV2__factory.connect(ms.controller.address, signer).operatorsList();
      for (const threshold of p.thresholds) {
        await ms.strategy.setLiquidationThreshold(
          threshold.token.address,
          parseUnits(threshold.amount, await threshold.token.decimals())
        );
      }

      const amountsToForward: BigNumber[] = await ms.strategy.callStatic._recycleAccess(
        p.rewardTokens.map(x => x.address),
        await Promise.all(p.rewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.rewardTokens[index].decimals())
        ))
      );
      const tx = await ms.strategy._recycleAccess(
        p.rewardTokens.map(x => x.address),
        await Promise.all(p.rewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.rewardTokens[index].decimals())
        ))
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const retForwarder = await forwarder.getLastRegisterIncomeResults();

      return {
        gasUsed,
        forwarderAmounts: await Promise.all(retForwarder.amounts.map(
          async (amount, index) => +formatUnits(amount, await p.rewardTokens[index].decimals())
        )),
        forwarderTokens: retForwarder.tokens,
        amountsToForward: await Promise.all(amountsToForward.map(
          async (amount, index) => +formatUnits(amount, await p.rewardTokens[index].decimals())
        )),
        performanceAmounts: +formatUnits(await p.asset.balanceOf(p.performanceReceiver), await p.asset.decimals()),
        insuranceAmounts: +formatUnits(await p.asset.balanceOf(await ms.vault.insurance()), await p.asset.decimals()),
        finalRewardTokenBalances: await Promise.all(p.rewardTokens.map(
          async (token, index) => +formatUnits(await token.balanceOf(ms.strategy.address), await token.decimals())
        )),
      };
    }

    describe('Good paths', () => {
      describe('All cases test, zero liquidation thresholds', () => {
        let snapshotLocal: string;
        before(async function() {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function() {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function makeRecycleTest(): Promise<IRecycleTestResults> {
          return makeRecycle({
            performanceReceiver: ethers.Wallet.createRandom().address,
            rewardTokens: [dai, usdc, bal],
            rewardAmounts: ["100", "200", "400"],
            asset: usdc,
            compoundRate: 80_000,
            liquidations: [
              {tokenIn: dai, tokenOut: usdc, amountIn: "10", amountOut: "12"},
              {tokenIn: bal, tokenOut: usdc, amountIn: "328", amountOut: "34"},
            ],
            thresholds: [],
            performanceFee: 10_000,
            initialBalances: [
              {token: dai, amount: "100"},
              {token: usdc, amount: "200"},
              {token: bal, amount: "400"}
            ],
          });
        }

        it('should return expected forwarderAmounts', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.amountsToForward.join()).to.equal([18, 36, 72].join());
        });
        it('should return expected performanceAmounts', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.performanceAmounts).to.equal(18.07317); // (12 + 20 + 40/328*34) / 2
        });
        it('should return expected insuranceAmounts', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.performanceAmounts).to.equal(18.07317); // (12 + 20 + 40/328*34) / 2
        });
        it('should return expected final balances', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.finalRewardTokenBalances.join()).to.equal([90-18, 209.853659-36, 72-72].join()); // 200 - 20 + 288/328*34
        });
      });
      describe('60% performance, 40% insurance', () => {
        let snapshotLocal: string;
        before(async function() {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function() {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function makeRecycleTest(): Promise<IRecycleTestResults> {
          return makeRecycle({
            performanceReceiver: ethers.Wallet.createRandom().address,
            rewardTokens: [dai, usdc, bal],
            rewardAmounts: ["100", "200", "400"],
            asset: usdc,
            compoundRate: 80_000,
            liquidations: [
              {tokenIn: dai, tokenOut: usdc, amountIn: "10", amountOut: "12"},
              {tokenIn: bal, tokenOut: usdc, amountIn: "328", amountOut: "34"},
            ],
            thresholds: [],
            performanceFee: 10_000,
            initialBalances: [
              {token: dai, amount: "100"},
              {token: usdc, amount: "200"},
              {token: bal, amount: "400"}
            ],
            performanceFeeRatio: 60_000
          });
        }

        it('should return expected forwarderAmounts', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.amountsToForward.join()).to.equal([18, 36, 72].join());
        });
        it('should return expected performanceAmounts', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.performanceAmounts).to.equal(21.687804); // (12 + 20 + 40/328*34) * 60 /100
        });
        it('should return expected insuranceAmounts', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.insuranceAmounts).to.equal(14.458537); // (12 + 20 + 40/328*34) * 40 / 100
        });
        it('should return expected final balances', async() => {
          const r = await loadFixture(makeRecycleTest);
          expect(r.finalRewardTokenBalances.join()).to.equal([90-18, 209.853659-36, 72-72].join()); // 200 - 20 + 288/328*34
        });
      });
      describe("too high liquidation thresholds", () => {
        describe('bal', () => {
          let snapshotLocal: string;
          before(async function() {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshotLocal);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              performanceReceiver: ethers.Wallet.createRandom().address,
              rewardTokens: [dai, usdc, bal],
              rewardAmounts: ["100", "200", "400"],
              asset: usdc,
              compoundRate: 80_000,
              liquidations: [
                {tokenIn: dai, tokenOut: usdc, amountIn: "10", amountOut: "12"},
                {tokenIn: bal, tokenOut: usdc, amountIn: "328", amountOut: "34"},
              ],
              thresholds: [
                {token: bal, amount: "329"},
              ],
              performanceFee: 10_000,
              initialBalances: [
                {token: dai, amount: "100"},
                {token: usdc, amount: "200"},
                {token: bal, amount: "400"}
              ],
            });
          }

          /**
           * 100 dai => 10 dai + 90 dai
           *    10 dai => performance
           *    90 dai => forwarder + compound = 18 + 72
           * 10 dai => 12 usdc
           * 200 usdc => 20 usdc + 180 usdc
           *    20 usdc => performance
           *    180 usdc => forwarder + compound = 36 + 144
           * 400 bal => 40 bal + 360 bal
           *    40 bal => performance
           *    360 bal => forwarder + compound = 72 + 288
           * 20% is sent to forwarder as is without any conversion
           *    (40 + 360*0.8) = 328 bal => 34 usdc
           *    we should have
           *        34 * 360*0.8 / 328 = 29.85 => to compound
           *        34 * 360*0.8 / 328 = 3.31 => to performance
           *    but threshold 329 > 328, so bal is NOT CONVERTER in this test
           */
          it('should return expected forwarderAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).to.equal([18, 36, 72].join());
          });
          it('should return expected performanceAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.performanceAmounts).to.equal(16); // (12 + 20 + 0/328*34) / 2
          });
          it('should return expected insuranceAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.insuranceAmounts).to.equal(16); // (12 + 20 + 0/328*34) / 2
          });
          it('should return expected final balances', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.finalRewardTokenBalances.join()).to.equal([90-18, 180-36, 400-72].join()); // 200 - 20
          });
        });
        describe('dai', () => {
          let snapshotLocal: string;
          before(async function() {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshotLocal);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              performanceReceiver: ethers.Wallet.createRandom().address,
              rewardTokens: [dai, usdc, bal],
              rewardAmounts: ["100", "200", "400"],
              asset: usdc,
              compoundRate: 80_000,
              liquidations: [
                {tokenIn: dai, tokenOut: usdc, amountIn: "10", amountOut: "12"},
                {tokenIn: bal, tokenOut: usdc, amountIn: "328", amountOut: "34"},
              ],
              thresholds: [{token: dai, amount: "11"}],
              performanceFee: 10_000,
              initialBalances: [
                {token: dai, amount: "100"},
                {token: usdc, amount: "200"},
                {token: bal, amount: "400"}
              ],
            });
          }

          it('should return expected forwarderAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).to.equal([18, 36, 72].join());
          });
          it('should return expected performanceAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.performanceAmounts).to.equal(12.07317); // (0 + 20 + 40/328*34) / 2
          });
          it('should return expected insuranceAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.performanceAmounts).to.equal(12.07317); // (0 + 20 + 40/328*34) / 2
          });
          it('should return expected final balances', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.finalRewardTokenBalances.join()).to.equal([100-18, 209.853659-36, 72-72].join()); // 200 - 20 + 288/328*34
          });
        });
        describe('usdc', () => {
          let snapshotLocal: string;
          before(async function() {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshotLocal);
          });

          async function makeRecycleTest(): Promise<IRecycleTestResults> {
            return makeRecycle({
              performanceReceiver: ethers.Wallet.createRandom().address,
              rewardTokens: [dai, usdc, bal],
              rewardAmounts: ["100", "200", "400"],
              asset: usdc,
              compoundRate: 80_000,
              liquidations: [
                {tokenIn: dai, tokenOut: usdc, amountIn: "10", amountOut: "12"},
                {tokenIn: bal, tokenOut: usdc, amountIn: "328", amountOut: "34"},
              ],
              thresholds: [{token: usdc, amount: "500"}],
              performanceFee: 10_000,
              initialBalances: [
                {token: dai, amount: "100"},
                {token: usdc, amount: "200"},
                {token: bal, amount: "400"}
              ],
            });
          }

          it('should return expected forwarderAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.amountsToForward.join()).to.equal([18, 36, 72].join());
          });
          it('should return expected performanceAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.performanceAmounts).to.equal(18.07317);  // (12 + 20 + 40/328*34) / 2
          });
          it('should return expected insuranceAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.performanceAmounts).to.equal(18.07317); // (12 + 20 + 40/328*34) / 2
          });
          it('should return expected final balances', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.finalRewardTokenBalances.join()).to.equal([90-18, 209.853659-36, 72-72].join()); // 180+288*34/328, 400*0.9*0.2
          });
        });
      });
    });
  });

  describe("_depositToPoolUniversal", () => {
    interface IDepositToPoolUniParams {
      amount: string;
      earnedByPrices: string;
      investedAssets: string;

      initialBalances: string[]; // dai, usdc, usdt

      reinvestThresholdPercent?: number;

      beforeDeposit?: {
        amount: string;
        indexAsset: number;
        tokenAmounts: string[];
      }

      depositorEnter?: {
        amounts: string[];
        liquidityOut: string;
        consumedAmounts?: string[];
      }

      depositorLiquidity?: string;
      depositorQuoteExit?: {
        liquidityAmount: string;
        amountsOut: string[];
      }

      withdrawUniversal?: {
        amountToPutOnBalance: string,
        input: {
          amount: string,
          earnedByPrices: string,
          investedAssets: string
        },
        output: {
          expectedWithdrewUSD: string,
          assetPrice: string,
          strategyLoss: string,
          amountSentToInsurance: string
        }
      }
    }
    interface IDepositToPoolUniResults {
      insuranceBalance: number;
      strategyLoss: number;
      amountSentToInsurance: number;
      strategyBalance: number;
    }

    async function makeDepositToPool(p: IDepositToPoolUniParams) : Promise<IDepositToPoolUniResults> {
      const ms = await setupMockedStrategy();
      await ms.strategy.connect(await Misc.impersonate(await ms.controller.platformVoter())).setCompoundRatio(50_000);
      if (p.reinvestThresholdPercent !== undefined) {
        await ms.strategy.connect(await Misc.impersonate(await ms.controller.governance())).setReinvestThresholdPercent(p.reinvestThresholdPercent);
      }

      // put initial balances
      for (let i = 0; i < ms.depositorTokens.length; ++i) {
        const token = ms.depositorTokens[i];
        await token.mint(ms.strategy.address, parseUnits(p.initialBalances[i], await token.decimals()));
      }

      // prepare deposit-mocks
      if (p.beforeDeposit) {
        const tokenAmounts = p.beforeDeposit.tokenAmounts;
        await ms.strategy.setBeforeDeposit(
          parseUnits(p.beforeDeposit.amount, 6),
          ms.indexAsset,
          await Promise.all(ms.depositorTokens.map(
            async (token, index) => parseUnits(tokenAmounts[index], await token.decimals())
          ))
        );
      }
      if (p.depositorEnter) {
        const amounts = p.depositorEnter?.amounts;
        const consumedAmounts = p.depositorEnter?.consumedAmounts || p.depositorEnter.amounts;
        await ms.strategy.setDepositorEnter(
          await Promise.all(ms.depositorTokens.map(
            async (token, index) => parseUnits(amounts[index], await token.decimals())
          )),
          await Promise.all(ms.depositorTokens.map(
            async (token, index) => parseUnits(consumedAmounts[index], await token.decimals())
          )),
          parseUnits(p.depositorEnter.liquidityOut, 18)
        );
      }
      if (p.depositorLiquidity) {
        await ms.strategy.setDepositorLiquidity(parseUnits(p.depositorLiquidity, 18));
      }
      if (p.depositorQuoteExit) {
        const amountsOut = p.depositorQuoteExit.amountsOut;
        await ms.strategy.setDepositorQuoteExit(
          parseUnits(p.depositorQuoteExit.liquidityAmount, 18),
          await Promise.all(ms.depositorTokens.map(
            async (token, index) => parseUnits(amountsOut[index], await token.decimals())
          )),
        );
      }

      // set up withdraw
      if (p.withdrawUniversal) {
        const amountToPutOnBalance = parseUnits(p.withdrawUniversal.amountToPutOnBalance, 6);
        const assetProvider = ethers.Wallet.createRandom().address;
        await usdc.mint(assetProvider, amountToPutOnBalance);
        await usdc.connect(await Misc.impersonate(assetProvider)).approve(ms.strategy.address, amountToPutOnBalance);
        await ms.strategy.setUpMockedWithdrawUniversal(
          assetProvider,
          amountToPutOnBalance,
          parseUnits(p.withdrawUniversal.input.amount, 6),
          parseUnits(p.withdrawUniversal.input.earnedByPrices, 6),
          parseUnits(p.withdrawUniversal.input.investedAssets, 6),

          parseUnits(p.withdrawUniversal.output.expectedWithdrewUSD, 6),
          parseUnits(p.withdrawUniversal.output.assetPrice, 18),
          parseUnits(p.withdrawUniversal.output.strategyLoss, 6),
          parseUnits(p.withdrawUniversal.output.amountSentToInsurance, 6)
        );
      }

      // make action
      const ret = await ms.strategy.callStatic.depositToPoolUniAccess(
        parseUnits(p.amount, 6),
        parseUnits(p.earnedByPrices, 6),
        parseUnits(p.investedAssets, 6)
      );

      await ms.strategy.depositToPoolUniAccess(
        parseUnits(p.amount, 6),
        parseUnits(p.earnedByPrices, 6),
        parseUnits(p.investedAssets, 6)
      );

      return {
        amountSentToInsurance: +formatUnits(ret.amountSentToInsurance, 6),
        strategyLoss: +formatUnits(ret.strategyLoss, 6),
        insuranceBalance: +formatUnits(await usdc.balanceOf(await ms.vault.insurance()), 6),
        strategyBalance: +formatUnits(await usdc.balanceOf(ms.strategy.address), 6),
      }
    }

    describe("balance >= earnedByPrices, amountToDeposit > threshold", () => {
      let snapshotLocal: string;
      before(async function() {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function() {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function makeDepositToPoolTest(): Promise<IDepositToPoolUniResults> {
        return makeDepositToPool({
          amount: "450",
          earnedByPrices: "400", // amount to deposit = 450 - 400 = 50
          initialBalances: ["1", "1000", "3"], // dai, usdc, usdt

          investedAssets: "1000000000",

          reinvestThresholdPercent: 0,

          beforeDeposit: {
            amount: "50",
            indexAsset: 1,  // 0=dai, 1=usdc, 2=usdt
            tokenAmounts: ["1", "2", "3"]
          },
          depositorEnter: {
            liquidityOut: "100",
            amounts: ["1", "2", "3"],
            consumedAmounts: ["1", "2", "3"],
          },
          depositorLiquidity: "11",
          depositorQuoteExit: {
            liquidityAmount: "111",
            amountsOut: ["3", "4", "5"]
          }
        });
      }

      it("should send expected amount to insurance", async () => {
        const ret = await loadFixture(makeDepositToPoolTest);
        expect(ret.insuranceBalance).eq(400);
      });
      it("should return expected amountSentToInsurance", async () => {
        const ret = await loadFixture(makeDepositToPoolTest);
        expect(ret.amountSentToInsurance).eq(400);
      });
      it("should return zero strategy loss", async () => {
        const ret = await loadFixture(makeDepositToPoolTest);
        console.log(ret);
        expect(ret.strategyLoss).not.eq(0);
      });

    });
    describe("amountToDeposit <= threshold", () => {
      describe("earnedByPrices == 0 (no changes)", () => {
        let snapshotLocal: string;
        before(async function() {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function() {
          await TimeUtils.rollback(snapshotLocal);
        });
        async function makeDepositToPoolTest(): Promise<IDepositToPoolUniResults> {
          return makeDepositToPool({
            amount: "1",
            earnedByPrices: "0",
            initialBalances: ["0", "712", "0"], // dai, usdc, usdt // 10 = initial amount, 702 - amount to deposit

            investedAssets: "1000000",

            reinvestThresholdPercent: 2
          });
        }

        it("should send zero amount to insurance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.insuranceBalance).eq(0);
        });
        it("should return zero amountSentToInsurance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.amountSentToInsurance).eq(0);
        });
        it("should return zero strategy loss", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.strategyLoss).eq(0);
        });
      });
      describe("earnedByPrices != 0, balance > earnedByPrices_ (balance => insurance)", () => {
        let snapshotLocal: string;
        before(async function() {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function() {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function makeDepositToPoolTest(): Promise<IDepositToPoolUniResults> {
          return makeDepositToPool({
            amount: "500",
            earnedByPrices: "700",
            initialBalances: ["0", "712", "0"], // dai, usdc, usdt

            investedAssets: "10000000000",

            reinvestThresholdPercent: 1
          });
        }

        it("should send expected amount to insurance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.insuranceBalance).eq(700);
        });
        it("should return expected amountSentToInsurance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.amountSentToInsurance).eq(700);
        });
        it("should return zero strategy loss", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.strategyLoss).eq(0);
        });
      });

      describe("earnedByPrices != 0, balance < earnedByPrices_ (withdraw => insurance)", () => {
        let snapshotLocal: string;
        before(async function() {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function() {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function makeDepositToPoolTest(): Promise<IDepositToPoolUniResults> {
          return makeDepositToPool({
            amount: "500",
            earnedByPrices: "700",
            initialBalances: ["0", "651", "0"], // dai, usdc, usdt

            investedAssets: "1000000000",

            reinvestThresholdPercent: 1,

            withdrawUniversal: {
              amountToPutOnBalance: "50",
              input: {
                amount: "0",
                earnedByPrices: "700",
                investedAssets: "1000000000",  // investedAssets + initial balance
              },
              output: {
                expectedWithdrewUSD: "51",
                amountSentToInsurance: "699",
                strategyLoss: "13",
                assetPrice: "0.9",
              },
            }
          });
        }

        it("should send expected amount to insurance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.insuranceBalance).eq(699);
        });
        it("should return expected amountSentToInsurance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.amountSentToInsurance).eq(699);
        });
        it("should return expected strategy loss", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.strategyLoss).eq(13);
        });
        it("should set expected balance", async () => {
          const ret = await loadFixture(makeDepositToPoolTest);
          expect(ret.strategyBalance).eq(651 + 50 - 699);
        });
      });
    });
  });


  describe('setReinvestThresholdPercent', () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      it('should return expected values', async() => {
        const ms = await setupMockedStrategy();
        const operator = await UniversalTestUtils.getAnOperator(ms.strategy.address, signer);
        await ms.strategy.connect(operator).setReinvestThresholdPercent(1012);
        const ret = await ms.strategy.reinvestThresholdPercent();

        expect(ret).eq(1012);
      });
    });
    describe('Bad paths', () => {
      it('should revert if not operator', async() => {
        const ms = await setupMockedStrategy();
        const notOperator = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await expect(
          ms.strategy.connect(notOperator).setReinvestThresholdPercent(1012),
        ).revertedWith('SB: Denied');
      });
      it('should revert if percent is too high', async() => {
        const ms = await setupMockedStrategy();
        const operator = await UniversalTestUtils.getAnOperator(ms.strategy.address, signer);
        await expect(
          ms.strategy.connect(operator).setReinvestThresholdPercent(100_001),
        ).revertedWith('SB: Wrong value'); // WRONG_VALUE
      });
    });
  });

  describe('setLiquidationThreshold', () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      it('should set max int', async() => {
        const ms = await setupMockedStrategy();
        const token = ethers.Wallet.createRandom().address;
        const operator = await UniversalTestUtils.getAnOperator(ms.strategy.address, signer);
        await ms.strategy.connect(operator).setLiquidationThreshold(token, Misc.MAX_UINT);
        const ret = await ms.strategy.liquidationThresholds(token);

        expect(ret.eq(Misc.MAX_UINT)).eq(true);
      });
      it('should set 0', async() => {
        const ms = await setupMockedStrategy();
        const token = ethers.Wallet.createRandom().address;
        const operator = await UniversalTestUtils.getAnOperator(ms.strategy.address, signer);
        await ms.strategy.connect(operator).setLiquidationThreshold(token,0);
        const ret = await ms.strategy.liquidationThresholds(token);

        expect(ret).eq(0);
      });
      it('should set 100_000', async() => {
        const ms = await setupMockedStrategy();
        const token = ethers.Wallet.createRandom().address;
        const operator = await UniversalTestUtils.getAnOperator(ms.strategy.address, signer);
        await ms.strategy.connect(operator).setLiquidationThreshold(token,100_000);
        const ret = await ms.strategy.liquidationThresholds(token);

        expect(ret).eq(100_000);
      });
    });
    describe('Bad paths', () => {
      it('should revert if not operator', async() => {
        const ms = await setupMockedStrategy();
        const token = ethers.Wallet.createRandom().address;
        const notOperator = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await expect(
          ms.strategy.connect(notOperator).setLiquidationThreshold(token,100_000),
        ).revertedWith('SB: Denied');
      });
    });
  });

  describe('_prepareRewardsList', () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    interface IPrepareRewardsListTestResults {
      gasUsed: BigNumber;
      orderedByAmounts: {
        tokens: string[];
        amounts: BigNumber[];
      };
    }

    async function makePrepareRewardsListTest(
      tokens: MockToken[],
      tokensClaimedByDepositor: MockToken[],
      amountsClaimedByDepositor: BigNumber[],
      tokensClaimedByTetuConverter: MockToken[],
      amountsClaimedByTetuConverter: BigNumber[],
    ): Promise<IPrepareRewardsListTestResults> {
      const ms = await setupMockedStrategy();

      await ms.tetuConverter.setClaimRewards(
        tokensClaimedByTetuConverter.map(x => x.address),
        amountsClaimedByTetuConverter,
      );
      for (let i = 0; i < tokensClaimedByTetuConverter.length; ++i) {
        await tokensClaimedByTetuConverter[i].mint(ms.tetuConverter.address, amountsClaimedByTetuConverter[i]);
      }
      for (let i = 0; i < tokensClaimedByDepositor.length; ++i) {
        await tokensClaimedByDepositor[i].mint(ms.strategy.address, amountsClaimedByDepositor[i]);
      }

      const r = await ms.strategy.callStatic._prepareRewardsListAccess(
        ms.tetuConverter.address,
        tokens.map(x => x.address),
        tokensClaimedByDepositor.map(x => x.address),
        amountsClaimedByDepositor,
      );
      console.log('r', r);
      const tx = await ms.strategy._prepareRewardsListAccess(
        ms.tetuConverter.address,
        tokens.map(x => x.address),
        tokensClaimedByDepositor.map(x => x.address),
        amountsClaimedByDepositor,
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const pairsOrderedByAmounts = (await Promise.all([...Array(r.amountsOut.length).keys()].map(
        async index => ({
          token: r.tokensOut[index],
          amount: r.amountsOut[index],
          amountNum: +formatUnits(
            r.amountsOut[index],
            await IERC20Metadata__factory.connect(r.tokensOut[index], signer).decimals(),
          ),
        }),
      ))).sort((a, b) => a.amountNum - b.amountNum);
      console.log('pairsOrderedByAmounts', pairsOrderedByAmounts);

      return {
        orderedByAmounts: {
          tokens: pairsOrderedByAmounts.map(x => x.token),
          amounts: pairsOrderedByAmounts.map(x => x.amount),
        },
        gasUsed,
      };
    }

    describe('Good paths', () => {
      describe('Zero balances, zero base amounts, no zero amounts, no repeat tokens', () => {
        it('should return expected values', async() => {
          const tokensClaimedByDepositor = [usdc, usdt, dai];
          const amountsClaimedByDepositor = [
            parseUnits('1', 6),
            parseUnits('2', 6),
            parseUnits('3', 18),
          ];
          const tokensClaimedByTetuConverter = [tetu, bal];
          const amountsClaimedByTetuConverter = [
            parseUnits('4', 18),
            parseUnits('5', 18),
          ];

          const r = await makePrepareRewardsListTest(
            [],
            tokensClaimedByDepositor,
            amountsClaimedByDepositor,
            tokensClaimedByTetuConverter,
            amountsClaimedByTetuConverter,
          );

          const ret = [
            r.orderedByAmounts.tokens.join(),
            r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join(),
          ].join('\n');

          const expected = [
            [...tokensClaimedByDepositor, ...tokensClaimedByTetuConverter].map(x => x.address).join(),
            [...amountsClaimedByDepositor, ...amountsClaimedByTetuConverter].map(x => BalanceUtils.toString(x)).join(),
          ].join('\n');

          expect(ret).eq(expected);
        });
      });
      it('should filter out zero amounts', async() => {
        const tokensClaimedByDepositor = [usdc, usdt, dai];
        const amountsClaimedByDepositor = [
          parseUnits('1', 6),
          parseUnits('0', 6), // (!)
          parseUnits('3', 18),
        ];
        const tokensClaimedByTetuConverter = [tetu, bal];
        const amountsClaimedByTetuConverter = [
          parseUnits('0', 18), // (!)
          parseUnits('5', 18),
        ];

        const r = await makePrepareRewardsListTest(
          [],
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter,
        );

        const ret = [
          r.orderedByAmounts.tokens.join(),
          r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join(),
        ].join('\n');

        const expected = [
          [usdc, dai, bal].map(x => x.address).join(),
          [
            parseUnits('1', 6),
            parseUnits('3', 18),
            parseUnits('5', 18),
          ].map(x => BalanceUtils.toString(x)).join(),
        ].join('\n');

        expect(ret).eq(expected);
      });
      it('should combine repeated tokens', async() => {
        const tokensClaimedByDepositor = [
          usdc,
          usdc, // (!)
          dai,
        ];
        const amountsClaimedByDepositor = [
          parseUnits('10', 6),
          parseUnits('20', 6),
          parseUnits('1', 18),
        ];
        const tokensClaimedByTetuConverter = [
          tetu,
          tetu, // (!)
          usdc, // (!)
          bal,
        ];
        const amountsClaimedByTetuConverter = [
          parseUnits('3', 18),
          parseUnits('4', 18),
          parseUnits('50', 6),
          parseUnits('2', 18),
        ];

        const r = await makePrepareRewardsListTest(
          [],
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter,
        );

        const ret = [
          r.orderedByAmounts.tokens.join(),
          r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join(),
        ].join('\n');

        const expected = [
          [dai, bal, tetu, usdc].map(x => x.address).join(),
          [
            parseUnits('1', 18),
            parseUnits('2', 18),
            parseUnits('7', 18),
            parseUnits('80', 6),
          ].map(x => BalanceUtils.toString(x)).join(),
        ].join('\n');

        expect(ret).eq(expected);
      });
    });
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limit', async() => {
        const tokensClaimedByDepositor = [usdc, usdt, dai];
        const amountsClaimedByDepositor = [
          parseUnits('1', 6),
          parseUnits('0', 6),
          parseUnits('3', 18),
        ];
        const tokensClaimedByTetuConverter = [tetu, bal, usdc];
        const amountsClaimedByTetuConverter = [
          parseUnits('0', 18),
          parseUnits('5', 18),
          parseUnits('1', 6),
        ];

        const r = await makePrepareRewardsListTest(
          [],
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter,
        );

        controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });
  //endregion Unit tests
});