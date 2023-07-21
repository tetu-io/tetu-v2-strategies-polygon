import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IterationPlanLibFacade,
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock
} from "../../../typechain";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

describe('IterationPlanLibTest', () => {
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  //region Variables
  let snapshotBefore: string;
  let snapshot: string;
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
  let facade: IterationPlanLibFacade;
  let converter: MockTetuConverter;
  let priceOracleMock: PriceOracleMock;
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
    facade = await MockHelper.createIterationPlanLibFacade(signer);
    converter = await MockHelper.createMockTetuConverter(signer);
    priceOracleMock = await MockHelper.createPriceOracle(
      signer,
      [usdc.address, usdt.address, tetu.address],
      [parseUnits("1", 18), parseUnits("1", 18), parseUnits("1", 18)]
    );
    const controller = await MockHelper.createMockTetuConverterController(signer, priceOracleMock.address);
    await converter.setController(controller.address);
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
  /**
   * See 20230717.3.estimateSwapAmountForRepaySwapRepay.xlsx
   */
  describe("estimateSwapAmountForRepaySwapRepay", () => {
    interface IEstimateSwapAmountParams {
      balancesAB: string[];
      indicesAB: number[];
      propB: string;
      amountToRepayB: string;
      collateralA: string;
      totalCollateralA: string;
      totalBorrowB: string;
      prices: string[];
      decimals: number[];
    }
    interface IEstimateSwapAmountResults {
      amountToSwapA: number;
    }
    async function makeEstimateSwapAmount(p: IEstimateSwapAmountParams): Promise<IEstimateSwapAmountResults> {
      const decimalsA = p.decimals[p.indicesAB[0]];
      const decimalsB = p.decimals[p.indicesAB[1]];
      const amountToSwapA = await facade.estimateSwapAmountForRepaySwapRepay(
        {
          prices: [
            parseUnits(p.prices[0], 18),
            parseUnits(p.prices[1], 18),
          ],
          decs: [
            parseUnits("1", decimalsA),
            parseUnits("1", decimalsB),
          ],
          converter: Misc.ZERO_ADDRESS, // not used here
          liquidator: MaticAddresses.TETU_LIQUIDATOR,
          tokens: [], // not used here
          liquidationThresholds: [], // not used here
          balanceAdditions: [], // not used here
          planKind: 0, // not used here
          propNotUnderlying18: 0, // not used here
          usePoolProportions: false
        },
        parseUnits(p.balancesAB[0], decimalsA),
        parseUnits(p.balancesAB[1], decimalsB),
        p.indicesAB[0],
        p.indicesAB[1],
        parseUnits(p.propB, 18),
        parseUnits(p.totalCollateralA, decimalsA),
        parseUnits(p.totalBorrowB, decimalsB),
        parseUnits(p.collateralA, decimalsA),
        parseUnits(p.amountToRepayB, decimalsB),
      );
      return {
        amountToSwapA: +formatUnits(amountToSwapA, decimalsA)
      }
    }

    describe("Same prices, same decimals, equal proportions", () => {
      describe("Full swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["1000", "200"],
            indicesAB: [0, 1],
            propB: "0.5",

            amountToRepayB: "200",
            totalBorrowB: "5000",
            totalCollateralA: "10000",
            collateralA: "380",

            decimals: [6, 6],
            prices: ["1", "1"],
          });

          // 20230706.2.calc.xlsx
          expect(r.amountToSwapA).eq(1380);
        });
      });
      describe("Partial swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["1000", "200"],
            indicesAB: [0, 1],
            propB: "0.5",

            totalCollateralA: "600",
            totalBorrowB: "300",

            collateralA: "400",
            amountToRepayB: "200",

            decimals: [6, 6],
            prices: ["1", "1"],
          });

          // 20230706.2.calc.xlsx
          expect(r.amountToSwapA).eq(700);
        });
      });
    });
    describe("Same prices, different decimals, equal proportions", () => {
      describe("Full swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["1000", "200"],
            indicesAB: [0, 1],
            propB: "0.5",

            amountToRepayB: "200",
            totalBorrowB: "5000",
            totalCollateralA: "10000",
            collateralA: "380",

            decimals: [18, 6],
            prices: ["1", "1"],
          });

          // 20230706.2.calc.xlsx
          expect(r.amountToSwapA).eq(1380);
        });
      });
      describe("Partial swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["1000", "200"],
            indicesAB: [0, 1],
            propB: "0.5",

            totalCollateralA: "600",
            totalBorrowB: "300",

            collateralA: "400",
            amountToRepayB: "200",

            decimals: [6, 18],
            prices: ["1", "1"],
          });

          // 20230706.2.calc.xlsx
          expect(r.amountToSwapA).eq(700);
        });
      });
    });
    describe("Different prices, same decimals, equal proportions", () => {
      describe("Full swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["500", "400"],
            indicesAB: [0, 1],
            propB: "0.5",

            totalCollateralA: "5000",
            totalBorrowB: "10000",

            collateralA: "190",
            amountToRepayB: "400",

            decimals: [6, 6],
            prices: ["2", "0.5"],
          });

          // 20230706.2.calc.xlsx, balanceA + collateralA = 690
          expect(r.amountToSwapA).eq(690);
        });
      });
      describe("Partial swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["500", "400"],
            indicesAB: [0, 1],
            propB: "0.5",

            totalCollateralA: "300",
            totalBorrowB: "600",

            collateralA: "200",
            amountToRepayB: "400",

            decimals: [6, 6],
            prices: ["2", "0.5"],
          });

          // 20230706.2.calc.xlsx, s = 0.25, aB3 = 116.6667, aB2 = 1120 * 0.5 = 560
          expect(r.amountToSwapA).eq(560);
        });
      });
    });
    describe("Same prices, same decimals, different proportions", () => {
      describe("Full swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["1000", "200"],
            indicesAB: [0, 1],
            propB: "0.25",

            totalCollateralA: "10000",
            totalBorrowB: "5000",

            collateralA: "400",
            amountToRepayB: "200",

            decimals: [6, 6],
            prices: ["1", "1"],
          });

          // 20230706.2.calc.xlsx
          expect(r.amountToSwapA).eq(1400);
        });
      });
      describe("Partial swap", () => {
        it("should return expected amount-to-swap", async () => {
          const r = await makeEstimateSwapAmount({
            balancesAB: ["1000", "200"],
            indicesAB: [0, 1],
            propB: "0.25",

            totalCollateralA: "600",
            totalBorrowB: "300",

            collateralA: "400",
            amountToRepayB: "200",

            decimals: [6, 6],
            prices: ["1", "1"],
          });

          // 20230706.2.calc.xlsx
          expect(r.amountToSwapA).eq(350);
        });
      });
    });
  });

  describe("getEntryKind", () => {
    it("should return default value", async () => {
      expect((await facade.getEntryKind("0x")).toNumber()).eq(PLAN_SWAP_REPAY)
    });
    it("should return PLAN_SWAP_REPAY", async () => {
      const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_SWAP_REPAY, 1]);
      expect((await facade.getEntryKind(entryData)).toNumber()).eq(PLAN_SWAP_REPAY)
    });
    it("should return PLAN_REPAY_SWAP_REPAY", async () => {
      const entryData = defaultAbiCoder.encode(['uint256'], [PLAN_REPAY_SWAP_REPAY]);
      expect((await facade.getEntryKind(entryData)).toNumber()).eq(PLAN_REPAY_SWAP_REPAY)
    });
    it("should return PLAN_SWAP_ONLY", async () => {
      const entryData = defaultAbiCoder.encode(['uint256', 'uint256'], [PLAN_SWAP_ONLY, 1]);
      expect((await facade.getEntryKind(entryData)).toNumber()).eq(PLAN_SWAP_ONLY)
    });
  });

  describe("_buildPlanRepaySwapRepay", () => {
    describe("Bad paths", () => {
      it("should revert if balance B is zero", async () => {
        await expect(
          facade._buildPlanRepaySwapRepay(
            { // following values are not used in this test
              tokens: [usdc.address, usdt.address],
              converter: converter.address,
              liquidator: MaticAddresses.TETU_LIQUIDATOR,
              prices: [],
              decs: [],
              planKind: 0,
              usePoolProportions: false,
              balanceAdditions: [],
              propNotUnderlying18: 0,
              liquidationThresholds: []
            },
            [1000, 0],
            [0, 1], // any values
            1, // any value
            1, // any value
            1 // any value
          )
        ).revertedWith("TS-26 need 2 iterations of unfolding"); // UNFOLDING_2_ITERATIONS_REQUIRED
      });
    });
  });
//endregion Unit tests
});