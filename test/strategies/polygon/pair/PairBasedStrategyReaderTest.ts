/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  MockSplitterVault, MockTetuConverter,
  MockToken, PriceOracleMock,
  PairBasedStrategyReaderAccessMock,
  PairBasedStrategyReader,
} from '../../../../typechain';
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {IRepayParams} from "../../../baseUT/mocks/TestDataTypes";
import {setupMockedRepay} from "../../../baseUT/mocks/MockRepayUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../../baseUT/utils/HardhatUtils";
import {facades} from "../../../../typechain/contracts/test";

/**
 * Study noSwap-rebalance.
 * Try to change price step by step and check how strategy params are changed
 */
describe('PairBasedStrategyReaderTest', function() {
//region Constants and variables

  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let converter: MockTetuConverter;
  let usdc: MockToken;
  let wmatic: MockToken;
  let dai: MockToken;
  let usdt: MockToken;
  let strategy: PairBasedStrategyReaderAccessMock;
  let splitter: MockSplitterVault;
  let reader: PairBasedStrategyReader;
  let priceOracle: PriceOracleMock;
//endregion Constants and variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    [signer] = await ethers.getSigners();

    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    dai = await DeployerUtils.deployMockToken(signer, 'DAI', 18);
    wmatic = await DeployerUtils.deployMockToken(signer, 'WMATIC', 18);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);

    snapshotBefore = await TimeUtils.snapshot();
    // set up TetuConverter
    priceOracle = (await DeployerUtils.deployContract(
      signer,
      'PriceOracleMock',
      [usdc.address, wmatic.address, usdt.address],
      [parseUnits('1', 18), parseUnits('1', 18), parseUnits('1', 18)],
    )) as PriceOracleMock;
    const converterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
    converter = await MockHelper.createMockTetuConverter(signer);
    await converter.setController(converterController.address);

    splitter = await MockHelper.createMockSplitter(signer);
    strategy = await MockHelper.createPairBasedStrategyReaderAccessMock(signer);
    await strategy.setSplitter(splitter.address);
    await strategy.setConverter(converter.address);
    reader = await MockHelper.createPairBasedStrategyReader(signer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  describe("getLockedUnderlyingAmount", () => {
    interface IGetLockedUnderlyingAmountParams {

      underlying: MockToken;
      secondAsset: MockToken;

      totalAssets: string;

      repays?: IRepayParams[];
      /** underlying, secondAsset */
      prices?: string[];
    }

    interface IGetLockedUnderlyingAmountResults {
      estimatedUnderlyingAmount: number;
      totalAssets: number;
    }

    async function getLockedUnderlyingAmount(p: IGetLockedUnderlyingAmountParams): Promise<IGetLockedUnderlyingAmountResults> {
      await strategy.setTotalAssets(parseUnits(p.totalAssets, await p.underlying.decimals()));
      await strategy.setPoolTokens(p.underlying.address, p.secondAsset.address);
      await splitter.setAsset(p.underlying.address);

      if (p.prices) {
        await priceOracle.changePrices(
          [p.underlying.address, p.secondAsset.address],
          [parseUnits(p.prices[0], 18), parseUnits(p.prices[1], 18)]
        );
      }

      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, strategy.address, r);
        }
      }

      const ret = await reader.getLockedUnderlyingAmount(strategy.address);
      return {
        estimatedUnderlyingAmount: +formatUnits(ret.estimatedUnderlyingAmount, await p.underlying.decimals()),
        totalAssets: +formatUnits(ret.totalAssets, await p.underlying.decimals()),
      }
    }

    describe("equal prices", () => {
      describe("No debts", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLockedUnderlyingAmountTest(): Promise<IGetLockedUnderlyingAmountResults> {
          return getLockedUnderlyingAmount({
            underlying: usdc,
            secondAsset: wmatic,
            totalAssets: "500"
          })
        }

        it("should return zero estimatedUnderlyingAmount", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.estimatedUnderlyingAmount).eq(0);
        });
        it("should return expected totalAssets", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.totalAssets).eq(500);
        });
      });
      describe("Direct debt", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLockedUnderlyingAmountTest(): Promise<IGetLockedUnderlyingAmountResults> {
          return getLockedUnderlyingAmount({
            underlying: usdc,
            secondAsset: wmatic,
            totalAssets: "500",
            repays: [{
              collateralAsset: usdc,
              borrowAsset: wmatic,
              totalCollateralAmountOut: "1000",
              totalDebtAmountOut: "700",
              collateralAmountOut: "1000",
              amountRepay: "700",
            }]
          })
        }

        it("should return expected estimatedUnderlyingAmount", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.estimatedUnderlyingAmount).eq(300);
        });
        it("should return expected totalAssets", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.totalAssets).eq(500);
        });
      });
      describe("Reverse debt", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLockedUnderlyingAmountTest(): Promise<IGetLockedUnderlyingAmountResults> {
          return getLockedUnderlyingAmount({
            underlying: usdc,
            secondAsset: wmatic,
            totalAssets: "500",
            repays: [{
              collateralAsset: wmatic,
              borrowAsset: usdc,
              totalCollateralAmountOut: "1000",
              totalDebtAmountOut: "700",
              collateralAmountOut: "1000",
              amountRepay: "700",
            }]
          })
        }

        it("should return expected estimatedUnderlyingAmount", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.estimatedUnderlyingAmount).eq(300);
        });
        it("should return expected totalAssets", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.totalAssets).eq(500);
        });
      });
    });
    describe("different prices", () => {
      describe("No debts", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLockedUnderlyingAmountTest(): Promise<IGetLockedUnderlyingAmountResults> {
          return getLockedUnderlyingAmount({
            underlying: usdc,
            secondAsset: wmatic,
            totalAssets: "500",
            prices: ["0.5", "2"]
          })
        }

        it("should return zero estimatedUnderlyingAmount", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.estimatedUnderlyingAmount).eq(0);
        });
        it("should return expected totalAssets", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.totalAssets).eq(500);
        });
      });
      describe("Direct debt", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLockedUnderlyingAmountTest(): Promise<IGetLockedUnderlyingAmountResults> {
          return getLockedUnderlyingAmount({
            underlying: usdc,
            secondAsset: wmatic,
            totalAssets: "500",
            prices: ["0.5", "2"],
            repays: [{
              collateralAsset: usdc,
              borrowAsset: wmatic,
              totalCollateralAmountOut: "8000",
              totalDebtAmountOut: "1200",
              collateralAmountOut: "8000",
              amountRepay: "1200",
            }]
          })
        }

        it("should return expected estimatedUnderlyingAmount", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.estimatedUnderlyingAmount).eq(3200);
        });
        it("should return expected totalAssets", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.totalAssets).eq(500);
        });
      });
      describe("Reverse debt", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLockedUnderlyingAmountTest(): Promise<IGetLockedUnderlyingAmountResults> {
          return getLockedUnderlyingAmount({
            underlying: usdc,
            secondAsset: wmatic,
            totalAssets: "500",
            prices: ["0.5", "2"],
            repays: [{
              collateralAsset: wmatic,
              borrowAsset: usdc,
              totalCollateralAmountOut: "800",
              totalDebtAmountOut: "1200",
              collateralAmountOut: "800",
              amountRepay: "1200",
            }]
          })
        }

        it("should return expected estimatedUnderlyingAmount", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          // 800 * 2 / 0.5 usdc - 12000 usdc = 2000 usdc
          expect(r.estimatedUnderlyingAmount).eq(2000);
        });
        it("should return expected totalAssets", async () => {
          const r = await loadFixture(getLockedUnderlyingAmountTest);
          expect(r.totalAssets).eq(500);
        });
      });
    });
  });

  describe("isWithdrawByAggCallRequired", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IIsParams {
      underlying: MockToken;
      secondAsset: MockToken;

      totalAssets: string;

      fuseStatus?: number;
      withdrawDone?: number;
      allowedLockedAmountPercent?: number;

      repays?: IRepayParams[];
      /** underlying, secondAsset */
      prices?: string[];
    }

    interface IIsResults {
      callResult: number;
    }

    async function callIsWithdrawByAggCallRequired(p: IIsParams): Promise<IIsResults> {
      await strategy.setTotalAssets(parseUnits(p.totalAssets, await p.underlying.decimals()));
      await strategy.setPoolTokens(p.underlying.address, p.secondAsset.address);
      await strategy.setDefaultStateNums([
        0, // IDX_NUMS_DEFAULT_STATE_TOTAL_LIQUIDITY = 0;
        p?.fuseStatus ?? 1, // IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_A = 1;
        0, // IDX_NUMS_DEFAULT_STATE_RESERVED_0 = 2
        p.withdrawDone ?? 0, // IDX_NUMS_DEFAULT_STATE_WITHDRAW_DONE = 3;
        0, // IDX_NUMS_DEFAULT_STATE_THRESHOLD_0 = 4;
        0, // IDX_NUMS_DEFAULT_STATE_THRESHOLD_1 = 5;
        0, // IDX_NUMS_DEFAULT_STATE_THRESHOLD_2 = 6;
        0, // IDX_NUMS_DEFAULT_STATE_THRESHOLD_3 = 7;
        0, // IDX_NUMS_DEFAULT_STATE_RESERVED_0 = 8;
        0, // IDX_NUMS_DEFAULT_STATE_RESERVED_1 = 9;
        0, // IDX_NUMS_DEFAULT_STATE_RESERVED_2 = 10;
        0, // IDX_NUMS_DEFAULT_STATE_RESERVED_3 = 11;
        0, // IDX_NUMS_DEFAULT_STATE_LAST_REBALANCE_NO_SWAP = 12;
      ]);

      await splitter.setAsset(p.underlying.address);

      if (p.prices) {
        await priceOracle.changePrices(
          [p.underlying.address, p.secondAsset.address],
          [parseUnits(p.prices[0], 18), parseUnits(p.prices[1], 18)]
        );
      }

      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, strategy.address, r);
        }
      }

      const callResult = (
        await reader.isWithdrawByAggCallRequired(strategy.address, p.allowedLockedAmountPercent ?? 0)
      ).toNumber();
      return {
        callResult
      }
    }

    describe("Full withdraw", () => {
      it("should return 0 if fuse is not active", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          fuseStatus: 0,
          totalAssets: "500",
          repays: []
        });
        expect(r.callResult).eq(0);
      });
      it("should return 0 if fuse is not triggered", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          fuseStatus: 1,
          totalAssets: "500",
          repays: []
        });
        expect(r.callResult).eq(0);
      });
      it("should return 1 if a fuse A is triggered and withdraw is not completed", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          fuseStatus: 3,
          withdrawDone: 0,

          totalAssets: "500",
          repays: []
        });
        expect(r.callResult).eq(1);
      });
      it("should return 0 if a fuse is triggered but withdraw is completed", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          fuseStatus: 2,
          withdrawDone: 1,

          totalAssets: "500",
          repays: []
        });
        expect(r.callResult).eq(0);
      });
    });
    describe("Debts rebalance", () => {
      it("no debts, should return 0", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          totalAssets: "500",
        });
        expect(r.callResult).eq(0);
      });
      it("direct debt, rebalance is not required, should return 0", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          totalAssets: "500",
          allowedLockedAmountPercent: 90,
          repays: [{
            collateralAsset: usdc,
            borrowAsset: wmatic,
            totalCollateralAmountOut: "1000",
            totalDebtAmountOut: "700",
            collateralAmountOut: "1000",
            amountRepay: "700",
          }]
        });
        expect(r.callResult).eq(0);
      });
      it("direct debt, rebalance is required, should return 2", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          totalAssets: "3000",
          allowedLockedAmountPercent: 10,
          repays: [{
            collateralAsset: usdc,
            borrowAsset: wmatic,
            totalCollateralAmountOut: "1100",
            totalDebtAmountOut: "700",
            collateralAmountOut: "1000",
            amountRepay: "700",
          }]
        });
        expect(r.callResult).eq(2);
      });
      it("reverse debt, rebalance is required, should return 2", async () => {
        const r = await callIsWithdrawByAggCallRequired({
          underlying: usdc,
          secondAsset: wmatic,
          totalAssets: "3000",
          allowedLockedAmountPercent: 50,
          repays: [{
            collateralAsset: wmatic,
            borrowAsset: usdc,
            totalCollateralAmountOut: "11000",
            totalDebtAmountOut: "7000",
            collateralAmountOut: "1000",
            amountRepay: "700",
          }]
        });
        expect(r.callResult).eq(2);
      });
    });
  });

  describe("getAmountToReduceDebt", () => {
    interface IParams {
      collateralAssetA: MockToken;
      borrowAssetB: MockToken;
      isUnderlyingA: boolean;

      totalAssets: string;
      collateralAmountA: string;
      debtAmountB: string;

      pricesAB: string[];
      requiredLockedAmountPercent: string
    }

    interface IResults {
      deltaDebtAmountB: number;
    }

    async function getAmountToReduceDebt(p: IParams): Promise<IResults> {
      const decimalsA = await p.collateralAssetA.decimals();
      const decimalsB = await p.borrowAssetB.decimals();
      const decimalsUnderlying = p.isUnderlyingA ? decimalsA : decimalsB;
      const deltaDebtAmountB = await reader.getAmountToReduceDebt(
        parseUnits(p.totalAssets, decimalsUnderlying),
        p.isUnderlyingA,
        parseUnits(p.collateralAmountA, decimalsA),
        parseUnits(p.debtAmountB, decimalsB),
        [
          parseUnits(p.pricesAB[0], 18),
          parseUnits(p.pricesAB[1], 18),
        ],
        [decimalsA, decimalsB],
        parseUnits(p.requiredLockedAmountPercent, 18)
      )

      return {
        deltaDebtAmountB: +formatUnits(deltaDebtAmountB, decimalsB)
      }
    }

    describe("Direct debt", () => {
      describe("Same prices", () => {
        it("should return expected amount for usdc:dai", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: usdc,
            borrowAssetB: dai,
            isUnderlyingA: true,
            collateralAmountA: "400",
            debtAmountB: "200",
            pricesAB: ["1", "1"],
            totalAssets: "800",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176); // see getAmountToReduceDebt.xlsx
        });
        it("should return expected amount for dai:usdc", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: dai,
            borrowAssetB: usdc,
            isUnderlyingA: true,
            collateralAmountA: "400",
            debtAmountB: "200",
            pricesAB: ["1", "1"],
            totalAssets: "800",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176); // see getAmountToReduceDebt.xlsx
        });
      });
      describe("Different prices", () => {
        it("should return expected amount for usdc:dai", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: usdc,
            borrowAssetB: dai,
            isUnderlyingA: true,
            collateralAmountA: "800",
            debtAmountB: "100",
            pricesAB: ["0.5", "2"],
            totalAssets: "1600",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176 / 2); // see getAmountToReduceDebt.xlsx
        });
        it("should return expected amount for dai:usdc", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: dai,
            borrowAssetB: usdc,
            isUnderlyingA: true,
            collateralAmountA: "800",
            debtAmountB: "100",
            pricesAB: ["0.5", "2"],
            totalAssets: "1600",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176 / 2); // see getAmountToReduceDebt.xlsx
        });
      });
    });
    describe("Reverse debt", () => {
      describe("Same prices", () => {
        it("should return expected amount for usdc:dai", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: usdc,
            borrowAssetB: dai,
            isUnderlyingA: false,
            collateralAmountA: "400",
            debtAmountB: "200",
            pricesAB: ["1", "1"],
            totalAssets: "800",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176); // see getAmountToReduceDebt.xlsx
        });
        it("should return expected amount for dai:usdc", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: dai,
            borrowAssetB: usdc,
            isUnderlyingA: false,
            collateralAmountA: "400",
            debtAmountB: "200",
            pricesAB: ["1", "1"],
            totalAssets: "800",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176); // see getAmountToReduceDebt.xlsx
        });
      });
      describe("Different prices", () => {
        it("should return expected amount for usdc:dai", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: usdc,
            borrowAssetB: dai,
            isUnderlyingA: false,
            collateralAmountA: "800",
            debtAmountB: "100",
            pricesAB: ["0.5", "2"],
            totalAssets: "400",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176 / 2); // see getAmountToReduceDebt.xlsx
        });
        it("should return expected amount for dai:usdc", async () => {
          const {deltaDebtAmountB} = await getAmountToReduceDebt({
            collateralAssetA: dai,
            borrowAssetB: usdc,
            isUnderlyingA: false,
            collateralAmountA: "800",
            debtAmountB: "100",
            pricesAB: ["0.5", "2"],
            totalAssets: "400",
            requiredLockedAmountPercent: "0.03"
          });
          expect(deltaDebtAmountB).eq(176 / 2); // see getAmountToReduceDebt.xlsx
        });
      });
    });
  });
//endregion Unit tests
});
