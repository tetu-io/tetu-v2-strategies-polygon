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
  BalancerComposableStableStrategy__factory
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
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_PREPARE_REWARDS_LIST,
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_RECYCLE,
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
        collateral.add(withdrawnAmounts[indexAsset])
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
    interface IRecycleTestParams {
      liquidations?: ILiquidationParams[];
      thresholds?: ITokenAmount[];
      baseAmounts?: ITokenAmount[];
      initialBalances?: ITokenAmount[];
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
    ) : Promise<IRecycleTestResults> {
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
        async function makeRecycleTestBase() : Promise<IRecycleTestResults> {
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
                { tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("5", 18), amountOut: parseUnits("17", 6)}, // 4 + 1
                { tokenIn: tetu, tokenOut: usdc, amountIn: parseUnits("11", 18), amountOut: parseUnits("23", 6)}, // 8 + 3
                { tokenIn: weth, tokenOut: usdc, amountIn: parseUnits("42", 8), amountOut: parseUnits("13", 6)}, // 40 + 2
              ],
              thresholds: [
                { token: bal, amount:  parseUnits("4", 18)}, // ok
                { token: weth, amount:  parseUnits("1", 8)}, // ok, (!) but it won't pass threshold by USDC
                { token: tetu, amount:  parseUnits("12", 18)}, // (!) too high
                { token: usdc, amount:  parseUnits("14", 6)},
              ],
              baseAmounts: [
                { token: bal, amount:  parseUnits("1", 18)},
                { token: weth, amount:  parseUnits("2", 8)},
                { token: tetu, amount:  parseUnits("3", 18)},
                { token: usdc, amount:  parseUnits("4", 6)},
                { token: dai, amount:  parseUnits("5", 18)},
              ],
              initialBalances: [
                // any balances - just to be sure that _recycle doesn't use them
                { token: bal, amount:  parseUnits("400", 18)},
                { token: weth, amount:  parseUnits("500", 8)},
                { token: tetu, amount:  parseUnits("600", 18)},
                { token: usdc, amount:  parseUnits("700", 6)},
                { token: dai, amount:  parseUnits("800", 18)},
              ]
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
                    amount:  parseUnits("18", 6) // (!) too high
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
                  { tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("3", 18), amountOut: parseUnits("17", 6)},
                  { tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("8", 18), amountOut: parseUnits("19", 6)},
                ],
                thresholds: [{
                  token: usdc,
                  amount:  parseUnits("18", 6) // too high for 3, but ok for 8
                }],
                baseAmounts: [{
                  token: bal,
                  amount:  parseUnits("5", 18)
                }],
                initialBalances: [{
                  token: bal,
                  amount:  parseUnits("555", 18) // just to be sure that _recycle doesn't read balances
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
                    amount:  parseUnits("4", 18) // (!) too high
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
                  { tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("3", 18), amountOut: parseUnits("17", 6)},
                  { tokenIn: bal, tokenOut: usdc, amountIn: parseUnits("8", 18), amountOut: parseUnits("19", 6)},
                ],
                thresholds: [{
                  token: bal,
                  amount:  parseUnits("4", 18) // too high for 3, but ok for 8
                }],
                baseAmounts: [{
                  token: bal,
                  amount:  parseUnits("5", 18)
                }],
                initialBalances: [{
                  token: bal,
                  amount:  parseUnits("555", 18) // just to be sure that _recycle doesn't read balances
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

      it("should send expected values to forwarder", async () => {
        const tokens = [usdc, bal];
        const amounts = [parseUnits("10", 6), parseUnits("20", 18)];
        const compoundRate = BigNumber.from(30_000); // 30%

        const r = await makeRecycleTest(
          compoundRate,
          tokens,
          amounts,
          {
            liquidations: [{
              tokenIn: bal,
              tokenOut: usdc,
              amountIn: parseUnits("6", 18),
              amountOut: parseUnits("100", 6)
            }]
          }
        );

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

  describe("_doHardWork", () => {
    describe("Good paths", () => {
      it("should return expected values, positive reinvest", async () => {
        const assetProvider = ethers.Wallet.createRandom();
        await usdc.mint(assetProvider.address, parseUnits("1000", 6));
        await usdc.connect(await Misc.impersonate(assetProvider.address)).approve(strategy.address, Misc.MAX_UINT);

        await strategy.setMockedDepositToPool(
          parseUnits("8", 6),
          assetProvider.address
        );

        await strategy.setMockedHandleRewardsResults(
          parseUnits("7", 6),
          parseUnits("14", 6),
          parseUnits("17", 6),
          assetProvider.address
        );

        const r = await strategy.callStatic._doHardWorkAccess(true);
        const ret = [
          r.earned.toString(),
          r.lost.toString()
        ].join();
        const expected = [
          parseUnits("15", 6).toString(),
          parseUnits("14", 6).toString() // 14 + 8
        ].join();

        expect(ret).eq(expected);
      });
      it("should return expected values, negative reinvest", async () => {
        const assetProvider = ethers.Wallet.createRandom();
        await usdc.mint(assetProvider.address, parseUnits("1000", 6));
        await usdc.connect(await Misc.impersonate(assetProvider.address)).approve(strategy.address, Misc.MAX_UINT);

        await strategy.setMockedDepositToPool(
          parseUnits("-8", 6),
          assetProvider.address
        );

        await strategy.setMockedHandleRewardsResults(
          parseUnits("7", 6),
          parseUnits("14", 6),
          parseUnits("17", 6),
          assetProvider.address
        );

        const r = await strategy.callStatic._doHardWorkAccess(true);
        const ret = [
          r.earned.toString(),
          r.lost.toString()
        ].join();
        const expected = [
          parseUnits("7", 6).toString(),
          parseUnits("22", 6).toString() // 14 + 8
        ].join();

        expect(ret).eq(expected);
      });
    });
  });
//endregion Unit tests
});