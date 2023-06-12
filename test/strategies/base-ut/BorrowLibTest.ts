import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowLibFacade,
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken, PriceOracleMock
} from "../../../typechain";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {IBorrowParamsNum, IRepayParams} from "../../baseUT/mocks/TestDataTypes";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {setupMockedBorrowEntryKind1, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";

describe('ConverterStrategyBaseAccessFixTest', () => {
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
  let facade: BorrowLibFacade;
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
    facade = await MockHelper.createBorrowLibFacade(signer);
    converter = await MockHelper.createMockTetuConverter(signer);
    priceOracleMock = await MockHelper.createPriceOracle(
      signer,
      [usdc.address, usdt.address, tetu.address],
      [parseUnits("1", 6), parseUnits("1", 6), parseUnits("1", 18)]
    );
    const controller = await MockHelper.createMockTetuConverterController(signer, priceOracleMock.address);
    await converter.setController(controller.address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  describe("rebalanceAssets X:Y", () => {
    interface IRebalanceAssetsParams {
      tokenX: MockToken;
      tokenY: MockToken;
      /** [0 .. 100_000] */
      proportion: number;
      strategyBalances: {
        balanceX: string;
        balanceY: string;
      }
      prices?: {
        priceX: string;
        priceY: string;
      }
      repays?: IRepayParams[];
      borrows?: IBorrowParamsNum[];
    }

    interface IRebalanceAssetsResults {
      balanceX: number;
      balanceY: number;
    }

    async function makeRebalanceAssets(p: IRebalanceAssetsParams): Promise<IRebalanceAssetsResults> {
      // set up current balances
      await p.tokenX.mint(
        facade.address,
        parseUnits(p.strategyBalances.balanceX, await p.tokenX.decimals())
      );
      await p.tokenY.mint(
        facade.address,
        parseUnits(p.strategyBalances.balanceY, await p.tokenY.decimals())
      );

      // set prices (1 by default)
      if (p.prices) {
        await priceOracleMock.changePrices(
          [p.tokenX.address, p.tokenX.address],
          [parseUnits(p.prices.priceX, 18), parseUnits(p.prices.priceY, 18)]
        );
      }

      // prepare borrow/repay
      if (p.borrows) {
        for (const borrow of p.borrows) {
          await setupMockedBorrowEntryKind1(
            converter,
            facade.address,
            borrow,
            p.proportion,
            100_000 - p.proportion
          );
        }
      }
      if (p.repays) {
        for (const r of p.repays) {
          await setupMockedRepay(converter, facade.address, r);
        }
      }

      // make rebalancing
      await facade.rebalanceAssets(converter.address, p.tokenX.address, p.tokenY.address, p.proportion);

      // get results
      return {
        balanceX: +formatUnits(
          await p.tokenX.balanceOf(facade.address),
          parseUnits(p.strategyBalances.balanceX, await p.tokenX.decimals())
        ),
        balanceY: +formatUnits(
          await p.tokenY.balanceOf(facade.address),
          parseUnits(p.strategyBalances.balanceY, await p.tokenY.decimals())
        ),
      }
    }

    describe("Current state - no debts", () => {
      describe("Need to increase USDC, reduce USDT", () => {
        async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
          return makeRebalanceAssets({
            tokenX: usdc,
            tokenY: usdt,
            proportion: 50_000,
            strategyBalances: {
              balanceX: "100",
              balanceY: "200"
            },
            borrows: [{
              // collateral = 100, amount to borrow = 25
              // 100 => 80 + 20, collateral = 80, amount to borrow = 20
              // 100 usdc => 25 usdc + 75 usdc; 75 usdc are used to borrow 25 usdt.
              // as result, we will have 25 usdc + 25 usdt on balance
              collateralAsset: usdt,
              collateralAmount: "100",
              collateralAmountOut: "80",
              borrowAsset: usdc,
              maxTargetAmount: "25",
              converter: ethers.Wallet.createRandom().address,
            }]
          })
        }
        it("should set expected balances", async () => {
          const r = await loadFixture(makeRebalanceAssetsTest);
          expect(r.balanceX).eq(125);
          expect(r.balanceY).eq(125);
        });
      });
      describe("Need to reduce X, increase Y", () => {

      });
    });
  });
//endregion Unit tests
});