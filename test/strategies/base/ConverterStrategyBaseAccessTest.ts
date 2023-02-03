import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController, IStrategyV2, MockConverterStrategy, MockConverterStrategy__factory, MockTetuConverterController, MockTetuConverter, MockToken, PriceOracleMock, StrategySplitterV2, StrategySplitterV2__factory, TetuVaultV2, MockTetuLiquidatorSingleCall, ControllerV2__factory, IERC20Metadata__factory, MockForwarder} from "../../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {expect} from "chai";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_AFTER_DEPOSIT,
  GAS_CONVERTER_STRATEGY_BASE_AFTER_WITHDRAW_UPDATE_BASE_AMOUNTS,
  GAS_CONVERTER_STRATEGY_BASE_BEFORE_DEPOSIT,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW_ALL, GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST,
} from "../../baseUT/GasLimits";
import {Misc} from "../../../scripts/utils/Misc";

/**
 * Test of ConverterStrategyBase
 * using direct access to internal functions
 * through MockConverterStrategy
 */
describe("ConverterStrategyBaseAccessTest", () => {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
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
  before(async function () {
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
      parseUnits("1000", 18),
      parseUnits("1000", 6),
      parseUnits("1000", 6)
    ];

    controller = await DeployerUtilsLocal.getController(signer);
    tetuConverter = await MockHelper.createMockTetuConverter(signer);
    const strategyDeployer = async (_splitterAddress: string) => {
      const strategyLocal = MockConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'MockConverterStrategy'), governance);

      await strategyLocal.init(
        controller.address,
        _splitterAddress,
        tetuConverter.address,
        depositorTokens.map(x => x.address),
        depositorWeights,
        depositorReserves
      );

      return strategyLocal as unknown as IStrategyV2;
    }

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      usdc.address,
      "test",
      strategyDeployer,
      controller,
      governance,
      0, 100, 100,
      false
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
      [parseUnits("1", 18), parseUnits("1", 18), parseUnits("1", 18)]
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
  describe("_beforeDeposit", () => {
    interface IBeforeDepositTestResults {
      tokenAmounts: BigNumber[];
      borrowedAmounts: BigNumber[];
      spentCollateral: BigNumber;
      gasUsed: BigNumber;
    }
    async function makeBeforeDepositTest(
      inputAmount: BigNumber,
      borrowAmounts: BigNumber[],
      initialStrategyBalances?: BigNumber[]
    ) : Promise<IBeforeDepositTestResults> {
      // Set up Tetu Converter mock
      // we assume, that inputAmount will be divided on 3 equal parts
      const converter = ethers.Wallet.createRandom().address;
      for (let i = 0; i < depositorTokens.length; ++i) {
        if (initialStrategyBalances && initialStrategyBalances[i].gt(0)) {
          await depositorTokens[i].mint(tetuConverter.address, initialStrategyBalances[i]);
        }

        if (i === indexAsset) continue;
        await tetuConverter.setFindBorrowStrategyOutputParams(
          converter,
          borrowAmounts[i],
          parseUnits("1", 18),
          usdc.address,
          inputAmount.div(3),
          depositorTokens[i].address,
          1
        );
        await tetuConverter.setBorrowParams(
          converter,
          usdc.address,
          inputAmount.div(3),
          depositorTokens[i].address,
          borrowAmounts[i],
          strategy.address,
          borrowAmounts[i],
        );
        await depositorTokens[i].mint(tetuConverter.address, borrowAmounts[i]);
      }

      // Set up balances
      await usdc.mint(strategy.address, inputAmount);

      // call beforeDeposit
      const r = await strategy.callStatic._beforeDepositAccess(
        tetuConverter.address,
        inputAmount,
        depositorTokens.map(x => x.address),
        indexAsset
      );
      const tx = await strategy._beforeDepositAccess(
        tetuConverter.address,
        inputAmount,
        depositorTokens.map(x => x.address),
        indexAsset
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        borrowedAmounts: r.borrowedAmounts,
        spentCollateral: r.spentCollateral,
        tokenAmounts: r.tokenAmounts,
        gasUsed
      }
    }
    describe("Good paths", () => {
      describe("No dai and usdt on the strategy balance", () => {
        it("should return expected values", async () => {
          const inputAmount = parseUnits("900", 6);
          const borrowAmounts = [
            parseUnits("290", 18), // dai
            parseUnits("0", 6), // usdc, not used
            parseUnits("315", 6), // usdt
          ];
          const r = await makeBeforeDepositTest(inputAmount, borrowAmounts);

          const ret = [
            r.tokenAmounts.map(x => BalanceUtils.toString(x)).join(),
            r.borrowedAmounts.map(x => BalanceUtils.toString(x)).join(),
            r.spentCollateral.toString()
          ].join("\n");
          const expected = [
            [
              parseUnits("290", 18), // dai
              parseUnits("300", 6), // usdc
              parseUnits("315", 6), // usdt
            ].map(x => BalanceUtils.toString(x)).join(),
            borrowAmounts.map(x => BalanceUtils.toString(x)).join(),
            parseUnits("600", 6).toString()
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed the gas limit", async () => {
        const inputAmount = parseUnits("900", 6);
        const borrowAmounts = [
          parseUnits("290", 18), // dai
          parseUnits("0", 6), // usdc, not used
          parseUnits("315", 6), // usdt
        ];
        const r = await makeBeforeDepositTest(inputAmount, borrowAmounts);
        controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_BEFORE_DEPOSIT, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("_updateBaseAmounts - after deposit", () => {
    interface IAfterDepositTestResults {
      resultBaseAmounts: BigNumber[];
      gasUsed: BigNumber;
    }
    async function makeAfterDepositTest(
      initialBaseAmounts: BigNumber[],
      amountsConsumed: BigNumber[],
      borrowed: BigNumber[],
      collateral: BigNumber,
      balanceStrategy: BigNumber[]
    ) : Promise<IAfterDepositTestResults> {
      for (let i = 0; i < depositorTokens.length; ++i) {
        await strategy.setBaseAmountAccess(depositorTokens[i].address, initialBaseAmounts[i]);
        await depositorTokens[i].mint(strategy.address, balanceStrategy[i]);
      }

      const tx = await strategy._updateBaseAmountsAccess(
        depositorTokens.map(x => x.address),
        borrowed,
        amountsConsumed,
        indexAsset
      );
      const gasUsed1 = (await tx.wait()).gasUsed;
      const tx2 = await strategy._updateBaseAmountsForAssetAccesss(
        depositorTokens[indexAsset].address,
        collateral,
        false
      );
      const gasUsed2 = (await tx2.wait()).gasUsed;

      const resultBaseAmounts = await Promise.all(
        depositorTokens.map(
          async x => strategy.baseAmounts(x.address)
        )
      );

      return {
        resultBaseAmounts,
        gasUsed: gasUsed1.add(gasUsed2)
      }
    }
    describe("Good paths", () => {
      describe("Borrowed => consumed", () => {
        it("should return expected values", async () => {
          const initialBaseAmounts = [
            parseUnits("100", 18),
            parseUnits("1000", 6),
            parseUnits("50", 6),
          ];
          const amountsConsumed = [
            parseUnits("200", 18),
            parseUnits("210", 6),
            parseUnits("190", 6),
          ];
          const borrowed = [
            parseUnits("251", 18),
            parseUnits("0", 6),
            parseUnits("214", 6),
          ];
          const collateral = parseUnits("900", 6);
          const balanceStrategy = [
            parseUnits("151", 18), // 100 + 251 - 200
            parseUnits("100", 6), // 1000 - 900
            parseUnits("74", 6), // 50 + 214 - 190
          ];

          const r = await makeAfterDepositTest(
            initialBaseAmounts,
            amountsConsumed,
            borrowed,
            collateral,
            balanceStrategy
          );

          const ret = r.resultBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = balanceStrategy.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("Borrowed < consumed", () => {
        it("should return expected values", async () => {
          const initialBaseAmounts = [
            parseUnits("100", 18),
            parseUnits("1000", 6),
            parseUnits("50", 6),
          ];
          const amountsConsumed = [
            parseUnits("200", 18),
            parseUnits("210", 6),
            parseUnits("190", 6),
          ];
          const borrowed = [
            parseUnits("190", 18),
            parseUnits("0", 6),
            parseUnits("170", 6),
          ];
          const collateral = parseUnits("900", 6);
          const balanceStrategy = [
            parseUnits("90", 18), // 100 + 190 - 200
            parseUnits("100", 6), // 1000 - 900
            parseUnits("30", 6), // 50 + 170 - 190
          ];

          const r = await makeAfterDepositTest(
            initialBaseAmounts,
            amountsConsumed,
            borrowed,
            collateral,
            balanceStrategy
          );

          const ret = r.resultBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = balanceStrategy.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed the gas limit", async () => {
        const initialBaseAmounts = [
          parseUnits("100", 18),
          parseUnits("1000", 6),
          parseUnits("50", 6),
        ];
        const amountsConsumed = [
          parseUnits("200", 18),
          parseUnits("210", 6),
          parseUnits("190", 6),
        ];
        const borrowed = [
          parseUnits("251", 18),
          parseUnits("0", 6),
          parseUnits("214", 6),
        ];
        const collateral = parseUnits("900", 6);
        const balanceStrategy = [
          parseUnits("151", 18), // 100 + 251 - 200
          parseUnits("100", 6), // 1000 - 900
          parseUnits("74", 6), // 50 + 214 - 190
        ];

        const r = await makeAfterDepositTest(
          initialBaseAmounts,
          amountsConsumed,
          borrowed,
          collateral,
          balanceStrategy
        );

        controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_AFTER_DEPOSIT, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("_updateBaseAmounts - after withdraw", () => {
    interface IAfterWithdrawUpdateBaseAmountsTestResults {
      resultBaseAmounts: BigNumber[];
      gasUsed: BigNumber;
    }
    async function makeAfterWithdrawUpdateBaseAmountsTest(
      initialBaseAmounts: BigNumber[],
      withdrawnAmounts: BigNumber[],
      collateral: BigNumber,
      repaidAmounts: BigNumber[],
      balanceStrategy: BigNumber[]
    ) : Promise<IAfterWithdrawUpdateBaseAmountsTestResults> {
      for (let i = 0; i < depositorTokens.length; ++i) {
        await strategy.setBaseAmountAccess(depositorTokens[i].address, initialBaseAmounts[i]);
        await depositorTokens[i].mint(strategy.address, balanceStrategy[i]);
      }

      const tx = await strategy._updateBaseAmountsAccess(
        depositorTokens.map(x => x.address),
        withdrawnAmounts,
        repaidAmounts,
        indexAsset,
      );
      const gasUsed1 = (await tx.wait()).gasUsed;
      const tx2 = await strategy._updateBaseAmountsForAssetAccesss(
        depositorTokens[indexAsset].address,
        collateral.add(withdrawnAmounts[indexAsset]),
        true
      );
      const gasUsed2 = (await tx2.wait()).gasUsed;

      const resultBaseAmounts = await Promise.all(
        depositorTokens.map(
          async x => strategy.baseAmounts(x.address)
        )
      );

      return {
        resultBaseAmounts,
        gasUsed: gasUsed1.add(gasUsed2)
      }
    }
    describe("Good paths", () => {
      describe("withdrawnAmounts_ => repaidAmounts_", () => {
        it("should return expected values", async () => {
          const initialBaseAmounts = [
            parseUnits("100", 18),
            parseUnits("1000", 6),
            parseUnits("50", 6),
          ];
          const withdrawnAmounts = [
            parseUnits("400", 18),
            parseUnits("210", 6),
            parseUnits("490", 6),
          ];
          const repaidAmounts = [
            parseUnits("251", 18),
            parseUnits("0", 6),
            parseUnits("214", 6),
          ];
          const collateral = parseUnits("900", 6);
          const balanceStrategy = [
            parseUnits("249", 18), // 100 + 400 - 251
            parseUnits("2110", 6), // 1000 + 900 + 210
            parseUnits("326", 6), // 50 + 490 - 214
          ];

          const r = await makeAfterWithdrawUpdateBaseAmountsTest(
            initialBaseAmounts,
            withdrawnAmounts,
            collateral,
            repaidAmounts,
            balanceStrategy
          );

          const ret = r.resultBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = balanceStrategy.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("withdrawnAmounts_ < repaidAmounts_", () => {
        it("should return expected values", async () => {
          const initialBaseAmounts = [
            parseUnits("100", 18),
            parseUnits("1000", 6),
            parseUnits("50", 6),
          ];
          const withdrawnAmounts = [
            parseUnits("200", 18),
            parseUnits("210", 6),
            parseUnits("190", 6),
          ];
          const repaidAmounts = [
            parseUnits("251", 18),
            parseUnits("0", 6),
            parseUnits("214", 6),
          ];
          const collateral = parseUnits("900", 6);
          const balanceStrategy = [
            parseUnits("49", 18), // 100 + 200 - 251
            parseUnits("2110", 6), // 1000 + 900 + 210
            parseUnits("26", 6), // 50 + 190 - 214
          ];

          const r = await makeAfterWithdrawUpdateBaseAmountsTest(
            initialBaseAmounts,
            withdrawnAmounts,
            collateral,
            repaidAmounts,
            balanceStrategy
          );

          const ret = r.resultBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = balanceStrategy.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const initialBaseAmounts = [
          parseUnits("100", 18),
          parseUnits("1000", 6),
          parseUnits("50", 6),
        ];
        const withdrawnAmounts = [
          parseUnits("400", 18),
          parseUnits("210", 6),
          parseUnits("490", 6),
        ];
        const repaidAmounts = [
          parseUnits("251", 18),
          parseUnits("0", 6),
          parseUnits("214", 6),
        ];
        const collateral = parseUnits("900", 6);
        const balanceStrategy = [
          parseUnits("249", 18), // 100 + 400 - 251
          parseUnits("2110", 6), // 1000 + 900 + 210
          parseUnits("326", 6),  // 50 + 490 - 214
        ];

        const r = await makeAfterWithdrawUpdateBaseAmountsTest(
          initialBaseAmounts,
          withdrawnAmounts,
          collateral,
          repaidAmounts,
          balanceStrategy
        );
        controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_AFTER_WITHDRAW_UPDATE_BASE_AMOUNTS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("_convertAfterWithdraw", () => {
    interface IMakeConvertAfterWithdrawTestResults {
      repaidAmountsOut: BigNumber[];
      collateralOut: BigNumber;
      gasUsed: BigNumber;
    }
    interface IMakeConvertAfterWithdrawParams {
      returnedBorrowedAmountOut?: BigNumber[];
      swappedLeftoverCollateralOut?: BigNumber[];
      swappedLeftoverBorrowOut?: BigNumber[];
      priceOut?: BigNumber[];
      initialStrategyBalances?: BigNumber[];
    }
    async function makeConvertAfterWithdrawTest(
      amountsToConvert: BigNumber[],
      debts: BigNumber[],
      collaterals: BigNumber[],
      params?: IMakeConvertAfterWithdrawParams
    ) : Promise<IMakeConvertAfterWithdrawTestResults> {
      // Set up Tetu Converter mock and liquidator mock
      // we assume, that inputAmount will be divided on 3 equal parts
      for (let i = 0; i < depositorTokens.length; ++i) {
        if (params?.initialStrategyBalances) {
          await depositorTokens[i].mint(strategy.address, params?.initialStrategyBalances[i]);
        }
        if (i === indexAsset) continue;
        await tetuConverter.setGetDebtAmountCurrent(
          strategy.address,
          usdc.address,
          depositorTokens[i].address,
          debts[i],
          collaterals[i]
        );
        await tetuConverter.setRepay(
          usdc.address,
          depositorTokens[i].address,
          amountsToConvert[i].gt(debts[i])
            ? debts[i]
            : amountsToConvert[i],
          strategy.address,
          collaterals[i],
          params?.returnedBorrowedAmountOut ? params.returnedBorrowedAmountOut[i] : 0,
          params?.swappedLeftoverCollateralOut ? params.swappedLeftoverCollateralOut[i] : 0,
          params?.swappedLeftoverBorrowOut ? params.swappedLeftoverBorrowOut[i] : 0,
        );
        await depositorTokens[i].mint(strategy.address, amountsToConvert[i]);
        await usdc.mint(tetuConverter.address, collaterals[i]);

        if (amountsToConvert[i].gt(debts[i]) && params?.priceOut) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            depositorTokens[i].address,
            usdc.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            depositorTokens[i].address,
            usdc.address,
            pool,
            swapper,
            amountsToConvert[i].sub(debts[i]),
            params.priceOut[i]
          );
          await liquidator.setLiquidateWithRoute(
            depositorTokens[i].address,
            usdc.address,
            pool,
            swapper,
            amountsToConvert[i].sub(debts[i]),
            params.priceOut[i]
          );
          await usdc.mint(liquidator.address, params.priceOut[i]);
        }
      }

      // call convertAfterWithdraw
      const r = await strategy.callStatic._convertAfterWithdrawAccess(
        depositorTokens.map(x => x.address),
        indexAsset,
        amountsToConvert
      );
      const tx = await strategy._convertAfterWithdrawAccess(
        depositorTokens.map(x => x.address),
        indexAsset,
        amountsToConvert
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        collateralOut: r.collateralOut,
        repaidAmountsOut: r.repaidAmountsOut,
        gasUsed
      }
    }
    describe("Good paths", () => {
      describe("Repay only, no liquidation (amountsToConvert == repaidAmountsOut)", () => {
        it("should return expected values", async () => {
          const amountsToConvert = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("500", 6), // usdt
          ];
          const debts = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("900", 6), // usdt
          ];
          const collaterals = [
            parseUnits("401", 6),
            parseUnits("0", 6),
            parseUnits("1003", 6),
          ];
          const r = await makeConvertAfterWithdrawTest(
            amountsToConvert,
            debts,
            collaterals,
          );

          const ret = [
            r.collateralOut.toString(),
            r.repaidAmountsOut.map(x => BalanceUtils.toString(x)).join()
          ].join("\n");
          const expected = [
            parseUnits("1404", 6), // 401 + 1003
            [
              parseUnits("200", 18), // dai
              parseUnits("0", 6), // usdc, not used
              parseUnits("500", 6), // usdt
            ].map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("Repay + liquidation (amountsToConvert > repaidAmountsOut)", () => {
        it("should return expected values", async () => {
          const amountsToConvert = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("500", 6), // usdt
          ];
          const debts = [
            parseUnits("100", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("100", 6), // usdt
          ];
          const collaterals = [
            parseUnits("401", 6),
            parseUnits("0", 6),
            parseUnits("1003", 6),
          ];
          const r = await makeConvertAfterWithdrawTest(
            amountsToConvert,
            debts,
            collaterals,
            {
              priceOut: [
                parseUnits("717", 6),
                parseUnits("0", 6),
                parseUnits("999", 6),
              ]
            }
          );

          const ret = [
            r.collateralOut.toString(),
            r.repaidAmountsOut.map(x => BalanceUtils.toString(x)).join()
          ].join("\n");
          const expected = [
            parseUnits("3120", 6), // 401 + 1003 + 717 + 999
            [
              parseUnits("200", 18), // dai
              parseUnits("0", 6), // usdc, not used
              parseUnits("500", 6), // usdt
            ].map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          expect(ret).eq(expected);
        });
        describe("Not zero initial balances", () => {
          it("should return expected values", async () => {
            const amountsToConvert = [
              parseUnits("200", 18), // dai
              parseUnits("0", 6), // usdc
              parseUnits("500", 6), // usdt
            ];
            const debts = [
              parseUnits("100", 18), // dai
              parseUnits("0", 6), // usdc
              parseUnits("100", 6), // usdt
            ];
            const collaterals = [
              parseUnits("401", 6),
              parseUnits("0", 6),
              parseUnits("1003", 6),
            ];
            const r = await makeConvertAfterWithdrawTest(
              amountsToConvert,
              debts,
              collaterals,
              {
                initialStrategyBalances: [
                  parseUnits("2200", 18), // dai
                  parseUnits("2220", 6), // usdc
                  parseUnits("2222", 6), // usdt
                ],
                priceOut: [
                  parseUnits("717", 6),
                  parseUnits("0", 6),
                  parseUnits("999", 6),
                ]
              }
            );

            const ret = [
              r.collateralOut.toString(),
              r.repaidAmountsOut.map(x => BalanceUtils.toString(x)).join()
            ].join("\n");
            const expected = [
              parseUnits("3120", 6), // 401 + 1003 + 717 + 999
              [
                parseUnits("200", 18), // dai
                parseUnits("0", 6), // usdc, not used
                parseUnits("500", 6), // usdt
              ].map(x => BalanceUtils.toString(x)).join()
            ].join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      describe("Repay only, no liquidation", () => {
        it("should not exceed gas limits", async () => {
          const amountsToConvert = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("500", 6), // usdt
          ];
          const debts = [
            parseUnits("1200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("1900", 6), // usdt
          ];
          const collaterals = [
            parseUnits("401", 6),
            parseUnits("0", 6),
            parseUnits("1003", 6),
          ];
          const r = await makeConvertAfterWithdrawTest(
            amountsToConvert,
            debts,
            collaterals,
          );
          controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });
  });

  describe("_convertAfterWithdrawAll", () => {
    interface IMakeConvertAfterWithdrawTestResults {
      repaidAmountsOut: BigNumber[];
      collateralOut: BigNumber;
      gasUsed: BigNumber;
    }
    interface IMakeConvertAfterWithdrawParams {
      returnedBorrowedAmountOut?: BigNumber[];
      swappedLeftoverCollateralOut?: BigNumber[];
      swappedLeftoverBorrowOut?: BigNumber[];
      priceOut?: BigNumber[];
    }
    async function makeConvertAfterWithdrawTest(
      strategyBalances: BigNumber[],
      debts: BigNumber[],
      collaterals: BigNumber[],
      params?: IMakeConvertAfterWithdrawParams
    ) : Promise<IMakeConvertAfterWithdrawTestResults> {
      // Set up Tetu Converter mock and liquidator mock
      // we assume, that inputAmount will be divided on 3 equal parts
      for (let i = 0; i < depositorTokens.length; ++i) {
        if (i === indexAsset) continue;
        await tetuConverter.setGetDebtAmountCurrent(
          strategy.address,
          usdc.address,
          depositorTokens[i].address,
          debts[i],
          collaterals[i]
        );
        await tetuConverter.setRepay(
          usdc.address,
          depositorTokens[i].address,
          strategyBalances[i].gt(debts[i])
            ? debts[i]
            : strategyBalances[i],
          strategy.address,
          collaterals[i],
          params?.returnedBorrowedAmountOut ? params.returnedBorrowedAmountOut[i] : 0,
          params?.swappedLeftoverCollateralOut ? params.swappedLeftoverCollateralOut[i] : 0,
          params?.swappedLeftoverBorrowOut ? params.swappedLeftoverBorrowOut[i] : 0,
        );
        await depositorTokens[i].mint(strategy.address, strategyBalances[i]);
        await usdc.mint(tetuConverter.address, collaterals[i]);

        if (strategyBalances[i].gt(debts[i]) && params?.priceOut) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            depositorTokens[i].address,
            usdc.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            depositorTokens[i].address,
            usdc.address,
            pool,
            swapper,
            strategyBalances[i].sub(debts[i]),
            params.priceOut[i]
          );
          await liquidator.setLiquidateWithRoute(
            depositorTokens[i].address,
            usdc.address,
            pool,
            swapper,
            strategyBalances[i].sub(debts[i]),
            params.priceOut[i]
          );
          await usdc.mint(liquidator.address, params.priceOut[i]);
        }
      }

      // call convertAfterWithdraw
      const r = await strategy.callStatic._convertAfterWithdrawAllAccess(
        depositorTokens.map(x => x.address),
        indexAsset,
      );
      const tx = await strategy._convertAfterWithdrawAllAccess(
        depositorTokens.map(x => x.address),
        indexAsset,
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        collateralOut: r.collateralOut,
        repaidAmountsOut: r.repaidAmountsOut,
        gasUsed
      }
    }
    describe("Good paths", () => {
      describe("Repay only, no liquidation (amountsToConvert == repaidAmountsOut)", () => {
        it("should return expected values", async () => {
          const amountsToConvert = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("500", 6), // usdt
          ];
          const debts = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("900", 6), // usdt
          ];
          const collaterals = [
            parseUnits("401", 6),
            parseUnits("0", 6),
            parseUnits("1003", 6),
          ];
          const r = await makeConvertAfterWithdrawTest(
            amountsToConvert,
            debts,
            collaterals,
          );

          const ret = [
            r.collateralOut.toString(),
            r.repaidAmountsOut.map(x => BalanceUtils.toString(x)).join()
          ].join("\n");
          const expected = [
            parseUnits("1404", 6), // 401 + 1003
            [
              parseUnits("200", 18), // dai
              parseUnits("0", 6), // usdc, not used
              parseUnits("500", 6), // usdt
            ].map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("Repay + liquidation (amountsToConvert > repaidAmountsOut)", () => {
        it("should return expected values", async () => {
          const amountsToConvert = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("500", 6), // usdt
          ];
          const debts = [
            parseUnits("100", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("100", 6), // usdt
          ];
          const collaterals = [
            parseUnits("401", 6),
            parseUnits("0", 6),
            parseUnits("1003", 6),
          ];
          const r = await makeConvertAfterWithdrawTest(
            amountsToConvert,
            debts,
            collaterals,
            {
              priceOut: [
                parseUnits("717", 6),
                parseUnits("0", 6),
                parseUnits("999", 6),
              ]
            }
          );

          const ret = [
            r.collateralOut.toString(),
            r.repaidAmountsOut.map(x => BalanceUtils.toString(x)).join()
          ].join("\n");
          const expected = [
            parseUnits("3120", 6), // 401 + 1003 + 717 + 999
            [
              parseUnits("200", 18), // dai
              parseUnits("0", 6), // usdc, not used
              parseUnits("500", 6), // usdt
            ].map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      describe("Repay only, no liquidation", () => {
        it("should not exceed gas limits", async () => {
          const amountsToConvert = [
            parseUnits("200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("500", 6), // usdt
          ];
          const debts = [
            parseUnits("1200", 18), // dai
            parseUnits("0", 6), // usdc
            parseUnits("1900", 6), // usdt
          ];
          const collaterals = [
            parseUnits("401", 6),
            parseUnits("0", 6),
            parseUnits("1003", 6),
          ];
          const r = await makeConvertAfterWithdrawTest(
            amountsToConvert,
            debts,
            collaterals,
          );
          controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW_ALL, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });
  });

  describe("_prepareRewardsList", () => {
    interface IPrepareRewardsListTestResults {
      gasUsed: BigNumber;
      orderedByAmounts: {
        tokens: string[];
        amounts: BigNumber[];
      }
    }
    async function makePrepareRewardsListTest(
      tokensClaimedByDepositor: MockToken[],
      amountsClaimedByDepositor: BigNumber[],
      tokensClaimedByTetuConverter: MockToken[],
      amountsClaimedByTetuConverter: BigNumber[]
    ) : Promise<IPrepareRewardsListTestResults> {
      await tetuConverter.setClaimRewards(
        tokensClaimedByTetuConverter.map(x => x.address),
        amountsClaimedByTetuConverter
      );
      for (let i = 0; i < tokensClaimedByTetuConverter.length; ++i) {
        await tokensClaimedByTetuConverter[i].mint(tetuConverter.address, amountsClaimedByTetuConverter[i]);
      }
      for (let i = 0; i < tokensClaimedByDepositor.length; ++i) {
        await tokensClaimedByDepositor[i].mint(strategy.address, amountsClaimedByDepositor[i]);
      }

      const r = await strategy.callStatic._prepareRewardsListAccess(
        tetuConverter.address,
        tokensClaimedByDepositor.map(x => x.address),
        amountsClaimedByDepositor
      );
      console.log("r", r);
      const tx = await strategy._prepareRewardsListAccess(
        tetuConverter.address,
        tokensClaimedByDepositor.map(x => x.address),
        amountsClaimedByDepositor
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const pairsOrderedByAmounts = (await Promise.all([...Array(r.amountsOut.length).keys()].map(
        async index => ({
          token: r.tokensOut[index],
          amount: r.amountsOut[index],
          amountNum: +formatUnits(r.amountsOut[index], await IERC20Metadata__factory.connect(r.tokensOut[index], signer).decimals()),
        })
      ))).sort((a, b) => a.amountNum - b.amountNum);
      console.log("pairsOrderedByAmounts", pairsOrderedByAmounts)

      return {
        orderedByAmounts: {
          tokens: pairsOrderedByAmounts.map(x => x.token),
          amounts: pairsOrderedByAmounts.map(x => x.amount)
        },
        gasUsed
      }

    }
    describe("Good paths", () => {
      describe("Zero balances, zero base amounts, no zero amounts, no repeat tokens", () => {
        it("should return expected values", async () => {
          const tokensClaimedByDepositor = [usdc, usdt, dai];
          const amountsClaimedByDepositor = [
            parseUnits("1", 6),
            parseUnits("2", 6),
            parseUnits("3", 18)
          ];
          const tokensClaimedByTetuConverter = [tetu, bal];
          const amountsClaimedByTetuConverter = [
            parseUnits("4", 18),
            parseUnits("5", 18)
          ];

          const r = await makePrepareRewardsListTest(
            tokensClaimedByDepositor,
            amountsClaimedByDepositor,
            tokensClaimedByTetuConverter,
            amountsClaimedByTetuConverter
          );

          const ret = [
            r.orderedByAmounts.tokens.join(),
            r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          const expected = [
            [...tokensClaimedByDepositor, ...tokensClaimedByTetuConverter].map(x => x.address).join(),
            [...amountsClaimedByDepositor, ...amountsClaimedByTetuConverter].map(x => BalanceUtils.toString(x)).join()
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
      it("should filter out zero amounts", async () => {
        const tokensClaimedByDepositor = [usdc, usdt, dai];
        const amountsClaimedByDepositor = [
          parseUnits("1", 6),
          parseUnits("0", 6), // (!)
          parseUnits("3", 18)
        ];
        const tokensClaimedByTetuConverter = [tetu, bal];
        const amountsClaimedByTetuConverter = [
          parseUnits("0", 18), // (!)
          parseUnits("5", 18)
        ];

        const r = await makePrepareRewardsListTest(
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter
        );

        const ret = [
          r.orderedByAmounts.tokens.join(),
          r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        const expected = [
          [usdc, dai, bal].map(x => x.address).join(),
          [
            parseUnits("1", 6),
            parseUnits("3", 18),
            parseUnits("5", 18)
          ].map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        expect(ret).eq(expected);
      });
      it("should combine repeated tokens", async () => {
        const tokensClaimedByDepositor = [
          usdc,
          usdc, // (!)
          dai
        ];
        const amountsClaimedByDepositor = [
          parseUnits("10", 6),
          parseUnits("20", 6),
          parseUnits("1", 18)
        ];
        const tokensClaimedByTetuConverter = [
          tetu,
          tetu, // (!)
          usdc, // (!)
          bal
        ];
        const amountsClaimedByTetuConverter = [
          parseUnits("3", 18),
          parseUnits("4", 18),
          parseUnits("50", 6),
          parseUnits("2", 18)
        ];

        const r = await makePrepareRewardsListTest(
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter
        );

        const ret = [
          r.orderedByAmounts.tokens.join(),
          r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        const expected = [
          [dai, bal, tetu, usdc].map(x => x.address).join(),
          [
            parseUnits("1", 18),
            parseUnits("2", 18),
            parseUnits("7", 18),
            parseUnits("80", 6)
          ].map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        expect(ret).eq(expected);
      });
      it("should return current balances with subtracted base amounts", async () => {
        const tokensClaimedByDepositor = [usdc, usdt, dai];
        const amountsClaimedByDepositor = [
          parseUnits("1", 6),
          parseUnits("2", 6),
          parseUnits("3", 18)
        ];
        const tokensClaimedByTetuConverter = [tetu, bal];
        const amountsClaimedByTetuConverter = [
          parseUnits("4", 18),
          parseUnits("5", 18)
        ];
        const allTokens = [...tokensClaimedByDepositor, ...tokensClaimedByTetuConverter];
        const initialBalances = [
          parseUnits("5", 6),
          parseUnits("6", 6),
          parseUnits("7", 18),
          parseUnits("8", 18),
          parseUnits("9", 18)
        ];
        const baseAmounts = [
          parseUnits("4", 6),
          parseUnits("5", 6),
          parseUnits("6", 18),
          parseUnits("7", 18),
          parseUnits("8", 18)
        ];
        for (let i = 0; i < allTokens.length; ++i) {
          await allTokens[i].mint(strategy.address, initialBalances[i]);
          await strategy.setBaseAmountAccess(allTokens[i].address, baseAmounts[i]);
        }

        const r = await makePrepareRewardsListTest(
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter
        );

        const ret = [
          r.orderedByAmounts.tokens.join(),
          r.orderedByAmounts.amounts.map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        const expected = [
          allTokens.map(x => x.address).join(),
          [
            parseUnits("2", 6),
            parseUnits("3", 6),
            parseUnits("4", 18),
            parseUnits("5", 18),
            parseUnits("6", 18)
          ].map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        expect(ret).eq(expected);
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limit", async () => {
        const tokensClaimedByDepositor = [usdc, usdt, dai];
        const amountsClaimedByDepositor = [
          parseUnits("1", 6),
          parseUnits("0", 6),
          parseUnits("3", 18)
        ];
        const tokensClaimedByTetuConverter = [tetu, bal, usdc];
        const amountsClaimedByTetuConverter = [
          parseUnits("0", 18),
          parseUnits("5", 18),
          parseUnits("1", 6)
        ];

        const r = await makePrepareRewardsListTest(
          tokensClaimedByDepositor,
          amountsClaimedByDepositor,
          tokensClaimedByTetuConverter,
          amountsClaimedByTetuConverter
        );

        controlGasLimitsEx(r.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("_recycle", () => {
    interface IRecycleTestResults {
      gasUsed: BigNumber;

      forwarderTokens: string[];
      forwarderAmounts: BigNumber[];
    }
    async function makeRecycleTest(
      compoundRate: BigNumber,
      tokens: MockToken[],
      amounts: BigNumber[]
    ) : Promise<IRecycleTestResults> {
      await strategy.connect(await Misc.impersonate(await controller.platformVoter())).setCompoundRatio(compoundRate);

      for (let i = 0; i < tokens.length; ++i) {
        await tokens[i].mint(strategy.address, amounts[i]);
      }

      const tx = await strategy._recycleAccess(
        tokens.map(x => x.address),
        amounts
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const retForwarder = await forwarder.getLastRegisterIncomeResults();
      return {
        gasUsed,
        forwarderAmounts: retForwarder.amounts,
        forwarderTokens: retForwarder.tokens
      }
    }
    describe("Good paths", () => {
      it("should send expected values to forwarder", async () => {
        const tokens = [usdc, bal];
        const amounts = [parseUnits("10", 6), parseUnits("20", 18)];
        const compoundRate = BigNumber.from(30_000); // 30%

        const r = await makeRecycleTest(compoundRate, tokens, amounts);

        const ret = [
          r.forwarderTokens.join(),
          r.forwarderAmounts.map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        const expected = [
          tokens.map(x => x.address).join(),
          [parseUnits("7", 6), parseUnits("14", 18)].map(x => BalanceUtils.toString(x)).join()
        ].join("\n");

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
    // TODO
    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });
//endregion Unit tests
});