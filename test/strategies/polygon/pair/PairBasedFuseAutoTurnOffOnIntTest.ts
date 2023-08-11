/* tslint:disable:no-trailing-whitespace */
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  IERC20__factory,
  UniswapV3Lib,
  ConverterStrategyBase__factory, AlgebraLib, KyberLib,
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {IDefaultState, PackedData} from "../../../baseUT/utils/PackedData";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PairStrategyLiquidityUtils} from "../../../baseUT/strategies/PairStrategyLiquidityUtils";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/PairBasedStrategyPrepareStateUtils";

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
 * Check how fuse triggered ON/OFF because of price changing.
 */
describe('PairBasedFuseAutoTurnOffOnIntTest', function () {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }
//region Constants
  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;

  const FUSE_IDX_LOWER_LIMIT_ON = 0;
  const FUSE_IDX_LOWER_LIMIT_OFF = 1;
  const FUSE_IDX_UPPER_LIMIT_ON = 2;
  const FUSE_IDX_UPPER_LIMIT_OFF = 3;

  const DEFAULT_SWAP_AMOUNT_RATIO = 1.01;
//endregion Constants

//region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

  //region before, after
  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: undefined,
          },
        },
      ],
    });

    [signer, signer2] = await ethers.getSigners();
  })

  after(async function () {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: parseInt(process.env.TETU_MATIC_FORK_BLOCK || '', 10) || undefined,
          },
        },
      ],
    });
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Utils
  interface IPriceFuseStatus {
    price: number;
    fuseStatus: number;
  }

  interface IMovePriceParams {
    pathOut: string;
    maxCountRebalances: number;
    /** up-down OR down-up */
    movePricesUpDown: boolean;
    swapAmountRatio?: number;
  }

  interface IMovePriceResults {
    states: IStateNum[];
    rebalanceFuseOn?: IPriceFuseStatus;
    rebalanceFuseOff?: IPriceFuseStatus;
    thresholdsA: number[];
    thresholdsB: number[];
  }

  async function movePriceToChangeFuseStatus(
    b: IBuilderResults,
    movePricesUpDown: boolean,
    useTokenB: boolean,
    maxCountRebalances: number,
    platform: string,
    lib: UniswapV3Lib | AlgebraLib | KyberLib,
    state: IDefaultState,
    states: IStateNum[],
    pathOut: string,
    swapAmountRatio?: number
  ): Promise<IPriceFuseStatus | undefined> {
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const currentFuseA = states.length === 0
      ? FUSE_OFF_1
      : states[states.length - 1].fuseStatusA;
    const currentFuseB = states.length === 0
      ? FUSE_OFF_1
      : states[states.length - 1].fuseStatusB;

    for (let i = 0; i < maxCountRebalances; ++i) {
      const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
        signer,
        b,
        state.tokenA,
        state.tokenB,
        movePricesUpDown,
          swapAmountRatio ?? DEFAULT_SWAP_AMOUNT_RATIO
      );
      console.log("movePriceToChangeFuseStatus.swapAmount", swapAmount);

      if (movePricesUpDown) {
        await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000);
      } else {
        await UniversalUtils.movePoolPriceDown(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000, !useTokenB);
      }

      states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fw${i}`, {lib}));
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      if ((await b.strategy.needRebalance())) {
        await b.strategy.rebalanceNoSwaps(true, { gasLimit: 9_000_000 });
        const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r${i}`, {lib});
        states.push(stateAfterRebalance);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        if (stateAfterRebalance.fuseStatusB !== currentFuseB) {
          return {
            fuseStatus: stateAfterRebalance.fuseStatusB || 0,
            price: stateAfterRebalance.converterDirect.borrowAssetsPrices[1]
          };
        }
        if (stateAfterRebalance.fuseStatusA !== currentFuseA) {
          return {
            fuseStatus: stateAfterRebalance.fuseStatusA || 0,
            price: stateAfterRebalance.converterDirect.borrowAssetsPrices[0]
          };
        }
      }
    }
  }

  async function movePriceUpDown(b: IBuilderResults, p: IMovePriceParams): Promise<IMovePriceResults> {
    const states: IStateNum[] = [];
    const pathOut = p.pathOut;
    let rebalanceFuseOn: IPriceFuseStatus | undefined;
    let rebalanceFuseOff: IPriceFuseStatus | undefined;
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const platform = await converterStrategyBase.PLATFORM();
    const lib = await PairBasedStrategyPrepareStateUtils.getLib(platform, b);

    console.log('deposit...');
    await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(b.asset, signer.address, parseUnits('1000', 6));
    await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

    const state = await PackedData.getDefaultState(b.strategy);
    console.log("=========================== there");
    rebalanceFuseOn = await movePriceToChangeFuseStatus(
      b,
      p.movePricesUpDown,
      platform !== PLATFORM_KYBER,
      p.maxCountRebalances,
      platform,
      lib,
      state,
      states,
      pathOut,
      p.swapAmountRatio
    );

    console.log("=========================== back");

    rebalanceFuseOff = await movePriceToChangeFuseStatus(
      b,
      !p.movePricesUpDown,
      platform !== PLATFORM_KYBER,
      p.maxCountRebalances,
      platform,
      lib,
      state,
      states,
      pathOut,
      p.swapAmountRatio
    );

    console.log("=========================== done");

    return {
      states,
      rebalanceFuseOn,
      rebalanceFuseOff,
      thresholdsA: state.fuseThresholdsA,
      thresholdsB: state.fuseThresholdsB
    };
  }
