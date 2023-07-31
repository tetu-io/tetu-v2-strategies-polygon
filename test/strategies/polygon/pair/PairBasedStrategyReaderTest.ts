/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  ConverterController__factory,
  IERC20,
  IERC20__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IStrategyV2,
  ISwapper,
  ISwapper__factory,
  ITetuConverter,
  ITetuConverter__factory,
  MockSplitter, MockSplitterVault, MockTetuConverter,
  MockToken, PriceOracleMock,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  PairBasedStrategyReaderAccessMock,
  PairBasedStrategyReader,
} from '../../../../typechain';
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {
  getAaveTwoPlatformAdapter, getCompoundThreePlatformAdapter,
  getConverterAddress,
  getDForcePlatformAdapter,
  Misc
} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniswapV3StrategyUtils} from "../../../baseUT/strategies/UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateNum, IStateParams, StateUtilsNum} from '../../../baseUT/utils/StateUtilsNum';
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {BigNumber} from "ethers";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {IBorrowParams, IBorrowParamsNum, IRepayParams} from "../../../baseUT/mocks/TestDataTypes";
import {setupMockedBorrow, setupMockedRepay} from "../../../baseUT/mocks/MockRepayUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

/**
 * Study noSwap-rebalance.
 * Try to change price step by step and check how strategy params are changed
 */
describe('PairBasedStrategyReaderTest', function() {
//region Constants and variables
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  let governance: SignerWithAddress;
  let signer: SignerWithAddress;
  let converter: MockTetuConverter;
  let usdc: MockToken;
  let wmatic: MockToken;
  let usdt: MockToken;
  let strategy: PairBasedStrategyReaderAccessMock;
  let splitter: MockSplitterVault;
  let reader: PairBasedStrategyReader;
  let priceOracle: PriceOracleMock;
//endregion Constants and variables

  //region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    governance = await DeployerUtilsLocal.getControllerGovernance(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
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
//endregion Unit tests
});