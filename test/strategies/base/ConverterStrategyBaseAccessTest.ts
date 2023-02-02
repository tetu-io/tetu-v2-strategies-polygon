import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IController,
  IStrategyV2,
  MockConverterStrategy,
  MockConverterStrategy__factory, MockTetuConverterController, MockTetuConverter,
  MockToken, PriceOracleMock, StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2
} from "../../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {parseUnits} from "ethers/lib/utils";
import {BigNumber, BigNumberish} from "ethers";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {expect} from "chai";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_AFTER_DEPOSIT,
  GAS_CONVERTER_STRATEGY_BASE_BEFORE_DEPOSIT,
} from "../../baseUT/GasLimits";

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
//endregion Variables

//region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    const governance = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
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

  describe("_afterDeposit", () => {
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

      await strategy.callStatic._afterDepositAccess(
        depositorTokens.map(x => x.address),
        indexAsset,
        amountsConsumed,
        borrowed,
        collateral
      );
      const tx = await strategy._afterDepositAccess(
        depositorTokens.map(x => x.address),
        indexAsset,
        amountsConsumed,
        borrowed,
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
//endregion Unit tests
});