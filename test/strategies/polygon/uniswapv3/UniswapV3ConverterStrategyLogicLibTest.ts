import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";
import {
  MockForwarder,
  MockTetuConverter,
  MockTetuLiquidatorSingleCall,
  MockToken,
  PriceOracleMock,
  UniswapV3ConverterStrategyLogicLibFacade,
  MockUniswapV3Pool
} from "../../../../typechain";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

describe('PairBasedStrategyLibTest', () => {
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;
  const FUSE_ON_LOWER_LIMIT_UNDERLYING_4 = 4;
  const FUSE_ON_UPPER_LIMIT_UNDERLYING_5 = 5;

  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;
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
  let facade: UniswapV3ConverterStrategyLogicLibFacade;
  let converter: MockTetuConverter;
  let priceOracleMock: PriceOracleMock;
  let mockedPool: MockUniswapV3Pool;
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
    facade = await MockHelper.createUniswapV3ConverterStrategyLogicLibFacade(signer);
    mockedPool = await MockHelper.createMockUniswapV3Pool(signer);
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
//endregion before, after

//region Unit tests
  describe("_needStrategyRebalance", () => {
    interface IUniv3State {
      tokenA: MockToken;
      tokenB: MockToken;
      pool: string;
      fuse: {
        status: number;
        thresholds: string[];
      };

      isStablePool?: boolean;
      depositorSwapTokens?: boolean;
      totalLiquidity?: number;
      strategyProfitHolder?: string;
    }
    interface INeedStrategyRebalanceParams {
      state: IUniv3State;
      pricesAB: string[];
      poolNeedsRebalance: boolean;
    }
    interface INeedStrategyRebalanceResults {
      strategyRebalanceRequired: boolean;
      fuseStatusChanged: boolean;
      fuseStatus: number;
    }
    async function callNeedStrategyRebalance(p: INeedStrategyRebalanceParams): Promise<INeedStrategyRebalanceResults> {
      const tick = p.poolNeedsRebalance ? 9 : 11;
      const tickSpacing = 10;
      const lowerTick = 10;
      const upperTick = 20;
      const rebalanceTickRange = 0;

      await mockedPool.setSlot0(0, tick, 0, 0, 0, 0, false);
      await priceOracleMock.changePrices(
        [p.state.tokenA.address, p.state.tokenB.address],
        [parseUnits(p.pricesAB[0], 18), parseUnits(p.pricesAB[1], 18)]
      );

      await facade.setState(
        [p.state.tokenA.address, p.state.tokenB.address],
        p.state.pool,
        p.state.isStablePool || true,
        [tickSpacing, lowerTick, upperTick, rebalanceTickRange],
        p.state.depositorSwapTokens || false,
        p.state.totalLiquidity || 0,
        p.state.strategyProfitHolder || ethers.Wallet.createRandom().address,
        {
         status: p.state.fuse.status,
         thresholds: [
           parseUnits(p.state.fuse.thresholds[0], 18),
           parseUnits(p.state.fuse.thresholds[1], 18),
           parseUnits(p.state.fuse.thresholds[2], 18),
           parseUnits(p.state.fuse.thresholds[3], 18),
         ]
        }
      );
      const ret = await facade._needStrategyRebalance(
        converter.address,
        p.state.pool,
        p.state.fuse,
        p.state.tokenA.address,
        p.state.tokenB.address
      );
      return {
        strategyRebalanceRequired: ret.strategyRebalanceRequired,
        fuseStatusChanged: ret.fuseStatusChanged,
        fuseStatus: ret.fuseStatus
      }
    }

    describe("pool requires rebalance", () => {
      describe("fuse is triggered", () => {
        describe("fuse changes its status", () => {
          it("", async () => {
            const ret = await callNeedStrategyRebalance({
              poolNeedsRebalance: true,
              state: {
                tokenA: usdc,
                tokenB: usdt,
                pool: mockedPool.address,
                fuse: {
                  status: FUSE_ON_LOWER_LIMIT_2,
                  thresholds: ["10", "20", "40", "30"]
                }
              },
              pricesAB: ["21"]
            });
          });
        });
        describe("fuse doesn't change its status", () => {

        });
      });
      describe("fuse is not triggered", () => {
        describe("fuse changes its status", () => {

        });
        describe("fuse doesn't change its status", () => {

        });
      });
    });
  });.
//endregion Unit tests
});