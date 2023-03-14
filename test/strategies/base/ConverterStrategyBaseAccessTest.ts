import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IController,
  IStrategyV2,
  MockConverterStrategy,
  MockConverterStrategy__factory,
  MockTetuConverterController,
  MockTetuConverter,
  MockToken,
  PriceOracleMock,
  StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2,
  MockTetuLiquidatorSingleCall,
  ControllerV2__factory,
  IERC20Metadata__factory,
  MockForwarder,
  BalancerComposableStableStrategy__factory, IERC20__factory
} from "../../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber, BigNumberish} from "ethers";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {expect} from "chai";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_AFTER_DEPOSIT,
  GAS_CONVERTER_STRATEGY_BASE_AFTER_WITHDRAW_UPDATE_BASE_AMOUNTS,
  GAS_CONVERTER_STRATEGY_BASE_BEFORE_DEPOSIT,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW_ALL,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_CLAIM,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_DEPOSIT_TO_POOL,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_RECYCLE,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_ALL,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_AMOUNT, GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_EMERGENCY,
} from "../../baseUT/GasLimits";
import {Misc} from "../../../scripts/utils/Misc";
import {UniversalTestUtils} from "../../baseUT/utils/UniversalTestUtils";

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
      parseUnits("1000", 18), // dai
      parseUnits("1000", 6),  // usdc
      parseUnits("1000", 6)   // usdt
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

//region Data types
  interface ILiquidationParams {
    tokenIn: MockToken;
    tokenOut: MockToken;
    amountIn: BigNumber;
    amountOut: BigNumber;
  }
  interface ITokenAmount {
    token: MockToken;
    amount: BigNumber;
  }
  interface IBorrowParams {
    collateralAsset: MockToken;
    collateralAmount: BigNumber;
    borrowAsset: MockToken;
    converter: string;
    maxTargetAmount: BigNumber;
  }
  interface IRepayParams {
    collateralAsset: MockToken;
    borrowAsset: MockToken;
    totalDebtAmountOut: BigNumber;
    totalCollateralAmountOut: BigNumber;
    amountRepay: BigNumber;
  }
//endregion Data types

//region Utils
  async function setupInvestedAssets(
    liquidityAmount: BigNumber,
    investedAssetsValue: BigNumber
  ) {
    await strategy.setDepositorQuoteExit(
      liquidityAmount,
      [
        0, // dai
        investedAssetsValue, // usdc
        0 // usdt
      ]
    );
    await tetuConverter.setQuoteRepay(
      strategy.address,
      usdc.address,
      dai.address,
      0,
      0
    );
    await tetuConverter.setQuoteRepay(
      strategy.address,
      usdc.address,
      usdt.address,
      0,
      0
    );
    await strategy.updateInvestedAssetsTestAccess();
    console.log("_investedAssets", await strategy.investedAssets(), investedAssetsValue);
  }
//endregion Utils

