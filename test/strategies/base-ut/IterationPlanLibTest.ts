import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowLibFacade,
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
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";

describe('IterationPlanLibTest', () => {
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
      tokens: MockToken[];
      prices: string[];
      balanceA: string;
      balanceB: string;
      indexA: number;
      indexB: number;
      propB: string;
      totalCollateralA: string;
      totalBorrowB: string;
      collateralA: string;
      amountToRepayB: string;
    }
    interface IEstimateSwapAmountResults {
      resultSwapAmount: number;
    }

    async function callEstimateSwapAmount(p: IEstimateSwapAmountParams): Promise<IEstimateSwapAmountResults> {
      const resultSwapAmount = await facade.estimateSwapAmountForRepaySwapRepay(
        {
          converter: converter.address,
          tokens: p.tokens.map(x => x.address),
          liquidationThresholds: [], // not used here
          prices: p.prices.map(x => parseUnits(x, 18)),
          decs: await Promise.all(p.tokens.map(async x => x.decimals())),
          balanceAdditions: [], // not used here
          planKind: 0, // not used here
          propNotUnderlying18: 0, // not used here
          usePoolProportions: false // not used here
        },
        parseUnits(p.balanceA, await p.tokens[p.indexA].decimals()),
        parseUnits(p.balanceB, await p.tokens[p.indexB].decimals()),
        p.indexA,
        p.indexB,
        parseUnits(p.propB, 18),
        parseUnits(p.totalCollateralA, await p.tokens[p.indexA].decimals()),
        parseUnits(p.totalBorrowB, await p.tokens[p.indexB].decimals()),
        parseUnits(p.collateralA, await p.tokens[p.indexA].decimals()),
        parseUnits(p.amountToRepayB, await p.tokens[p.indexB].decimals()),
      );
      return {
        resultSwapAmount: +formatUnits(resultSwapAmount, await p.tokens[p.indexA].decimals())
      }
    }

    describe("full swap", () => {
      it("should return expected amount", async () => {
        const ret = await callEstimateSwapAmount({
          tokens: [usdc, usdt],
          balanceA: "1000",
          balanceB: "200",
          indexA: 0,
          indexB: 1,
          prices: ["1", "1"],
          propB: "0.5",
          totalCollateralA: "10000",
          totalBorrowB: "5000",
          amountToRepayB: "200",
          collateralA: "380"
        });
        expect(ret.resultSwapAmount).eq(1380);
      });
    });
    describe("partial swap", () => {
      it("should return expected amount", async () => {
        const ret = await callEstimateSwapAmount({
          tokens: [usdc, usdt],
          balanceA: "1000",
          balanceB: "200",
          indexA: 0,
          indexB: 1,
          prices: ["1", "1"],
          propB: "0.8",
          totalCollateralA: "450",
          totalBorrowB: "300",
          amountToRepayB: "200",
          collateralA: "300"
        });
        expect(ret.resultSwapAmount).approximately(1040, 1e-5);
      });
    });
  });
//endregion Unit tests
});