//endregion Utils

//region Unit tests
  describe('Increase price N steps, decrease price N steps, default swapAmountRatio (1.001)', function () {
    interface IStrategyInfo {
      name: string,
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3,},
      { name: PLATFORM_ALGEBRA,},
      { name: PLATFORM_KYBER,},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

        await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        describe("Use liquidator", () => {
          describe('Move tokenB prices up, down', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();

              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeTest(): Promise<IMovePriceResults> {
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-up-down.csv`;
              return movePriceUpDown(builderResults,{
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: true,
              });
            }
            it("should trigger fuse to FUSE_ON_UPPER_LIMIT_3", async () => {
              const ret = await loadFixture(makeTest);
              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_UPPER_LIMIT_3);
              expect(ret.rebalanceFuseOn?.price || 0).gte(ret.thresholdsB[FUSE_IDX_UPPER_LIMIT_ON]);
            });
            it("should trigger fuse OFF at the end", async () => {
              const ret = await loadFixture(makeTest);
              const status = ret.rebalanceFuseOff?.fuseStatus || 0;
              expect(status === FUSE_OFF_1 || status === FUSE_ON_LOWER_LIMIT_2).eq(true);
              expect(ret.rebalanceFuseOff?.price || 0).lte(ret.thresholdsB[FUSE_IDX_UPPER_LIMIT_OFF]);
            });
          });
          describe('Move tokenB prices down, up', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();

              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeTest(): Promise<IMovePriceResults> {
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-down-up.csv`;
              return movePriceUpDown(builderResults,{
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: false,
              });
            }
            it("should trigger fuse ON (FUSE_ON_LOWER_LIMIT_2)", async () => {
              const ret = await loadFixture(makeTest);
              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_LOWER_LIMIT_2);
              expect(ret.rebalanceFuseOn?.price || 0).lte(ret.thresholdsB[FUSE_IDX_LOWER_LIMIT_ON]);
            });
            it("should trigger fuse OFF at the end", async () => {
              const ret = await loadFixture(makeTest);
              const status = ret.rebalanceFuseOff?.fuseStatus || 0;
              expect(status === FUSE_OFF_1 || status === FUSE_ON_UPPER_LIMIT_3).eq(true);
              expect(ret.rebalanceFuseOff?.price || 0).gte(ret.thresholdsB[FUSE_IDX_LOWER_LIMIT_OFF]);
            });
          });
        });
      });
    });
  });

  describe('Increase price N steps, decrease price N steps, swapAmountRatio = 1', function () {
    interface IStrategyInfo {
      name: string,
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3,},
      { name: PLATFORM_ALGEBRA,},

      // For Kyber we have error NOT_ALLOWED ('TS-23 not allowed') here
      // It means, that required proportion of one of the assets is too small, almost zero
      // It was decided, that it's ok to have revert in that case
      // We can change this behavior by changing BorrowLib.rebalanceRepayBorrow implementation:
      //      if amount-to-repay passed to _repayDebt is too small to be used,
      //      we should increase it min amount required to make repay successfully (amount must be > threshold)

      // { name: PLATFORM_KYBER,},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

        await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        describe("Use liquidator", () => {
          describe('Move tokenB prices up, down', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();

              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeTest(): Promise<IMovePriceResults> {
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-up-down.csv`;
              return movePriceUpDown(builderResults,{
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: true,
                swapAmountRatio: 1
              });
            }
            it("should trigger fuse to FUSE_ON_UPPER_LIMIT_3", async () => {
              const ret = await loadFixture(makeTest);
              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_UPPER_LIMIT_3);
              expect(ret.rebalanceFuseOn?.price || 0).gte(ret.thresholdsB[FUSE_IDX_UPPER_LIMIT_ON]);
            });
            it("should trigger fuse OFF at the end", async () => {
              const ret = await loadFixture(makeTest);
              const status = ret.rebalanceFuseOff?.fuseStatus || 0;
              expect(status === FUSE_OFF_1 || status === FUSE_ON_LOWER_LIMIT_2).eq(true);
              expect(ret.rebalanceFuseOff?.price || 0).lte(ret.thresholdsB[FUSE_IDX_UPPER_LIMIT_OFF]);
            });
          });
          describe('Move tokenB prices down, up', function () {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();

              builderResults = await prepareStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });
            async function makeTest(): Promise<IMovePriceResults> {
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-down-up.csv`;
              return movePriceUpDown(builderResults,{
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: false,
                swapAmountRatio: 1
              });
            }
            it("should trigger fuse ON (FUSE_ON_LOWER_LIMIT_2)", async () => {
              const ret = await loadFixture(makeTest);
              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_LOWER_LIMIT_2);
              expect(ret.rebalanceFuseOn?.price || 0).lte(ret.thresholdsB[FUSE_IDX_LOWER_LIMIT_ON]);
            });
            it("should trigger fuse OFF at the end", async () => {
              const ret = await loadFixture(makeTest);
              const status = ret.rebalanceFuseOff?.fuseStatus || 0;
              expect(status === FUSE_OFF_1 || status === FUSE_ON_UPPER_LIMIT_3).eq(true);
              expect(ret.rebalanceFuseOff?.price || 0).gte(ret.thresholdsB[FUSE_IDX_LOWER_LIMIT_OFF]);
            });
          });
        });
      });
    });
  });
//endregion Unit tests
});