//region Unit tests
  describe("setReinvestThresholdPercent", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
        await strategy.connect(operator).setReinvestThresholdPercent(1012);
        const ret = await strategy.reinvestThresholdPercent();

        expect(ret).eq(1012);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not operator", async () => {
        const notOperator = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await expect(
          strategy.connect(notOperator).setReinvestThresholdPercent(1012)
        ).revertedWith("SB: Denied");
      });
      it("should revert if percent is too high", async () => {
        const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
        await expect(
          strategy.connect(operator).setReinvestThresholdPercent(100_001)
        ).revertedWith("SB: Wrong value"); // WRONG_VALUE
      });

    });
  });

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
          "0x",
          [converter],
          [inputAmount.div(3)],
          [borrowAmounts[i]],
          [parseUnits("1", 18)],
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
    describe("Bad paths", () => {
      it("should revert if borrowed amount is zero", async () => {
        const inputAmount = parseUnits("900", 6);
        const borrowAmounts = [
          parseUnits("0", 18), // dai (!) convertor is not able to borrow DAI
          parseUnits("0", 6), // usdc, not used
          parseUnits("315", 6), // usdt
        ];
        await expect(
          makeBeforeDepositTest(inputAmount, borrowAmounts)
        ).revertedWith("TS-10 zero borrowed amount"); // ZERO_AMOUNT_BORROWED
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
        indexAsset,
        -collateral
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const resultBaseAmounts = await Promise.all(
        depositorTokens.map(
          async x => strategy.baseAmounts(x.address)
        )
      );

      return {
        resultBaseAmounts,
        gasUsed
      }
    }
    describe("Good paths", () => {
      describe("Borrowed => consumed", () => {
        it("should return expected values", async () => {
          const initialBaseAmounts = [
            parseUnits("100", 18),
            parseUnits("1210", 6),
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
            parseUnits("100", 6), // 1210 - 900 - 210
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
            parseUnits("1210", 6),
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
            parseUnits("100", 6), // 1210 - 900 - 210
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
      describe("Real case", () => {
        it("should return expected values", async () => {
          const initialBaseAmounts = [
            parseUnits("0", 18),
            parseUnits("3000", 6),
            parseUnits("0", 6),
          ];
          const amountsConsumed = [
            parseUnits("830", 18),
            parseUnits("730", 6),
            parseUnits("910", 6),
          ];
          const borrowed = [
            parseUnits("850", 18),
            parseUnits("0", 6),
            parseUnits("950", 6),
          ];
          const collateral = parseUnits("2000", 6);
          const balanceStrategy = [
            parseUnits("20", 18),
            parseUnits("270", 6),
            parseUnits("40", 6),
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
          parseUnits("1210", 6),
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
          parseUnits("100", 6), // 1210 - 900 - 210
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
        collateral
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const resultBaseAmounts = await Promise.all(
        depositorTokens.map(
          async x => strategy.baseAmounts(x.address)
        )
      );

      return {
        resultBaseAmounts,
        gasUsed
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
      isConversionValid?: boolean;
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

          await tetuConverter.setIsConversionValid(
            depositorTokens[i].address,
            amountsToConvert[i].sub(debts[i]),
            usdc.address,
            params.priceOut[i],
            params.isConversionValid === undefined
              ? true
              : params.isConversionValid
          );
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
    describe("Bad paths", () => {
      describe("Liquidation of leftovers happens with too high price impact", () => {
        it("should revert", async () => {
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
          await expect(
            makeConvertAfterWithdrawTest(
              amountsToConvert,
              debts,
              collaterals,
              {
                priceOut: [
                  parseUnits("717", 6),
                  parseUnits("0", 6),
                  parseUnits("999", 6),
                ],
                isConversionValid: false
              }
            )
          ).revertedWith("TS-16 price impact"); // PRICE_IMPACT
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
      isConversionValid?: boolean;
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

          await tetuConverter.setIsConversionValid(
            depositorTokens[i].address,
            strategyBalances[i].sub(debts[i]),
            usdc.address,
            params.priceOut[i],
            params.isConversionValid === undefined
              ? true
              : params.isConversionValid
          );
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
    interface IRecycleTestParams {
      liquidations?: ILiquidationParams[];
      thresholds?: ITokenAmount[];
      baseAmounts?: ITokenAmount[];
      initialBalances?: ITokenAmount[];

      // disable performanceFee by default
      performanceFee?: number;
      // governance is used as a performance receiver by default
      performanceReceiver?: string;
    }

    interface IRecycleTestResults {
      gasUsed: BigNumber;

      forwarderTokens: string[];
      forwarderAmounts: BigNumber[];

      receivedAmounts: BigNumber[];
      spentAmounts: BigNumber[];
      receivedAssetAmountOut: BigNumber;
    }

    async function makeRecycleTest(
      compoundRate: BigNumberish,
      tokens: MockToken[],
      amounts: BigNumber[],
      params?: IRecycleTestParams
    ): Promise<IRecycleTestResults> {
      await strategy.connect(await Misc.impersonate(await controller.platformVoter())).setCompoundRatio(compoundRate);

      // disable performance fee by default
      await strategy.connect(await Misc.impersonate(await controller.governance())).setupPerformanceFee(
        params?.performanceFee || 0,
        params?.performanceReceiver || await controller.governance()
      );

      if (params?.baseAmounts) {
        for (const tokenAmount of params?.baseAmounts) {
          await strategy.setBaseAmountAccess(tokenAmount.token.address, tokenAmount.amount);
        }
      }
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(strategy.address, tokenAmount.amount);
        }
      }

      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidator.setLiquidateWithRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidation.tokenOut.mint(liquidator.address, liquidation.amountOut);
        }
      }

      if (params?.thresholds) {
        const operators = await ControllerV2__factory.connect(controller.address, signer).operatorsList();
        const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(
          strategy.address,
          await Misc.impersonate(operators[0])
        );
        for (const threshold of params?.thresholds) {
          await strategyAsOperator.setLiquidationThreshold(threshold.token.address, threshold.amount);
        }
      }

      for (let i = 0; i < tokens.length; ++i) {
        await tokens[i].mint(strategy.address, amounts[i]);
      }

      const r = await strategy.callStatic._recycleAccess(
        tokens.map(x => x.address),
        amounts
      );
      const tx = await strategy._recycleAccess(
        tokens.map(x => x.address),
        amounts
      );
      const gasUsed = (await tx.wait()).gasUsed;

      const retForwarder = await forwarder.getLastRegisterIncomeResults();
      return {
        gasUsed,
        forwarderAmounts: retForwarder.amounts,
        forwarderTokens: retForwarder.tokens,
        spentAmounts: r.spentAmounts,
        receivedAmounts: r.receivedAmounts.slice(0, -1),
        receivedAssetAmountOut: r.receivedAmounts[r.receivedAmounts.length - 1]
      }
    }

    describe("Good paths", () => {
      describe("All cases test", () => {
        let results: IRecycleTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeRecycleTestBase();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function makeRecycleTestBase(): Promise<IRecycleTestResults> {
          return makeRecycleTest(
            40_000, // 40%
            [bal, tetu, dai, usdc, weth],
            [
              parseUnits("10", 18),
              parseUnits("20", 18),
              parseUnits("40", 18),
              parseUnits("80", 6),
              parseUnits("100", 8),
            ],
            {
              liquidations: [
                {tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("5", 18), amountOut: parseUnits("17", 6)}, // 4 + 1
                {tokenIn: tetu, tokenOut: usdc, amountIn: parseUnits("11", 18), amountOut: parseUnits("23", 6)}, // 8 + 3
                {tokenIn: weth, tokenOut: usdc, amountIn: parseUnits("42", 8), amountOut: parseUnits("13", 6)}, // 40 + 2
              ],
              thresholds: [
                {token: bal, amount: parseUnits("4", 18)}, // ok
                {token: weth, amount: parseUnits("1", 8)}, // ok, (!) but it won't pass threshold by USDC
                {token: tetu, amount: parseUnits("12", 18)}, // (!) too high
                {token: usdc, amount: parseUnits("14", 6)},
              ],
              baseAmounts: [
                {token: bal, amount: parseUnits("1", 18)},
                {token: weth, amount: parseUnits("2", 8)},
                {token: tetu, amount: parseUnits("3", 18)},
                {token: usdc, amount: parseUnits("4", 6)},
                {token: dai, amount: parseUnits("5", 18)},
              ],
              initialBalances: [
                // any balances - just to be sure that _recycle doesn't use them
                {token: bal, amount: parseUnits("400", 18)},
                {token: weth, amount: parseUnits("500", 8)},
                {token: tetu, amount: parseUnits("600", 18)},
                {token: usdc, amount: parseUnits("700", 6)},
                {token: dai, amount: parseUnits("800", 18)},
              ],
            }
          );
        }

        it("should receive expected values", async () => {
          console.log("bal", bal.address);
          console.log("dai", dai.address);
          console.log("tetu", tetu.address);
          console.log("usdc", usdc.address);
          console.log("weth", weth.address);
          const ret = [
            results.receivedAmounts.map(x => BalanceUtils.toString(x)).join(),
            results.spentAmounts.map(x => BalanceUtils.toString(x)).join(),
            results.receivedAssetAmountOut.toString()
          ].join("\n");

          const expected = [
            [
              0, // compound bal tokens were liquidated
              parseUnits("8", 18), // compound tetu were not liquidated because of too high tetu liquidation threshold
              parseUnits("16", 18), // compound dai were added to base amounts
              parseUnits("32", 6), // compound usdc were added to base amounts
              parseUnits("40", 8), // compound weth were not liquidated because of too high usdc liquidation threshold
            ].map(x => BalanceUtils.toString(x)).join(),
            [
              parseUnits("1", 18), // base amount of bal was liquidated
              0,
              0,
              0,
              0
            ].map(x => BalanceUtils.toString(x)).join(),
            parseUnits("17", 6).toString() // results of bal liquidation
          ].join("\n");

          expect(ret).eq(expected);
        });
        it("should not exceed gas limit @skip-on-coverage", () => {
          controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_RECYCLE, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe("Reward token is in the list of depositor's assets", () => {
        describe("Reward token is the main asset", () => {
          it("should return receivedAmounts===amountToCompound", async () => {
            const r = await makeRecycleTest(30_000, [usdc], [parseUnits("10", 6)]);

            const ret = [r.receivedAmounts[0], r.spentAmounts[0], r.receivedAssetAmountOut].map(x => BalanceUtils.toString(x)).join();
            const expected = [parseUnits("3", 6), 0, 0].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
        describe("Reward token is the secondary asset", () => {
          it("should return receivedAmounts===amountToCompound", async () => {
            const r = await makeRecycleTest(30_000, [dai], [parseUnits("10", 18)]);

            const ret = [
              ...r.receivedAmounts,
              ...r.spentAmounts,
              r.receivedAssetAmountOut
            ].map(x => BalanceUtils.toString(x)).join();

            const expected = [
              parseUnits("3", 18),
              0,
              0
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });

        });
      });
      describe("Reward token is not in the list of depositor's assets", () => {
        describe("Liquidation thresholds allow liquidation", () => {
          it("should return expected amounts", async () => {
            const r = await makeRecycleTest(
              30_000,
              [bal],
              [parseUnits("10", 18)],
              {
                liquidations: [{
                  tokenIn: bal,
                  tokenOut: usdc,
                  amountIn: parseUnits("3", 18),
                  amountOut: parseUnits("17", 6)
                }]
              }
            );

            const ret = [
              ...r.receivedAmounts,
              ...r.spentAmounts,
              r.receivedAssetAmountOut
            ].map(x => BalanceUtils.toString(x)).join();

            const expected = [
              0,
              0,
              parseUnits("17", 6)
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
        describe("Liquidation threshold for main asset higher received amount", () => {
          it("should return expected amounts, base amount == 0", async () => {
            const r = await makeRecycleTest(
              30_000,
              [bal],
              [parseUnits("10", 18)],
              {
                liquidations: [{
                  tokenIn: bal,
                  tokenOut: usdc,
                  amountIn: parseUnits("3", 18),
                  amountOut: parseUnits("17", 6)
                }],
                thresholds: [
                  {
                    token: usdc,
                    amount: parseUnits("18", 6) // (!) too high
                  }
                ]
              }
            );

            const ret = [
              ...r.receivedAmounts,
              ...r.spentAmounts,
              r.receivedAssetAmountOut
            ].map(x => BalanceUtils.toString(x)).join();

            const expected = [
              parseUnits("3", 18),
              0,
              0,
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it("should return expected amounts, base amount > 0", async () => {
            const r = await makeRecycleTest(
              30_000,
              [bal],
              [parseUnits("10", 18)],
              {
                liquidations: [
                  // too possible liquidations: 3 (compound) and 3 + 5 (compound + base amount)
                  // second one should be used
                  {tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("3", 18), amountOut: parseUnits("17", 6)},
                  {tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("8", 18), amountOut: parseUnits("19", 6)},
                ],
                thresholds: [{
                  token: usdc,
                  amount: parseUnits("18", 6) // too high for 3, but ok for 8
                }],
                baseAmounts: [{
                  token: bal,
                  amount: parseUnits("5", 18)
                }],
                initialBalances: [{
                  token: bal,
                  amount: parseUnits("555", 18) // just to be sure that _recycle doesn't read balances
                }]
              }
            );

            const ret = [
              ...r.receivedAmounts,
              ...r.spentAmounts,
              r.receivedAssetAmountOut
            ].map(x => BalanceUtils.toString(x)).join();

            const expected = [
              0,
              parseUnits("5", 18),
              parseUnits("19", 6),
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
        describe("Liquidation threshold for the token is too high", () => {
          it("should return expected amounts, base amount == 0", async () => {
            const r = await makeRecycleTest(
              30_000,
              [bal],
              [parseUnits("10", 18)],
              {
                liquidations: [{
                  tokenIn: bal,
                  tokenOut: usdc,
                  amountIn: parseUnits("3", 18),
                  amountOut: parseUnits("17", 6)
                }],
                thresholds: [
                  {
                    token: bal,
                    amount: parseUnits("4", 18) // (!) too high
                  }
                ]
              }
            );

            const ret = [
              ...r.receivedAmounts,
              ...r.spentAmounts,
              r.receivedAssetAmountOut
            ].map(x => BalanceUtils.toString(x)).join();

            const expected = [
              parseUnits("3", 18),
              0,
              0,
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
          it("should return expected amounts, base amount > 0", async () => {
            const r = await makeRecycleTest(
              30_000,
              [bal],
              [parseUnits("10", 18)],
              {
                liquidations: [
                  // too possible liquidations: 3 (compound) and 3 + 5 (compound + base amount)
                  // second one should be used
                  {tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("3", 18), amountOut: parseUnits("17", 6)},
                  {tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("8", 18), amountOut: parseUnits("19", 6)},
                ],
                thresholds: [{
                  token: bal,
                  amount: parseUnits("4", 18) // too high for 3, but ok for 8
                }],
                baseAmounts: [{
                  token: bal,
                  amount: parseUnits("5", 18)
                }],
                initialBalances: [{
                  token: bal,
                  amount: parseUnits("555", 18) // just to be sure that _recycle doesn't read balances
                }]
              }
            );

            const ret = [
              ...r.receivedAmounts,
              ...r.spentAmounts,
              r.receivedAssetAmountOut
            ].map(x => BalanceUtils.toString(x)).join();

            const expected = [
              0,
              parseUnits("5", 18),
              parseUnits("19", 6),
            ].map(x => BalanceUtils.toString(x)).join();

            expect(ret).eq(expected);
          });
        });
      });

      describe("Performance fee not zero", () => {
        let results: IRecycleTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeRecycleTestBase();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function makeRecycleTestBase(): Promise<IRecycleTestResults> {
          return makeRecycleTest(
            40_000, // 40%
            [bal, tetu, dai, usdc, weth],
            [
              // performance fee is 10%
              parseUnits("10", 18), // 9 bal
              parseUnits("20", 18), // 18 tetu
              parseUnits("40", 18), // 36 dai
              parseUnits("80", 6),  // 72 usdc
              parseUnits("100", 8), // 90 weth
            ],
            {
              liquidations: [
                {tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("4.6", 18), amountOut: parseUnits("17", 6)}, // 3.6 + 1
                {tokenIn: tetu, tokenOut: usdc, amountIn: parseUnits("10.3", 18), amountOut: parseUnits("23", 6)}, // 7.2 + 3
                {tokenIn: weth, tokenOut: usdc, amountIn: parseUnits("38", 8), amountOut: parseUnits("13", 6)}, // 36 + 2
              ],
              thresholds: [
                {token: bal, amount: parseUnits("4", 18)}, // ok
                {token: weth, amount: parseUnits("1", 8)}, // ok, (!) but it won't pass threshold by USDC
                {token: tetu, amount: parseUnits("11", 18)}, // (!) too high
                {token: usdc, amount: parseUnits("14", 6)},
              ],
              baseAmounts: [
                {token: bal, amount: parseUnits("1", 18)},
                {token: weth, amount: parseUnits("2", 8)},
                {token: tetu, amount: parseUnits("3", 18)},
                {token: usdc, amount: parseUnits("4", 6)},
                {token: dai, amount: parseUnits("5", 18)},
              ],
              initialBalances: [
                // any balances - just to be sure that _recycle doesn't use them
                {token: bal, amount: parseUnits("400", 18)},
                {token: weth, amount: parseUnits("500", 8)},
                {token: tetu, amount: parseUnits("600", 18)},
                {token: usdc, amount: parseUnits("700", 6)},
                {token: dai, amount: parseUnits("800", 18)},
              ],
              // enable performance fee
              performanceFee: 10_000,
              performanceReceiver: ethers.Wallet.createRandom().address
            }
          );
        }

        it("should receive expected values", async () => {
          console.log("bal", bal.address);
          console.log("dai", dai.address);
          console.log("tetu", tetu.address);
          console.log("usdc", usdc.address);
          console.log("weth", weth.address);

          const performanceReceiverBalances = await Promise.all(
            [bal, tetu, dai, usdc, weth].map(
              async token => token.balanceOf(await strategy.performanceReceiver())
            )
          );
          const ret = [
            performanceReceiverBalances.map(x => BalanceUtils.toString(x)).join(),
            results.receivedAmounts.map(x => BalanceUtils.toString(x)).join(),
            results.spentAmounts.map(x => BalanceUtils.toString(x)).join(),
            results.receivedAssetAmountOut.toString(),
          ].join("\n");

          const expected = [
            [
              // performance fee is 10%
              parseUnits("1", 18), // bal
              parseUnits("2", 18), // tetu
              parseUnits("4", 18), // dai
              parseUnits("8", 6),  // usdc
              parseUnits("10", 8), // weth
            ],
            [
              0, // compound bal tokens were liquidated
              parseUnits("7.2", 18), // compound tetu were not liquidated because of too high tetu liquidation threshold
              parseUnits("14.4", 18), // compound dai 14.4 were added to base amounts
              parseUnits("28.8", 6), // compound usdc 28.8 were added to base amounts
              parseUnits("36", 8), // compound weth were not liquidated because of too high usdc liquidation threshold
            ].map(x => BalanceUtils.toString(x)).join(),
            [
              parseUnits("1", 18), // base amount of bal was liquidated
              0,
              0,
              0,
              0
            ].map(x => BalanceUtils.toString(x)).join(),
            parseUnits("17", 6).toString() // results of bal liquidation
          ].join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      // TODO
    });
  });

  describe("_doHardWork", () => {
    describe("Good paths", () => {
      it("should return expected values, positive reinvest", async () => {
        const assetProvider = ethers.Wallet.createRandom();
        await usdc.mint(assetProvider.address, parseUnits("1000", 6));
        await usdc.connect(await Misc.impersonate(assetProvider.address)).approve(strategy.address, Misc.MAX_UINT);

        await strategy.setMockedDepositToPool(
          parseUnits("8", 6), // balance change
          assetProvider.address,
          0
        );
        await strategy.setDepositorLiquidity(parseUnits("1", 18));
        await strategy.setDepositorQuoteExit(
          parseUnits("1", 18),
          [
            parseUnits("0", 18),
            parseUnits("23", 6),
            parseUnits("0", 6)
          ]
        );

        await strategy.setMockedHandleRewardsResults(
          parseUnits("7", 6), // earned
          parseUnits("14", 6), // lost
          parseUnits("17", 6), // asset balance change
          assetProvider.address
        );

        const r = await strategy.callStatic._doHardWorkAccess(true);
        const ret = [
          r.earned.toString(),
          r.lost.toString()
        ].join();
        const expected = [
          parseUnits("38", 6).toString(), // 8 + 7 + 23
          parseUnits("14", 6).toString()
        ].join();

        expect(ret).eq(expected);
      });
      it("should return expected values, negative reinvest", async () => {
        const assetProvider = ethers.Wallet.createRandom();
        await usdc.mint(assetProvider.address, parseUnits("1000", 6));
        await usdc.connect(await Misc.impersonate(assetProvider.address)).approve(strategy.address, Misc.MAX_UINT);

        await strategy.setMockedDepositToPool(
          parseUnits("-8", 6),
          assetProvider.address,
          0
        );
        await strategy.setDepositorLiquidity(parseUnits("1", 18));
        await strategy.setDepositorQuoteExit(
          parseUnits("1", 18),
          [
            parseUnits("0", 18),
            parseUnits("23", 6),
            parseUnits("0", 6)
          ]
        );

        await strategy.setMockedHandleRewardsResults(
          parseUnits("7", 6), // earned
          parseUnits("14", 6), // lost
          parseUnits("17", 6),
          assetProvider.address
        );

        const r = await strategy.callStatic._doHardWorkAccess(true);
        const ret = [
          r.earned.toString(),
          r.lost.toString()
        ].join();
        const expected = [
          parseUnits("30", 6).toString(), // 7 + 23
          parseUnits("22", 6).toString() // 14 + 8
        ].join();

        expect(ret).eq(expected);
      });
    });
  });

  describe("_claim", () => {
    interface IClaimTestParams {
      liquidations?: ILiquidationParams[];
      thresholds?: ITokenAmount[];
      baseAmounts?: ITokenAmount[];
      initialBalances?: ITokenAmount[];

      // disable performanceFee by default
      performanceFee?: number;
      // governance is used as a performance receiver by default
      performanceReceiver?: string;
    }
    interface IClaimTestResults {
      gasUsed: BigNumber;

      /** Full list of all reward tokens === distinct(depositorRewardTokens + tetuConverterRewardTokens) */
      rewardTokens: string[];

      baseAmounts: BigNumber[];
      strategyBalances: BigNumber[];
      forwarderBalances: BigNumber[];
    }
    async function makeClaimTest(
      compoundRate: BigNumberish,
      depositorRewardTokens: MockToken[],
      depositorRewardAmounts: BigNumber[],
      tetuConverterRewardTokens: MockToken[],
      tetuConverterRewardAmounts: BigNumber[],
      params?: IClaimTestParams
    ) : Promise<IClaimTestResults> {
      // disable performance fee by default
      await strategy.connect(await Misc.impersonate(await controller.governance())).setupPerformanceFee(
        params?.performanceFee || 0,
        params?.performanceReceiver || await controller.governance()
      );
      await strategy.setDepositorClaimRewards(
        depositorRewardTokens.map(x => x.address),
        depositorRewardAmounts
      );
      await tetuConverter.setClaimRewards(
        tetuConverterRewardTokens.map(x => x.address),
        tetuConverterRewardAmounts
      );
      for (let i = 0; i < tetuConverterRewardTokens.length; ++i) {
        await tetuConverterRewardTokens[i].mint(tetuConverter.address, tetuConverterRewardAmounts[i]);
      }

      await strategy.connect(await Misc.impersonate(await controller.platformVoter())).setCompoundRatio(compoundRate);

      if (params?.baseAmounts) {
        for (const tokenAmount of params?.baseAmounts) {
          await strategy.setBaseAmountAccess(tokenAmount.token.address, tokenAmount.amount);
        }
      }
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(strategy.address, tokenAmount.amount);
        }
      }
      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidator.setLiquidateWithRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidation.tokenOut.mint(liquidator.address, liquidation.amountOut);
        }
      }
      if (params?.thresholds) {
        const operators = await ControllerV2__factory.connect(controller.address, signer).operatorsList();
        const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(
          strategy.address,
          await Misc.impersonate(operators[0])
        );
        for (const threshold of params?.thresholds) {
          await strategyAsOperator.setLiquidationThreshold(threshold.token.address, threshold.amount);
        }
      }

      // get list of all reward tokens
      const allAddresses = [
        ...depositorRewardTokens.map(x => x.address),
        ...tetuConverterRewardTokens.map(x => x.address)
      ];
      const rewardTokenAddresses = [
        ...new Set(// use Set to exclude duplicates, see https://stackoverflow.com/questions/1960473/get-all-unique-values-in-a-javascript-array-remove-duplicates
          allAddresses
        )
      ];

      // sort the list by token names
      const rewardTokensWithNames = (await Promise.all(
        rewardTokenAddresses.map(
          async rewardTokenAddress => ({
            tokenAddress: rewardTokenAddress,
            tokenName: await IERC20Metadata__factory.connect(rewardTokenAddress, signer).name()
          })
        )
      )).sort(
        (t1, t2) => t1.tokenName.localeCompare(t2.tokenName)
      );
      console.log("rewardTokensWithNames", rewardTokensWithNames);

      const rewardTokensOrderedByNames = rewardTokensWithNames.map(x => x.tokenAddress);


      const tx = await strategy.claim();
      const gasUsed = (await tx.wait()).gasUsed;


      const baseAmounts = await Promise.all(rewardTokensOrderedByNames.map(
        async rewardToken => strategy.baseAmounts(rewardToken)
      ));
      const forwarderBalances = await Promise.all(rewardTokensOrderedByNames.map(
        async rewardToken => IERC20__factory.connect(rewardToken, signer).balanceOf(forwarder.address)
      ));
      const strategyBalances = await Promise.all(rewardTokensOrderedByNames.map(
        async rewardToken => IERC20__factory.connect(rewardToken, signer).balanceOf(strategy.address)
      ));

      return {
        gasUsed,
        rewardTokens: rewardTokensOrderedByNames,
        forwarderBalances,
        strategyBalances,
        baseAmounts
      }
    }

    describe("Good paths", () => {
      describe("All cases", () => {
        let results: IClaimTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();

          const depositorRewardTokens = [usdc, usdt, dai, tetu];
          const depositorRewardAmounts = [
            parseUnits("1", 6), // usdc
            parseUnits("40", 6), // usdt
            parseUnits("4", 18), // dai
            parseUnits("4", 18), // tetu
          ]
          const tetuConverterRewardTokens = [usdc, tetu, bal, weth];
          const tetuConverterRewardAmounts = [
            parseUnits("19", 6), // usdc
            parseUnits("6", 18), // tetu
            parseUnits("20", 18), // bal
            parseUnits("30", 8), // weth
          ]

          results = await makeClaimTest(
            40_000, // compound ratio
            depositorRewardTokens,
            depositorRewardAmounts,
            tetuConverterRewardTokens,
            tetuConverterRewardAmounts,
            {
              baseAmounts: [
                {token: usdc, amount: parseUnits("1000", 6)},
                {token: usdt, amount: parseUnits("2000", 6)},
                {token: dai, amount: parseUnits("3000", 18)},
                {token: tetu, amount: parseUnits("1000", 18)}, // (!) airdrops
                {token: bal, amount: parseUnits("5000", 18)},
                {token: weth, amount: parseUnits("6000", 8)},
              ],
              initialBalances: [
                {token: usdc, amount: parseUnits("1000", 6)},
                {token: usdt, amount: parseUnits("2000", 6)},
                {token: dai, amount: parseUnits("3000", 18)},
                {token: tetu, amount: parseUnits("5000", 18)},
                {token: bal, amount: parseUnits("5000", 18)},
                {token: weth, amount: parseUnits("6000", 8)},
              ],
              liquidations: [
                {tokenIn: bal, tokenOut: usdc, amountIn:  parseUnits("5008", 18),  amountOut: parseUnits("17", 6)},
                {tokenIn: tetu, tokenOut: usdc, amountIn:  parseUnits("2604", 18),  amountOut: parseUnits("23", 6)},
                {tokenIn: weth, tokenOut: usdc, amountIn:  parseUnits("6012", 8),  amountOut: parseUnits("41", 6)},
              ]
            }
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should send expected values to forwarder", async () => {
          const expectedRewardTokens = [bal, dai, tetu, usdc, usdt, weth]; // ordered by names
          const expectedForwarderBalances = [
            parseUnits("12", 18), // bal
            parseUnits("2.4", 18), // dai
            parseUnits("2406", 18), // tetu
            parseUnits("12", 6), // usdc
            parseUnits("24", 6), // usdt
            parseUnits("18", 8), // weth
          ];
          const ret = [
            results.rewardTokens.join(),
            results.forwarderBalances.map(x => BalanceUtils.toString(x))
          ].join("\n");

          const expected = [
            expectedRewardTokens.map(x => x.address).join(),
            expectedForwarderBalances.map(x => BalanceUtils.toString(x))
          ].join("\n");

          expect(ret).eq(expected);
        });
        it("should update base amounts", async () => {
          const expectedRewardTokens = [bal, dai, tetu, usdc, usdt, weth]; // ordered by names
          const expectedBaseAmounts = [
            parseUnits("0", 18), // bal
            parseUnits("3001.6", 18), // dai
            parseUnits("0", 18), // tetu
            parseUnits("1089", 6), // usdc
            parseUnits("2016", 6), // usdt
            parseUnits("0", 8), // weth
          ];
          const ret = [
            results.rewardTokens.join(),
            results.baseAmounts.map(x => BalanceUtils.toString(x))
          ].join("\n");

          const expected = [
            expectedRewardTokens.map(x => x.address).join(),
            expectedBaseAmounts.map(x => BalanceUtils.toString(x))
          ].join("\n");

          expect(ret).eq(expected);
        });
        it("should update strategy balances in proper way", async () => {
          const expectedRewardTokens = [bal, dai, tetu, usdc, usdt, weth]; // ordered by names
          const expectedStrategyBalances = [
            parseUnits("0", 18), // bal
            parseUnits("3001.6", 18), // dai
            parseUnits("0", 18), // tetu
            parseUnits("1089", 6), // usdc
            parseUnits("2016", 6), // usdt
            parseUnits("0", 8), // weth
          ];
          const ret = [
            results.rewardTokens.join(),
            results.strategyBalances.map(x => BalanceUtils.toString(x))
          ].join("\n");

          const expected = [
            expectedRewardTokens.map(x => x.address).join(),
            expectedStrategyBalances.map(x => BalanceUtils.toString(x))
          ].join("\n");

          expect(ret).eq(expected);
        });
        it("Gas estimation @skip-on-coverage", async () => {
          controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_CLAIM, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });
    describe("Bad paths", () => {
// TODO
    });
  });

  describe("_depositToPool", () => {
    interface IDepositToPoolTestParams {
      liquidations?: ILiquidationParams[];
      baseAmounts?: ITokenAmount[];
      initialBalances?: ITokenAmount[];
      borrows?: IBorrowParams[];
      updateTotalAssetsBeforeInvest?: boolean;
    }
    interface IDepositToPoolTestResults {
      gasUsed: BigNumber;

      baseAmounts: BigNumber[];
      strategyBalances: BigNumber[];

      investedAssetsValueBefore: BigNumber;
      investedAssetsValueAfter: BigNumber;

      totalAssetsDelta: BigNumber;
    }
    async function makeDepositToPoolTest(
      amount: BigNumber,
      reinvestThresholdPercent: BigNumberish, // TODO use it
      desiredAmounts: BigNumber[],
      consumedAmounts: BigNumber[],
      liquidityOut: BigNumber,
      params?: IDepositToPoolTestParams
    ) : Promise<IDepositToPoolTestResults> {
      await strategy.setDepositorLiquidity(parseUnits("1", 18));
      await strategy.setDepositorQuoteExit(// calc before deposit
        parseUnits("1", 18),
        [
          parseUnits("0", 18),
          parseUnits("23", 6),
          parseUnits("0", 6)
        ]
      );
      await strategy.setDepositorQuoteExit(// calc after deposit
        parseUnits("2", 18),
        [
          parseUnits("0", 18),
          parseUnits("23", 6),
          parseUnits("0", 6)
        ]
      );
      if (params?.baseAmounts) {
        for (const tokenAmount of params?.baseAmounts) {
          await strategy.setBaseAmountAccess(tokenAmount.token.address, tokenAmount.amount);
        }
      }
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(strategy.address, tokenAmount.amount);
        }
      }
      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidator.setLiquidateWithRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidation.tokenOut.mint(liquidator.address, liquidation.amountOut);
        }
      }
      if (params?.borrows) {
        for (const borrow of params.borrows) {
          await tetuConverter.setFindBorrowStrategyOutputParams(
            "0x",
            [borrow.converter],
            [borrow.collateralAmount],
            [borrow.maxTargetAmount],
            [1], // apr18
            borrow.collateralAsset.address,
            borrow.collateralAmount,
            borrow.borrowAsset.address,
            1 // period
          );
          await tetuConverter.setBorrowParams(
            borrow.converter,
            borrow.collateralAsset.address,
            borrow.collateralAmount,
            borrow.borrowAsset.address,
            borrow.maxTargetAmount,
            strategy.address,
            borrow.maxTargetAmount
          );
          await borrow.borrowAsset.mint(tetuConverter.address, borrow.maxTargetAmount);
        }
      }

      await depositorTokens[indexAsset].mint(strategy.address, amount);
      await strategy.setDepositorEnter(
        desiredAmounts,
        consumedAmounts,
        liquidityOut
      );

      await setupInvestedAssets(liquidityOut, parseUnits("1", 18));
      const investedAssetsValueBefore = await strategy.investedAssets();

      const totalAssetsDelta = await strategy.callStatic._depositToPoolAccess(amount, params?.updateTotalAssetsBeforeInvest || false);

      const tx = await strategy._depositToPoolAccess(amount, params?.updateTotalAssetsBeforeInvest || false);
      const gasUsed = (await tx.wait()).gasUsed;

      const baseAmounts = await Promise.all(depositorTokens.map(
        async token => strategy.baseAmounts(token.address)
      ));
      const strategyBalances = await Promise.all(depositorTokens.map(
        async token => IERC20__factory.connect(token.address, signer).balanceOf(strategy.address)
      ));

      return {
        gasUsed,
        strategyBalances,
        baseAmounts,
        investedAssetsValueBefore,
        investedAssetsValueAfter: await strategy.investedAssets(),
        totalAssetsDelta
      }
    }

    describe("Good paths", () => {
      describe("All cases", () => {
        let results: IDepositToPoolTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeDepositToPoolTest(
            parseUnits("3000", 6),
            0,
            [
              parseUnits("850", 18), // dai
              parseUnits("1000", 6), // usdc
              parseUnits("950", 6), // usdt
            ],
            [
              parseUnits("830", 18),
              parseUnits("730", 6),
              parseUnits("910", 6),
            ],
            parseUnits("1", 18), // liquidity
            {
              baseAmounts: [
                {token: dai, amount: parseUnits("0", 18)},
                {token: usdc, amount: parseUnits("3000", 6)},
                {token: usdt, amount: parseUnits("0", 6)},
              ],
              borrows: [
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("1000", 6),
                  borrowAsset: dai,
                  maxTargetAmount: parseUnits("850", 18),
                  converter: ethers.Wallet.createRandom().address
                },
                {
                  collateralAsset: usdc,
                  collateralAmount: parseUnits("1000", 6),
                  borrowAsset: usdt,
                  maxTargetAmount: parseUnits("950", 6),
                  converter: ethers.Wallet.createRandom().address
                },
              ]
            }
          )
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should update base amounts", async () => {
          const expectedBaseAmounts = [
            parseUnits("20", 18), // dai == 850 - 830
            parseUnits("270", 6), // usdc == (1000 - 730)
            parseUnits("40", 6), // usdt = 950 - 910
          ];

          const ret = results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = expectedBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should update strategy balances", async () => {
          const expectedBalances = [
            parseUnits("20", 18), // dai == 850 - 830
            parseUnits("270", 6), // usdc == (1000 - 730)
            parseUnits("40", 6), // usdt = 950 - 910
          ];

          const ret = results.strategyBalances.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = expectedBalances.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should call _updateInvestedAssets", async () => {
          expect(results.investedAssetsValueBefore.eq(results.investedAssetsValueAfter)).eq(false);
        });
        it("Gas estimation @skip-on-coverage", async () => {
          controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_DEPOSIT_TO_POOL, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
        it("Should return zero totalAssetsDelta", async () => {
          expect(results.totalAssetsDelta.eq(0)).eq(true);
        });
      });
    });
    describe("Bad paths", () => {
// TODO
    });
  });

  describe("withdraw", () => {
    interface IWithdrawTestParams {
      investedAssetsBeforeWithdraw: BigNumber;
      investedAssetsAfterWithdraw: BigNumber;
      liquidations?: ILiquidationParams[];
      baseAmounts?: ITokenAmount[];
      initialBalances?: ITokenAmount[];
      repayments?: IRepayParams[];
      emergency?: boolean;
      liquidityAmountToWithdrawExplicit?: BigNumber;
    }
    interface IWithdrawTestResults {
      gasUsed: BigNumber;

      baseAmounts: BigNumber[];
      strategyBalances: BigNumber[];

      investedAssetsUSD: BigNumber;
      assetPrice: BigNumber;

      investedAssetsValueBefore: BigNumber;
      investedAssetsValueAfter: BigNumber;
    }
    async function makeWithdrawTest(
      depositorLiquidity: BigNumber,
      depositorPoolReserves: BigNumber[],
      depositorTotalSupply: BigNumber,
      withdrawnAmounts: BigNumber[],
      amount?: BigNumber,
      params?: IWithdrawTestParams
    ) : Promise<IWithdrawTestResults> {
      if (params?.baseAmounts) {
        for (const tokenAmount of params?.baseAmounts) {
          await strategy.setBaseAmountAccess(tokenAmount.token.address, tokenAmount.amount);
        }
      }
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(strategy.address, tokenAmount.amount);
        }
      }
      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidator.setLiquidateWithRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidation.tokenOut.mint(liquidator.address, liquidation.amountOut);
        }
      }
      if (params?.repayments) {
        for (const repayment of params.repayments) {
          await tetuConverter.setGetDebtAmountCurrent(
            strategy.address,
            repayment.collateralAsset.address,
            repayment.borrowAsset.address,
            repayment.totalDebtAmountOut,
            repayment.totalCollateralAmountOut
          );
          await tetuConverter.setRepay(
            repayment.collateralAsset.address,
            repayment.borrowAsset.address,
            repayment.amountRepay,
            strategy.address,
            repayment.totalCollateralAmountOut,
            0,
            0,
            0
          );
          await tetuConverter.setQuoteRepay(
            strategy.address,
            repayment.collateralAsset.address,
            repayment.borrowAsset.address,
            repayment.amountRepay,
            repayment.totalCollateralAmountOut,
          );
          await repayment.collateralAsset.mint(tetuConverter.address, repayment.totalCollateralAmountOut);
        }
      }

      await strategy.setDepositorLiquidity(depositorLiquidity);
      await strategy.setDepositorPoolReserves(depositorPoolReserves);
      await strategy.setTotalSupply(depositorTotalSupply);

      // if (params?.investedAssetsBeforeWithdraw) {
      //   await setupInvestedAssets(depositorLiquidity, params.investedAssetsBeforeWithdraw);
      // }
      // const investedAssets = await strategy.investedAssets();
      const investedAssets = params?.investedAssetsBeforeWithdraw || 0;

      const liquidityAmountToWithdraw = params?.liquidityAmountToWithdrawExplicit
        || (amount
          ? depositorLiquidity.mul(101).mul(amount).div(100).div(investedAssets)
          : depositorLiquidity
        ); // withdraw all
      await strategy.setDepositorExit(liquidityAmountToWithdraw, withdrawnAmounts);
      if (params?.investedAssetsAfterWithdraw) {
        await strategy.setDepositorQuoteExit(
          amount
            ? depositorLiquidity.sub(liquidityAmountToWithdraw)
            : BigNumber.from(0),
          [
            0, // dai
            params?.investedAssetsAfterWithdraw, // usdc
            0 // usdt
          ]
        );
      }

      const investedAssetsValueBefore = await strategy.investedAssets();
      const r: {investedAssetsUSD: BigNumber, assetPrice: BigNumber} = params?.emergency
        ? {investedAssetsUSD: BigNumber.from(0), assetPrice: BigNumber.from(0)}
        : amount
          ? await strategy.callStatic.withdrawUniversalTestAccess(amount, false, investedAssets)
          : await strategy.callStatic.withdrawUniversalTestAccess(0, true, investedAssets);
      const tx = params?.emergency
        ? await strategy._emergencyExitFromPoolAccess()
        : amount
          ? await strategy.withdrawUniversalTestAccess(amount, false, investedAssets)
          : await strategy.withdrawUniversalTestAccess(0, true, investedAssets);
      const gasUsed = (await tx.wait()).gasUsed;

      const baseAmounts = await Promise.all(depositorTokens.map(
        async token => strategy.baseAmounts(token.address)
      ));
      const strategyBalances = await Promise.all(depositorTokens.map(
        async token => IERC20__factory.connect(token.address, signer).balanceOf(strategy.address)
      ));

      return {
        gasUsed,

        strategyBalances,
        baseAmounts,

        assetPrice: r.assetPrice,
        investedAssetsUSD: r.investedAssetsUSD,

        investedAssetsValueBefore,
        investedAssetsValueAfter: await strategy.investedAssets()
      }
    }
    describe("Good paths", () => {
      describe("Withdraw a given amount", () => {
        describe("Zero base amounts of dai and usdt (no conversion from balance)", () => {
          let results: IWithdrawTestResults;
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
            results = await makeWithdrawTest(
              parseUnits("6", 6), // total liquidity of the user
              [
                parseUnits("1000", 18), // dai
                parseUnits("2000", 6), // usdc
                parseUnits("3000", 6), // usdt
              ],
              parseUnits("6000", 6), // total supply
              [
                parseUnits("0.507", 18),
                parseUnits("1.02", 6),
                parseUnits("1.517", 6),
              ],
              parseUnits("3", 6), // amount to withdraw
              {
                investedAssetsBeforeWithdraw: parseUnits("6", 6), // total invested amount
                investedAssetsAfterWithdraw: parseUnits("1", 6),
                baseAmounts: [
                  {token: dai, amount: parseUnits("0", 18)},
                  {token: usdc, amount: parseUnits("1000", 6)},
                  {token: usdt, amount: parseUnits("0", 6)},
                ],
                initialBalances: [
                  {token: dai, amount: parseUnits("0", 18)},
                  {token: usdc, amount: parseUnits("1000", 6)},
                  {token: usdt, amount: parseUnits("0", 6)},
                ],
                repayments: [
                  // total liquidity is 6000000
                  // ratio is 0.505, so liquidity to withdraw is 3030000
                  // as result, following amounts will be withdrawn: 505000000000000000 1010000 1515000
                  // we assume, that actually withdrawn amounts are a bit different: 507000000000000000 1020000 1517000
                  {
                    collateralAsset: usdc,
                    borrowAsset: dai,
                    totalDebtAmountOut: parseUnits("0.505", 18),
                    amountRepay: parseUnits("0.505", 18),
                    totalCollateralAmountOut: parseUnits("1980", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: dai,
                    totalDebtAmountOut: parseUnits("0.507", 18),
                    amountRepay: parseUnits("0.507", 18),
                    totalCollateralAmountOut: parseUnits("1981", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalDebtAmountOut: parseUnits("1.515", 6),
                    amountRepay: parseUnits("1.515", 6),
                    totalCollateralAmountOut: parseUnits("1930", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalDebtAmountOut: parseUnits("1.517", 6),
                    amountRepay: parseUnits("1.517", 6),
                    totalCollateralAmountOut: parseUnits("1931", 6),
                  },
                ]
              }
            )
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          it("should update base amounts", async () => {
            const expectedBaseAmounts = [
              parseUnits("0", 18), // dai == 0 + 980 - 980
              parseUnits("4913.02", 6), // usdc == 1000 + 1981 + 1931 + 1.02
              parseUnits("0", 6), // usdt = 0 + 930 - 930
            ];

            const ret = results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
            const expected = expectedBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should update strategy balances", async () => {
            const expectedStrategyBalances = [
              parseUnits("0", 18), // dai == 0 + 980 - 980
              parseUnits("4913.02", 6), // usdc == 1000 + 1981 + 1931 + 1.02
              parseUnits("0", 6), // usdt = 0 + 930 - 930
            ];

            const ret = results.strategyBalances.map(x => BalanceUtils.toString(x)).join("\n");
            const expected = expectedStrategyBalances.map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should return expected investedAssetsUSD", async () => {
            const ret = [
              results.investedAssetsUSD,
              results.assetPrice
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("3911.01", 6), // ((1000 + 2000 + 3000) * 3/6 * 6/6000 * 101/100)/3 + 1980 + 1930
              parseUnits("1", 18) // for simplicity, all prices are equal to 1
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should call _updateInvestedAssets", async () => {
            expect(results.investedAssetsValueBefore.eq(results.investedAssetsValueAfter)).eq(false);
          });
          it("Gas estimation @skip-on-coverage", async () => {
            controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_AMOUNT, (u, t) => {
              expect(u).to.be.below(t + 1);
            });
          });
        });
        /**
         * todo fix
         */
        describe.skip("Not zero base amounts of dai and usdt", () => {
          let results: IWithdrawTestResults;
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
            results = await makeWithdrawTest(
              parseUnits("1", 9), // total liquidity of the user = 0.1 of total supply
              [
                parseUnits("1000", 18), // dai
                parseUnits("2000", 6), // usdc
                parseUnits("3000", 6), // usdt
              ],
              parseUnits("1", 10), // total supply
              [
                parseUnits("50", 18),
                parseUnits("101.5", 6),
                parseUnits("152", 6),
              ],
              parseUnits("300", 6), // amount to withdraw
              {
                liquidityAmountToWithdrawExplicit: parseUnits("0.505", 9),
                investedAssetsBeforeWithdraw: parseUnits("400", 6), // total invested amount
                investedAssetsAfterWithdraw: parseUnits("1", 6),
                baseAmounts: [
                  {token: dai, amount: parseUnits("200", 18)},
                  {token: usdc, amount: parseUnits("400", 6)},
                  {token: usdt, amount: parseUnits("300", 6)},
                ],
                initialBalances: [
                  {token: dai, amount: parseUnits("200", 18)},
                  {token: usdc, amount: parseUnits("400", 6)},
                  {token: usdt, amount: parseUnits("300", 6)},
                ],
                repayments: [
                  {
                    collateralAsset: usdc,
                    borrowAsset: dai,
                    totalDebtAmountOut: parseUnits("200", 18),
                    amountRepay: parseUnits("200", 18),
                    totalCollateralAmountOut: parseUnits("40", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalDebtAmountOut: parseUnits("300", 6),
                    amountRepay: parseUnits("300", 6),
                    totalCollateralAmountOut: parseUnits("60", 6),
                  },

                  // Total supply = 1e10, user liquidity in the pool = 1e9
                  // invested-assets = 400+40+60=500 usdc
                  // we are going to withdraw 300 usdc
                  // 40+60=100 usdc we will receive by converting dai and usdt on balance
                  // so, we need to withdraw only 200 usdc from the pool
                  // 1e9 ~ 400 usdc
                  // ? ~ 200 usdc
                  // ? = 200 * 1e9 / 400 * 101/100 = 505000000
                  // Following amounts will be withdrawn:
                  /// 1000 * 505000000 / 1e10 = 50.5 dai
                  /// 2000 * 505000000 / 1e10 = 101 usdc
                  /// 3000 * 505000000 / 1e10 = 151.5 usdt
                  /// these amounts should be converter to 71, 101, 41 usdc
                  /// these amounts will be converter to 70, 101, 42 usdc
                  {
                    collateralAsset: usdc,
                    borrowAsset: dai,
                    totalDebtAmountOut: parseUnits("50.5", 18).add(parseUnits("200", 18)),
                    amountRepay: parseUnits("50.5", 18).add(parseUnits("200", 18)),
                    totalCollateralAmountOut: parseUnits("71", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: dai,
                    totalDebtAmountOut: parseUnits("50", 18).add(parseUnits("200", 18)),
                    amountRepay: parseUnits("50", 18).add(parseUnits("200", 18)),
                    totalCollateralAmountOut: parseUnits("70", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalDebtAmountOut: parseUnits("151.5", 6).add(parseUnits("300", 6)),
                    amountRepay: parseUnits("151.5", 6).add(parseUnits("300", 6)),
                    totalCollateralAmountOut: parseUnits("41", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalDebtAmountOut: parseUnits("152", 6).add(parseUnits("300", 6)),
                    amountRepay: parseUnits("152", 6).add(parseUnits("300", 6)),
                    totalCollateralAmountOut: parseUnits("42", 6),
                  },
                ]
              }
            )
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });
          it("should update base amounts", async () => {
            const expectedBaseAmounts = [
              parseUnits("0", 18), // dai
              parseUnits("613.5", 6), // usdc == 400 + 70 + 42 + 101.5
              parseUnits("0", 6), // usdt
            ];

            const ret = results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
            const expected = expectedBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should update strategy balances", async () => {
            const expectedStrategyBalances = [
              parseUnits("0", 18), // dai
              parseUnits("613.5", 6), // usdc == 400 + 70 + 42 + 101.5
              parseUnits("0", 6), // usdt
            ];

            const ret = results.strategyBalances.map(x => BalanceUtils.toString(x)).join("\n");
            const expected = expectedStrategyBalances.map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should return expected investedAssetsUSD", async () => {
            const ret = [
              results.investedAssetsUSD,
              results.assetPrice
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              parseUnits("213", 6), // usdc = 71 + 41 + 101
              parseUnits("1", 18) // for simplicity, all prices are equal to 1
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should call _updateInvestedAssets", async () => {
            expect(results.investedAssetsValueBefore.eq(results.investedAssetsValueAfter)).eq(false);
          });
          it("Gas estimation @skip-on-coverage", async () => {
            controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_AMOUNT, (u, t) => {
              expect(u).to.be.below(t + 1);
            });
          });
        });
        /**
         * todo fix
         */
        describe.skip("There is enough amount to withdraw on balance", () => {
          it("should use amounts from balance and don't make conversion", async () => {
            const results = await makeWithdrawTest(
              parseUnits("1", 9), // total liquidity of the user = 0.1 of total supply
              [
                parseUnits("1000", 18), // dai
                parseUnits("2000", 6), // usdc
                parseUnits("3000", 6), // usdt
              ],
              parseUnits("1", 10), // total supply
              [
                parseUnits("50", 18),
                parseUnits("101.5", 6),
                parseUnits("152", 6),
              ],
              parseUnits("100", 6), // amount to withdraw
              {
                liquidityAmountToWithdrawExplicit: parseUnits("0.505", 9),
                investedAssetsBeforeWithdraw: parseUnits("400", 6), // total invested amount
                investedAssetsAfterWithdraw: parseUnits("1", 6),
                baseAmounts: [
                  {token: dai, amount: parseUnits("200", 18)},
                  {token: usdc, amount: parseUnits("400", 6)},
                  {token: usdt, amount: parseUnits("300", 6)},
                ],
                initialBalances: [
                  {token: dai, amount: parseUnits("200", 18)}, // === $40
                  {token: usdc, amount: parseUnits("400", 6)}, // === $400
                  {token: usdt, amount: parseUnits("300", 6)}, // === $60
                ],
                repayments: [
                  // Total supply = 1e10, user liquidity in the pool = 1e9
                  // invested-assets = 400+40+60=500 usdc
                  // we are going to withdraw 100 usdc
                  // 40+60=100 usdc we will receive by converting dai and usdt on balance
                  // so, we don't need to withdraw any amounts from the pool

                  {
                    collateralAsset: usdc,
                    borrowAsset: dai,
                    totalDebtAmountOut: parseUnits("200", 18),
                    amountRepay: parseUnits("200", 18),
                    totalCollateralAmountOut: parseUnits("40", 6),
                  },
                  {
                    collateralAsset: usdc,
                    borrowAsset: usdt,
                    totalDebtAmountOut: parseUnits("300", 6),
                    amountRepay: parseUnits("300", 6),
                    totalCollateralAmountOut: parseUnits("60", 6),
                  },
                ]
              }
            );

            const ret = [
              results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n"),
              results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n"),
              results.investedAssetsUSD,
              results.assetPrice,
              // should call _updateInvestedAssets()
              results.investedAssetsValueBefore.eq(results.investedAssetsValueAfter)
            ].join("\n");
            const expected = [
              [0, parseUnits("500", 6), 0].map(x => BalanceUtils.toString(x)).join("\n"),
              [0, parseUnits("500", 6), 0].map(x => BalanceUtils.toString(x)).join("\n"),
              parseUnits("100", 6), // 40 + 60
              parseUnits("1", 18), // for simplicity, all prices are equal to 1
              false
            ].join("\n");

            console.log(results);
            expect(ret).eq(expected);
          });
        });
      });
      describe("Withdraw all", () => {
        let results: IWithdrawTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeWithdrawTest(
            parseUnits("1", 9), // total liquidity of the user = 0.1 of total supply
            [
              parseUnits("1000", 18), // dai
              parseUnits("2000", 6), // usdc
              parseUnits("3000", 6), // usdt
            ],
            parseUnits("1", 10), // total supply
            [
              parseUnits("100.5", 18),
              parseUnits("200.5", 6),
              parseUnits("300.5", 6),
            ],
            undefined, // withdraw all
            {
              liquidityAmountToWithdrawExplicit: parseUnits("1", 9),
              investedAssetsBeforeWithdraw: parseUnits("400", 6), // total invested amount
              investedAssetsAfterWithdraw: parseUnits("0", 6),
              baseAmounts: [
                {token: dai, amount: parseUnits("200", 18)},
                {token: usdc, amount: parseUnits("400", 6)},
                {token: usdt, amount: parseUnits("300", 6)},
              ],
              initialBalances: [
                {token: dai, amount: parseUnits("200", 18)},
                {token: usdc, amount: parseUnits("400", 6)},
                {token: usdt, amount: parseUnits("300", 6)},
              ],
              repayments: [
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  totalDebtAmountOut: parseUnits("200", 18),
                  amountRepay: parseUnits("200", 18),
                  totalCollateralAmountOut: parseUnits("40", 6),
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalDebtAmountOut: parseUnits("300", 6),
                  amountRepay: parseUnits("300", 6),
                  totalCollateralAmountOut: parseUnits("60", 6),
                },

                // Total supply = 1e10, user liquidity in the pool = 1e9
                // invested-assets = 400+40+60=500 usdc
                // we are going to withdraw 500 usdc
                // 40+60=100 usdc we will receive by converting dai and usdt on balance
                // so, we need to withdraw 400 usdc from the pool
                // Following amounts will be withdrawn:
                /// 1000 * 1e9 / 1e10 = 100 dai
                /// 2000 * 1e9 / 1e10 = 200 usdc
                /// 3000 * 1e9 / 1e10 = 300 usdt
                /// these amounts should be converter to 71, 200, 41 usdc
                /// these amounts will be converter to 70, 200, 42 usdc
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  totalDebtAmountOut: parseUnits("100", 18).add(parseUnits("200", 18)),
                  amountRepay: parseUnits("100", 18).add(parseUnits("200", 18)),
                  totalCollateralAmountOut: parseUnits("71", 6),
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  totalDebtAmountOut: parseUnits("100.5", 18).add(parseUnits("200", 18)),
                  amountRepay: parseUnits("100.5", 18).add(parseUnits("200", 18)),
                  totalCollateralAmountOut: parseUnits("70", 6),
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalDebtAmountOut: parseUnits("300", 6).add(parseUnits("300", 6)),
                  amountRepay: parseUnits("300", 6).add(parseUnits("300", 6)),
                  totalCollateralAmountOut: parseUnits("41", 6),
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalDebtAmountOut: parseUnits("300.5", 6).add(parseUnits("300", 6)),
                  amountRepay: parseUnits("300.5", 6).add(parseUnits("300", 6)),
                  totalCollateralAmountOut: parseUnits("42", 6),
                },
              ]
            }
          )
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should update base amounts", async () => {
          const expectedBaseAmounts = [
            parseUnits("0", 18), // dai
            parseUnits("712.5", 6), // usdc == 400 + 70 + 42 + 200.5
            parseUnits("0", 6), // usdt
          ];

          const ret = results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = expectedBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should update strategy balances", async () => {
          const expectedStrategyBalances = [
            parseUnits("0", 18), // dai
            parseUnits("712.5", 6), // usdc == 400 + 70 + 42 + 200.5
            parseUnits("0", 6), // usdt
          ];

          const ret = results.strategyBalances.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = expectedStrategyBalances.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should return expected investedAssetsUSD", async () => {
          const ret = [
            results.investedAssetsUSD,
            results.assetPrice
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            parseUnits("312", 6), // usdc = 71 + 41 + 200
            parseUnits("1", 18) // for simplicity, all prices are equal to 1
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it.skip("should call _updateInvestedAssets", async () => {
          expect(results.investedAssetsValueBefore.eq(results.investedAssetsValueAfter)).eq(false);
        });
        it("Gas estimation @skip-on-coverage", async () => {
          controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_ALL, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
      describe("_emergencyExitFromPool", () => {
        let results: IWithdrawTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeWithdrawTest(
            parseUnits("6", 18), // total liquidity of the user
            [
              parseUnits("100", 18), // dai
              parseUnits("200", 6), // usdc
              parseUnits("150", 6), // usdt
            ],
            parseUnits("6000", 18), // total supply
            [
              parseUnits("980", 18),
              parseUnits("950", 6),
              parseUnits("930", 6),
            ],
            undefined, // withdraw all
            {
              emergency: true,
              investedAssetsBeforeWithdraw: parseUnits("6", 6), // total invested amount (not used)
              investedAssetsAfterWithdraw:  parseUnits("0", 6),
              baseAmounts: [
                {token: dai, amount: parseUnits("3000", 18)},
                {token: usdc, amount: parseUnits("1000", 6)},
                {token: usdt, amount: parseUnits("2000", 6)},
              ],
              initialBalances: [
                {token: dai, amount: parseUnits("3000", 18)},
                {token: usdc, amount: parseUnits("1000", 6)},
                {token: usdt, amount: parseUnits("2000", 6)},
              ],
              repayments: [
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  totalDebtAmountOut: parseUnits("3980", 18),
                  amountRepay: parseUnits("3980", 18),
                  totalCollateralAmountOut: parseUnits("1980", 6),
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalDebtAmountOut: parseUnits("2930", 6),
                  amountRepay: parseUnits("2930", 6),
                  totalCollateralAmountOut: parseUnits("1930", 6),
                },
              ]
            }
          )
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should update base amounts", async () => {
          const expectedBaseAmounts = [
            parseUnits("0", 18), // dai
            parseUnits("5860", 6), // usdc == 1000 + 1980 + 1930 + 950
            parseUnits("0", 6), // usdt
          ];

          const ret = results.baseAmounts.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = expectedBaseAmounts.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should update strategy balances", async () => {
          const expectedStrategyBalances = [
            parseUnits("0", 18), // dai
            parseUnits("5860", 6), // usdc == 1000 + 1980 + 1930 + 950
            parseUnits("0", 6), // usdt
          ];

          const ret = results.strategyBalances.map(x => BalanceUtils.toString(x)).join("\n");
          const expected = expectedStrategyBalances.map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it.skip("should call _updateInvestedAssets", async () => {
          expect(results.investedAssetsValueBefore.eq(results.investedAssetsValueAfter)).eq(false);
        });
        it("Gas estimation @skip-on-coverage", async () => {
          controlGasLimitsEx(results.gasUsed, GAS_CONVERTER_STRATEGY_BASE_CONVERT_WITHDRAW_EMERGENCY, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });
    describe("Bad paths", () => {
// TODO
    });
  });

  describe("requireAmountBack", () => {
    interface IPrepareWithdraw {
      investedAssetsBeforeWithdraw: BigNumber;
      liquidations?: ILiquidationParams[];
      baseAmounts?: ITokenAmount[];
      initialBalances?: ITokenAmount[];
      repayments?: IRepayParams[];
    }
    async function prepareWithdraw(
      depositorLiquidity: BigNumber,
      depositorPoolReserves: BigNumber[],
      depositorTotalSupply: BigNumber,
      withdrawnAmounts: BigNumber[],
      amount: BigNumber,
      params?: IPrepareWithdraw
    ) {
      if (params?.baseAmounts) {
        for (const tokenAmount of params?.baseAmounts) {
          await strategy.setBaseAmountAccess(tokenAmount.token.address, tokenAmount.amount);
        }
      }
      if (params?.initialBalances) {
        for (const tokenAmount of params?.initialBalances) {
          await tokenAmount.token.mint(strategy.address, tokenAmount.amount);
        }
      }
      if (params?.liquidations) {
        for (const liquidation of params?.liquidations) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          await liquidator.setBuildRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            ""
          );
          await liquidator.setGetPriceForRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidator.setLiquidateWithRoute(
            liquidation.tokenIn.address,
            liquidation.tokenOut.address,
            pool,
            swapper,
            liquidation.amountIn,
            liquidation.amountOut
          );
          await liquidation.tokenOut.mint(liquidator.address, liquidation.amountOut);
        }
      }
      if (params?.repayments) {
        for (const repayment of params.repayments) {
          await tetuConverter.setGetDebtAmountCurrent(
            strategy.address,
            repayment.collateralAsset.address,
            repayment.borrowAsset.address,
            repayment.totalDebtAmountOut,
            repayment.totalCollateralAmountOut
          );
          await tetuConverter.setRepay(
            repayment.collateralAsset.address,
            repayment.borrowAsset.address,
            repayment.amountRepay,
            strategy.address,
            repayment.totalCollateralAmountOut,
            0,
            0,
            0
          );
          await tetuConverter.setQuoteRepay(
            strategy.address,
            repayment.collateralAsset.address,
            repayment.borrowAsset.address,
            repayment.amountRepay,
            repayment.totalCollateralAmountOut,
          );
          await repayment.collateralAsset.mint(tetuConverter.address, repayment.totalCollateralAmountOut);
        }
      }

      await strategy.setDepositorLiquidity(depositorLiquidity);
      await strategy.setDepositorPoolReserves(depositorPoolReserves);
      await strategy.setTotalSupply(depositorTotalSupply);

      await strategy.setDepositorExit(depositorTotalSupply, withdrawnAmounts);
      await strategy.setDepositorQuoteExit(depositorLiquidity, withdrawnAmounts);

      // await setupInvestedAssets(depositorLiquidity, params.investedAssetsBeforeWithdraw);
      const investedAssets = params?.investedAssetsBeforeWithdraw || 0;

      const liquidityAmountToWithdraw = depositorLiquidity.mul(101).mul(amount).div(100).div(investedAssets);
      console.log("liquidityAmountToWithdraw", liquidityAmountToWithdraw);
      console.log("depositorLiquidity", depositorLiquidity);
      console.log("amount", amount);
      console.log("investedAssets", investedAssets);
      await strategy.setDepositorExit(liquidityAmountToWithdraw, withdrawnAmounts);
      await strategy.setDepositorQuoteExit(
        amount
          ? depositorLiquidity.sub(liquidityAmountToWithdraw)
          : BigNumber.from(0),
        [
          0, // dai
          BigNumber.from("1"), // actual value is not important
          0 // usdt
        ]
      );
    }
    describe("Good paths", () => {
      describe("There is enough main asset on the balance", () => {
        it("should return send given amount of main asset to tetuConverter", async () => {
          await usdc.mint(strategy.address, parseUnits("100", 6));
          const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));
          const r = await strategyAsTC.callStatic.requireAmountBack(
            usdc.address,
            parseUnits("99", 6),
            dai.address,
            parseUnits("500", 18),
          );
          await strategyAsTC.requireAmountBack(
            usdc.address,
            parseUnits("99", 6),
            dai.address,
            parseUnits("500", 18),
          );

          const ret = [
            r.isCollateral,
            r.amountOut,
            await usdc.balanceOf(tetuConverter.address),
            await usdc.balanceOf(strategy.address)
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            true,
            parseUnits("99", 6),
            parseUnits("99", 6),
            parseUnits("1", 6)
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
      describe("There is not enough main asset on the balance", () => {
        it("should withdraw missed amount and send given amount to tetuConveter", async () => {
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
            parseUnits("3", 6), // amount to withdraw
            {
              investedAssetsBeforeWithdraw: BigNumber.from(3927000000), // total invested amount, value from calcInvestedAmount()
              baseAmounts: [
                {token: dai, amount: parseUnits("0", 18)},
                {token: usdc, amount: parseUnits("1000", 6)},
                {token: usdt, amount: parseUnits("0", 6)},
              ],
              initialBalances: [
                {token: dai, amount: parseUnits("0", 18)},
                {token: usdc, amount: parseUnits("1000", 6)},
                {token: usdt, amount: parseUnits("0", 6)},
              ],
              repayments: [
                {
                  collateralAsset: usdc,
                  borrowAsset: dai,
                  totalDebtAmountOut: parseUnits("0.505", 18),
                  amountRepay: parseUnits("0.505", 18),
                  totalCollateralAmountOut: parseUnits("1980", 6),
                },
                {
                  collateralAsset: usdc,
                  borrowAsset: usdt,
                  totalDebtAmountOut: parseUnits("1.515", 6),
                  amountRepay: parseUnits("1.515", 6),
                  totalCollateralAmountOut: parseUnits("1930", 6),
                },
              ]
            }
          )

          const r = await strategyAsTC.callStatic.requireAmountBack(
            usdc.address,
            parseUnits("1003", 6),
            dai.address,
            parseUnits("500", 18),
          );
          await strategyAsTC.requireAmountBack(
            usdc.address,
            parseUnits("1003", 6),
            dai.address,
            parseUnits("500", 18),
          );

          const ret = [
            r.isCollateral,
            r.amountOut,
            await usdc.balanceOf(tetuConverter.address),
            await usdc.balanceOf(strategy.address)
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            true,
            parseUnits("1003", 6),
            parseUnits("1003", 6), // 1003
            parseUnits("3924", 6) // 1980+1930+17-3
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if not tetu converter", async () => {
        await usdc.mint(strategy.address, parseUnits("100", 6));
        const strategyAsNotTC = strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address));
        await expect(
          strategyAsNotTC.requireAmountBack(
            usdc.address,
            parseUnits("99", 6),
            dai.address,
            parseUnits("500", 18),
          )
        ).revertedWith("SB: Denied"); // DENIED
      });
      it("should revert if wrong asset", async () => {
        await usdc.mint(strategy.address, parseUnits("100", 6));
        const strategyAsTC = strategy.connect(await Misc.impersonate(tetuConverter.address));
        await expect(
          strategyAsTC.requireAmountBack(
            tetu.address, // (!) wrong asset, not usdc
            parseUnits("99", 18),
            dai.address,
            parseUnits("500", 18),
          )
        ).revertedWith("SB: Wrong value"); // WRONG_VALUE
      });

    });
    describe("Gas estimation @skip-on-coverage", () => {
// todo
    });
  });
//endregion Unit tests
});