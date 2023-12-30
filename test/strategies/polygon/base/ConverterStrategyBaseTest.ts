import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {
  ControllerV2__factory,
  IController, IERC20__factory, IERC20Metadata__factory, ISplitter__factory,
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
} from '../../../../typechain';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../../scripts/utils/TimeUtils';
import {MockHelper} from '../../../baseUT/helpers/MockHelper';
import {DeployerUtils} from '../../../../scripts/utils/DeployerUtils';
import {DeployerUtilsLocal} from '../../../../scripts/utils/DeployerUtilsLocal';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {BigNumber} from 'ethers';
import {expect} from 'chai';
import {Misc} from "../../../../scripts/utils/Misc";
import {setupIsConversionValid, setupMockedLiquidation} from "../../../baseUT/mocks/MockLiquidationUtils";
import {
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams,
  ITokenAmount,
  ITokenAmountNum
} from "../../../baseUT/mocks/TestDataTypes";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedQuoteRepay, setupMockedRepay, setupPrices} from "../../../baseUT/mocks/MockRepayUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../../scripts/utils/GasLimitUtils";
import {GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST} from "../../../baseUT/GasLimits";
import { HARDHAT_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';

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
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
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
    const bookkeeper = await MockHelper.createMockBookkeeper(signer);
    await tetuConverterController.setBookkeeper(bookkeeper.address);
    await bookkeeper.setCheckpoint([0, 0], [0, 0]);

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

  describe("requirePayAmountBack", () => {
    interface IRequirePayAmountBackParams {
      tokens: MockToken[];
      indexAsset?: number;
      initialStrategyBalances?: string[];
      investedAssets?: string;
      prices?: string[];

      theAsset: MockToken;
      /** Requested amount */
      amount: string;
      /** Amount of the asset to put on balance during the call of _makeRequestedAmount */
      amountToPutOnBalance?: string;

      senderIsNotConverter?: boolean;

      /** assume decimal 18 */
      depositorLiquidity?: string;

      /** sync with {tokens} */
      depositorQuoteExitAmounts?: string[];
    }

    interface IRequirePayAmountBackResults {
      amountOut: number;
      converterBalances: number[]; // depositorTokens = [dai, usdc, usdt];
      strategyBalances: number[]; // depositorTokens = [dai, usdc, usdt];
    }

    async function callRequirePayAmountBack(p: IRequirePayAmountBackParams): Promise<IRequirePayAmountBackResults> {
      const decimalsTheAsset = await p.theAsset.decimals();
      const decimals: number[] = await Promise.all(p.tokens.map(
        async t => t.decimals()
      ));

      const ms = await setupMockedStrategy({
        depositorTokens: p.tokens,
        depositorWeights: p.tokens.map(x => 1),
        depositorReserves: p.tokens.map(x => "1000"),
      });

      // setup initial balances
      if (p.initialStrategyBalances) {
        for (let i = 0; i < p.tokens.length; ++i) {
          await p.tokens[i].mint(ms.strategy.address, parseUnits(p.initialStrategyBalances[i], decimals[i]));
        }
      }

      // setup mocks
      await ms.strategy.setInvestedAssets(parseUnits(p.investedAssets || "0", decimals[p.indexAsset || 0]));
      const assetProvider = ethers.Wallet.createRandom().address;
      const amountToPutOnBalance = parseUnits(p.amountToPutOnBalance ?? "0", decimalsTheAsset);
      await p.theAsset.mint(assetProvider, amountToPutOnBalance);
      await p.theAsset.connect(
        await Misc.impersonate(assetProvider)
      ).approve(ms.strategy.address, amountToPutOnBalance);

      await ms.strategy.setMakeRequestedAmountParams(
        p.theAsset.address,
        assetProvider,
        amountToPutOnBalance,
        0 // not used int this test
      );

      await ms.strategy.setDepositorLiquidity(
        parseUnits(p?.depositorLiquidity || "0", 18)
      );
      await ms.strategy.setDepositorQuoteExit(
        parseUnits(p?.depositorLiquidity || "0", 18),
        await Promise.all(p.tokens.map(
          async (x, index) => parseUnits(
            p?.depositorQuoteExitAmounts
              ? p.depositorQuoteExitAmounts[index]
              : "0",
            decimals[index]
          )
        ))
      );

      // set up price oracle
      await setupPrices(
        ms.priceOracle,
        p.tokens,
        p.tokens.map((x, index) => p.prices ? p.prices[index] : "1")
      );

      const strategyAsSender = ms.strategy.connect(
        p.senderIsNotConverter
          ? await Misc.impersonate(ethers.Wallet.createRandom().address)
          : await Misc.impersonate(ms.tetuConverter.address)
      );
      const amountOut = await strategyAsSender.callStatic.requirePayAmountBack(p.theAsset.address, parseUnits(p.amount, decimalsTheAsset));
      console.log("requirePayAmountBack", p.theAsset.address, parseUnits(p.amount, decimalsTheAsset));
      await strategyAsSender.requirePayAmountBack(p.theAsset.address, parseUnits(p.amount, decimalsTheAsset));

      return {
        amountOut: +formatUnits(amountOut, decimalsTheAsset),
        converterBalances: await Promise.all(p.tokens.map(
          async (x, index) => +formatUnits(await x.balanceOf(ms.tetuConverter.address), decimals[index])
        )),
        strategyBalances: await Promise.all(p.tokens.map(
          async (x, index) => +formatUnits(await x.balanceOf(ms.strategy.address), decimals[index])
        ))
      }
    }

    describe("Good paths", () => {
      describe("There is enough asset on the balance", () => {
        describe("The asset is underlying", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackResults> {
            return callRequirePayAmountBack({
              tokens: [usdc, usdt],
              indexAsset: 0,

              amount: "99",
              theAsset: usdc,
              investedAssets: "10000",
              initialStrategyBalances: ["100", "0"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequirePayAmountBackTest);
            expect(r.amountOut).eq(99);
          });
          it("should set expected balance of USDC in converter", async () => {
            const r = await loadFixture(makeRequirePayAmountBackTest);
            expect(r.converterBalances[0]).eq(99);
          });
          it("should set expected balance of USDC in strategy", async () => {
            const r = await loadFixture(makeRequirePayAmountBackTest);
            expect(r.strategyBalances[0]).eq(1);
          });
        });
        describe("The asset is not underlying", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackResults> {
            return callRequirePayAmountBack({
              tokens: [usdc, usdt],
              indexAsset: 0,

              amount: "99",
              theAsset: usdt,
              investedAssets: "10000",
              initialStrategyBalances: ["0", "100"]
            });
          }

          it("should return expected amount", async () => {
            const r = await loadFixture(makeRequirePayAmountBackTest);
            expect(r.amountOut).eq(99);
          });
          it("should set expected balance of USDC in converter", async () => {
            const r = await loadFixture(makeRequirePayAmountBackTest);
            expect(r.converterBalances[1]).eq(99);
          });
          it("should set expected balance of USDC in strategy", async () => {
            const r = await loadFixture(makeRequirePayAmountBackTest);
            expect(r.strategyBalances[1]).eq(1);
          });
        });
      });

      describe("There is NOT enough asset on the balance", () => {
        describe("_makeRequestedAmount generates all requested amount", () => {
          describe("The asset is underlying", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackResults> {
              return callRequirePayAmountBack({
                tokens: [usdc, usdt],
                indexAsset: 0,

                amount: "100", // 100 is not enough, we need to have 100 + 1%, see GAP_WITHDRAW
                theAsset: usdc,
                initialStrategyBalances: ["100", "0"],

                amountToPutOnBalance: "10",

                investedAssets: "2",
                depositorLiquidity: "100",
                depositorQuoteExitAmounts: ["1", "1"]
              });
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(100);
            });
            it("should not send amount to converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterBalances[0]).eq(0);
            });
            it("should set expected balance of USDC in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyBalances[0]).eq(110);
            });
          });
          describe("The asset is not underlying", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackResults> {
              return callRequirePayAmountBack({
                tokens: [usdc, usdt],
                indexAsset: 0,

                amount: "100", // 100 is not enough, we need to have 100 + 1%, see GAP_WITHDRAW
                theAsset: usdt,
                initialStrategyBalances: ["500", "100"],

                amountToPutOnBalance: "20",

                investedAssets: "2",
                depositorLiquidity: "100",
                depositorQuoteExitAmounts: ["1", "1"]
              });
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(100);
            });
            it("should not change balance of not-underlying in converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterBalances[1]).eq(0);
            });
            it("should set expected balance of not-underlying in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyBalances[1]).eq(120);
            });
          });
        });
        describe("_makeRequestedAmount generates less amount than requested one", () => {
          describe("The asset is underlying", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackResults> {
              return callRequirePayAmountBack({
                tokens: [usdc, usdt],
                indexAsset: 0,

                amount: "100",
                theAsset: usdc,
                initialStrategyBalances: ["0", "1000"],

                amountToPutOnBalance: "18",

                investedAssets: "2",
                depositorLiquidity: "100",
                depositorQuoteExitAmounts: ["1", "1"]
              });
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(17.821782); // 18/(100000+1000)*100000
            });
            it("should not send amount to converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterBalances[0]).eq(0);
            });
            it("should set expected balance of USDC in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyBalances[0]).eq(18);
            });
          });
          describe("The asset is not underlying", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRequirePayAmountBackTest(): Promise<IRequirePayAmountBackResults> {
              return callRequirePayAmountBack({
                tokens: [usdc, usdt],
                indexAsset: 0,

                amount: "100",
                theAsset: usdt,
                initialStrategyBalances: ["500", "50"],

                amountToPutOnBalance: "10",

                investedAssets: "2",
                depositorLiquidity: "100",
                depositorQuoteExitAmounts: ["1", "1"]
              });
            }

            it("should return expected amount", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.amountOut).eq(59.40594); // (50 + 10)/(100000+1000)*100000
            });
            it("should not change balance of not-underlying in converter", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.converterBalances[1]).eq(0);
            });
            it("should set expected balance of not-underlying in strategy", async () => {
              const r = await loadFixture(makeRequirePayAmountBackTest);
              expect(r.strategyBalances[1]).eq(60);
            });
          });
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
        await expect(
          callRequirePayAmountBack({senderIsNotConverter: true, tokens: [usdc, usdt], amount: "100", theAsset: usdt})
        ).revertedWith("SB: Denied"); // DENIED
      });
      it('should revert if wrong asset', async () => {
        await expect(
          callRequirePayAmountBack({tokens: [usdc, usdt], amount: "100", theAsset: dai})
        ).revertedWith("TS-14 wrong asset"); // WRONG_ASSET
      });
      it("should revert if amount is zero", async () => {
        await expect(
          callRequirePayAmountBack({tokens: [usdc, usdt], amount: "0", theAsset: usdc})
        ).revertedWith("TS-24 zero value"); // ZERO_VALUE
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

  describe("_makeRequestedAmount", () => {
    interface IMakeRequestedAmountParams {
      requestedAmount: string;
      tokens: MockToken[];
      indexTheAsset: number;
      indexUnderlying?: number;

      balances?: string[];
      prices?: string[];

      liquidationThresholds?: string[];
      liquidations?: ILiquidationParams[];
      quoteRepays?: IQuoteRepayParams[];
      repays?: IRepayParams[];
      isConversionValid?: boolean;

      /** assume decimal 18 */
      depositorLiquidity?: string;

      quoteLiquidity?: string;
      /** sync with {tokens} */
      depositorQuoteExitAmounts?: string[];
    }

    interface IMakeRequestedAmountResults {
      expectedTotalAssetAmount: number;
      gasUsed: BigNumber;
      balances: number[];
    }

    async function makeRequestedAmount(p: IMakeRequestedAmountParams): Promise<IMakeRequestedAmountResults> {
      const ms = await setupMockedStrategy({
        depositorTokens: p.tokens,
        depositorReserves: p.tokens.map(x => "1000"),
        depositorWeights: p.tokens.map(x => 1),
        underlying: p.tokens[p.indexUnderlying || p.indexTheAsset]
      });

      // set up balances
      const decimals: number[] = await Promise.all(p.tokens.map(async x => x.decimals()));
      for (let i = 0; i < p.tokens.length; ++i) {
        // set up current balances
        if (p.balances) {
          await p.tokens[i].mint(ms.strategy.address, parseUnits(p.balances[i], decimals[i]));
        }
        // set up liquidation threshold for token
        if (p.liquidationThresholds) {
          await ms.strategy.setLiquidationThreshold(p.tokens[i].address, parseUnits(p.liquidationThresholds[i], decimals[i]));
        }
      }

      // set up price oracle
      await setupPrices(ms.priceOracle, p.tokens, p.prices ?? p.tokens.map(x => "1"));

      // set up repay and quoteRepay in converter
      if (p.repays) {
        for (const repay of p.repays) {
          await setupMockedRepay(ms.tetuConverter, ms.strategy.address, repay);
        }
      }
      if (p.quoteRepays) {
        for (const quoteRepay of p.quoteRepays) {
          await setupMockedQuoteRepay(ms.tetuConverter, ms.strategy.address, quoteRepay);
        }
      }

      // set up expected liquidations
      if (p.liquidations) {
        for (const liquidation of p.liquidations) {
          await setupMockedLiquidation(liquidator, liquidation);
          const isConversionValid = p.isConversionValid === undefined ? true : p.isConversionValid;
          await setupIsConversionValid(ms.tetuConverter, liquidation, isConversionValid)
        }
      }

      // set up pool
      const liquidity = parseUnits(p?.depositorLiquidity || "0", 18);
      const quoteLiquidity = parseUnits(p?.quoteLiquidity || "0", 18);
      const depositorExitAmountsOut = await Promise.all(p.tokens.map(
        async (x, index) => parseUnits(
          p?.depositorQuoteExitAmounts
            ? p.depositorQuoteExitAmounts[index]
            : "0",
          decimals[index]
        )
      ));
      await ms.strategy.setDepositorLiquidity(liquidity);
      await ms.strategy.setDepositorExit(liquidity, depositorExitAmountsOut);
      await ms.strategy.setDepositorQuoteExit(quoteLiquidity, depositorExitAmountsOut);

      // make test
      const ret = await ms.strategy.callStatic._makeRequestedAmountAccess(
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexTheAsset]),
        {
          converter: ms.tetuConverter.address,
          theAsset: p.tokens[p.indexTheAsset].address,
          tokens: p.tokens.map(x => x.address),
          indexTheAsset: p.indexTheAsset,
          balanceBefore: parseUnits(p.balances ? p.balances[p.indexTheAsset] : "0", decimals[p.indexTheAsset]),
          indexUnderlying: p.indexUnderlying ?? p.indexTheAsset,
        }
      );

      const tx = await ms.strategy._makeRequestedAmountAccess(
        p.requestedAmount === ""
          ? Misc.MAX_UINT
          : parseUnits(p.requestedAmount, decimals[p.indexTheAsset]),
        {
          converter: ms.tetuConverter.address,
          theAsset: p.tokens[p.indexTheAsset].address,
          tokens: p.tokens.map(x => x.address),
          indexTheAsset: p.indexTheAsset,
          balanceBefore: parseUnits(p.balances ? p.balances[p.indexTheAsset] : "0", decimals[p.indexTheAsset]),
          indexUnderlying: p.indexUnderlying ?? p.indexTheAsset
        }
      );
      const gasUsed = (await tx.wait()).gasUsed;
      return {
        expectedTotalAssetAmount: +formatUnits(ret, decimals[p.indexTheAsset]),
        gasUsed,
        balances: await Promise.all(
          p.tokens.map(
            async (token, index) => +formatUnits(await token.balanceOf(ms.strategy.address), decimals[index])
          )
        )
      }
    }

    describe("Good paths", () => {
      describe("TheAsset is underlying", () => {
        describe("Trivial case: NO liquidity, NO invested assets, NO not-underlying on balance", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callMakeRequestedAmount(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmount({
              tokens: [usdc, usdt],
              indexTheAsset: 0,
              requestedAmount: "1",
              balances: ["1", "0"]
            });
          }

          it("should return zero expectedTotalAssetAmount", async() => {
            const ret = await loadFixture(callMakeRequestedAmount);
            expect(ret.expectedTotalAssetAmount).eq(0);
          })
          it("should not change balances", async() => {
            const ret = await loadFixture(callMakeRequestedAmount);
            expect(ret.balances.join()).eq([1, 0].join());
          })
        });
        describe("NO liquidity, NO invested assets, YES not-underlying on balance", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callMakeRequestedAmount(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmount({
              tokens: [usdc, usdt],
              indexTheAsset: 0,
              requestedAmount: "1",
              balances: ["1", "7"],
              liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "7", amountOut: "9"}],
              prices: ["0.5", "2"]
            });
          }

          it("should return expected expectedTotalAssetAmount", async() => {
            const ret = await loadFixture(callMakeRequestedAmount);
            expect(ret.expectedTotalAssetAmount).eq(7*2/0.5);
          })
          it("should set expected balances", async() => {
            const ret = await loadFixture(callMakeRequestedAmount);
            expect(ret.balances.join()).eq([1+9, 0].join());
          })
        });
        describe("NO liquidity, YES invested assets, YES not-underlying on balance", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callMakeRequestedAmount(): Promise<IMakeRequestedAmountResults> {
            return makeRequestedAmount({
              tokens: [usdc, usdt],
              indexTheAsset: 0,
              requestedAmount: "1",
              balances: ["1", "7"],
              quoteRepays: [{collateralAsset: usdc, borrowAsset: usdt, amountRepay: "7", collateralAmountOut: "10"}],
              repays: [{collateralAsset: usdc, borrowAsset: usdt, totalDebtAmountOut: "7", totalCollateralAmountOut: "10"}],
            });
          }

          it("should return expected expectedTotalAssetAmount", async() => {
            const ret = await loadFixture(callMakeRequestedAmount);
            expect(ret.expectedTotalAssetAmount).eq(10);
          });
          it("should set expected balances", async() => {
            const ret = await loadFixture(callMakeRequestedAmount);
            expect(ret.balances.join()).eq([1+10, 0].join());
          });
        });
        describe("YES liquidity, YES invested assets, NO not-underlying on balance", () => {
          describe("Full withdraw of the liquidity from the pool", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function callMakeRequestedAmount(): Promise<IMakeRequestedAmountResults> {
              return makeRequestedAmount({
                tokens: [usdc, usdt],
                indexTheAsset: 0,
                requestedAmount: "15",
                balances: ["1", "0"],
                depositorLiquidity: "1",
                quoteLiquidity: "1",
                depositorQuoteExitAmounts: ["5", "6"],
                liquidations: [{tokenIn: usdt, tokenOut: usdc, amountIn: "6", amountOut: "7"}],
              });
            }

            it("should return expected expectedTotalAssetAmount", async() => {
              const ret = await loadFixture(callMakeRequestedAmount);

              // todo 11 or 6???
              expect(ret.expectedTotalAssetAmount).eq(5 + 6); // 6 * 1 / 1 - prices are equal in this test
            });
            it("should set expected balances", async() => {
              const ret = await loadFixture(callMakeRequestedAmount);
              expect(ret.balances.join()).eq([1 + 5 + 7, 0].join());
            });
          });
          describe("Parital withdraw of the liquidity from the pool", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
          });
        });
      });
      describe("TheAsset is not underlying", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });
      });
      describe("Withdraw all", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
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
        paidDebtToInsurance: string;
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
        parseUnits(p.handleRewardsResults.paidDebtToInsurance, assetDecimals[p.assetIndex]),
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
              paidDebtToInsurance: "0",
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
              paidDebtToInsurance: "0",
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
              paidDebtToInsurance: "0",
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
                paidDebtToInsurance: "0",
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
                paidDebtToInsurance: "99",
              },
              assetProviderBalance: "1000",
              callDoHardworkBySplitter: true,
              useMockedDepositToPoolUni: true
            });
          }

          it("should return expected lost and earned values", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.earned).to.eq(500 - 99);
            expect(result.lost).to.eq(450);
          });
          it("should set expected investedAssets value", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.investedAssetsBefore).to.eq(1000);
            expect(result.investedAssetsAfter).to.eq(6000);
          });
          it("doHardwork() should return expected results", async () => {
            const result = await loadFixture(makeTestThreeEarnedAmounts);
            expect(result.callDoHardwork?.earned).to.eq(500 - 99);
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
                paidDebtToInsurance: "0",
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
                  paidDebtToInsurance: "0",
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
                  paidDebtToInsurance: "0",
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
            paidDebtToInsurance: "0",
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

  describe('recycle', () => {
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

      const tx = await ms.strategy.recycleAccess(
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
          async (amount, index) => +formatUnits(amount, await IERC20Metadata__factory.connect(retForwarder.tokens[index], signer).decimals())
        )),
        forwarderTokens: retForwarder.tokens,
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
          expect(r.forwarderAmounts.join()).to.equal([18, 36, 72].join());
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
          expect(r.forwarderAmounts.join()).to.equal([18, 36, 72].join());
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
           *    also, 329 > 72, so bal is not sent to the forwarder
           */
          it('should return expected forwarderAmounts', async() => {
            const r = await loadFixture(makeRecycleTest);
            expect(r.forwarderAmounts.join()).to.equal([18, 36].join());
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
            expect(r.finalRewardTokenBalances.join()).to.equal([90-18, 180-36, 400].join()); // 200 - 20
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
            expect(r.forwarderAmounts.join()).to.equal([18, 36, 72].join());
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
            // threshold 500 > 36, so 36 usdc is not sent to the forwarder here
            expect(r.forwarderAmounts.join()).to.equal([18, 72].join());
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
            expect(r.finalRewardTokenBalances.join()).to.equal([90-18, 209.853659, 72-72].join()); // 180+288*34/328, 400*0.9*0.2
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
      describe("earnedByPrices has dust value (no changes)", () => {
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
            earnedByPrices: "0.09", // DEFAULT_LIQUIDATION_THRESHOLD = 100_000
            initialBalances: ["0", "712", "0"], // dai, usdc, usdt // 10 = initial amount, 702 - amount to deposit

            investedAssets: "1000000",

            reinvestThresholdPercent: 2,
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

  describe("_getTokensAccess", () => {
    let snapshotLocal: string;
    let ms: IStrategySetupResults;
    before(async function() {
      snapshotLocal = await TimeUtils.snapshot();
      ms = await setupMockedStrategy({depositorTokens: [dai, usdc, usdt]});
    });
    after(async function() {
      await TimeUtils.rollback(snapshotLocal);
    });
    it("should return 0", async () => {
      const ret = await ms.strategy._getTokensAccess(dai.address);
      expect(ret.indexAsset).eq(0);
    });
    it("should return 2", async () => {
      const ret = await ms.strategy._getTokensAccess(usdt.address);
      expect(ret.indexAsset).eq(2);
    });
    it("should revert if asset is unknown", async () => {
      await expect(ms.strategy._getTokensAccess(weth.address)).revertedWith("SB: Wrong value"); // StrategyLib2.WRONG_VALUE
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
