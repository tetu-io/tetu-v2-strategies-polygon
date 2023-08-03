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
//endregion Constants

//region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let libUniv3: UniswapV3Lib;
  let libAlgebra: AlgebraLib;
  let libKyber: KyberLib;
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
    libUniv3 = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib;
    libAlgebra = await DeployerUtils.deployContract(signer, 'AlgebraLib') as AlgebraLib;
    libKyber = await DeployerUtils.deployContract(signer, 'KyberLib') as KyberLib;
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
    swapAmountPart?: number;
  }

  interface IMovePriceResults {
    states: IStateNum[];
    rebalanceFuseOn?: IPriceFuseStatus;
    rebalanceFuseOff?: IPriceFuseStatus;
    thresholdsA: number[];
    thresholdsB: number[];
  }

  function getLib(platform: string) : UniswapV3Lib | AlgebraLib | KyberLib {
    return platform === PLATFORM_ALGEBRA
      ? libAlgebra
      : platform === PLATFORM_KYBER
        ? libKyber
        : libUniv3;
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
    swapAmountPart?: number
  ): Promise<IPriceFuseStatus | undefined> {
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const currentFuseA = states.length === 0
      ? FUSE_OFF_1
      : states[states.length - 1].fuseStatusA;
    const currentFuseB = states.length === 0
      ? FUSE_OFF_1
      : states[states.length - 1].fuseStatusB;

    for (let i = 0; i < maxCountRebalances; ++i) {
      const amounts = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
      let swapAmount: BigNumber;
      if (useTokenB) {
        const priceB = await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN);
        const swapAmount0 = amounts[1].mul(priceB).div(parseUnits('1', 6));
        swapAmount = swapAmount0.add(swapAmount0.div(swapAmountPart || 100));
      } else {
        const priceA = await lib.getPrice(b.pool, MaticAddresses.USDC_TOKEN);
        const swapAmount0 = amounts[0].mul(priceA).div(parseUnits('1', 6));
        swapAmount = swapAmount0.add(parseUnits('0.001', 6));
      }

      if (movePricesUpDown) {
        await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000);
      } else {
        await UniversalUtils.movePoolPriceDown(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000, !useTokenB);
      }
      states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fw${i}`));
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      if ((await b.strategy.needRebalance())) {
        await b.strategy.rebalanceNoSwaps(true, { gasLimit: 9_000_000 });
        const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r${i}`);
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
    const lib = getLib(platform);

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
      p.swapAmountPart
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
      p.swapAmountPart
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

  // /**
  //  * Deploy TetuConverter-contract and upgrade proxy
  //  */
  // async function injectTetuConverter() {
  //   const core = await DeployerUtilsLocal.getCoreAddresses();
  //   const tetuConverter = getConverterAddress();
  //
  //   const converterLogic = await DeployerUtils.deployContract(signer, "TetuConverter");
  //   const controller = ControllerV2__factory.connect(core.controller, signer);
  //   const governance = await controller.governance();
  //   const controllerAsGov = controller.connect(await Misc.impersonate(governance));
  //
  //   await controllerAsGov.announceProxyUpgrade([tetuConverter], [converterLogic.address]);
  //   await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
  //   await controllerAsGov.upgradeProxy([tetuConverter]);
  // }
//endregion Utils

//region Unit tests
  describe('Increase price N steps, decrease price N steps', function () {
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

        const lib = getLib(await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM());
        const priceA = +formatUnits(await lib.getPrice(b.pool, MaticAddresses.USDC_TOKEN), 6);
        const priceB = +formatUnits(await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN), 6);
        console.log("priceA, priceB", priceA, priceB);

        const ttA = [priceA - 0.0008, priceA - 0.0006, priceA + 0.0008, priceA + 0.0006].map(x => parseUnits(x.toString(), 18));
        const ttB = [priceB - 0.0008, priceB - 0.0006, priceB + 0.0008, priceB + 0.0006].map(x => parseUnits(x.toString(), 18));
        console.log("ttA, ttB", ttA, ttB);
        // ["0.9996", "0.9998", "1.0003", "1.0001"];
        await b.strategy.setFuseThresholds(
          0,
          [ttA[0], ttA[1], ttA[2], ttA[3]]
        );
        await b.strategy.setFuseThresholds(
          1,
          [ttB[0], ttB[1], ttB[2], ttB[3]]
        );
        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        describe("Use liquidator", () => {
          describe('Move tokenB prices up, down', function () {
            async function makeTest(): Promise<IMovePriceResults> {
              const b = await loadFixture(prepareStrategy);
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-up-down.csv`;
              return movePriceUpDown(b,{
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: true,
                swapAmountPart: 100
              });
            }
            it("should trigger fuse to FUSE_ON_UPPER_LIMIT_3", async () => {
              const ret = await loadFixture(makeTest);
              console.log("ret", ret);
              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_UPPER_LIMIT_3);
              expect(ret.rebalanceFuseOn?.price || 0).gte(ret.thresholdsB[FUSE_IDX_UPPER_LIMIT_ON]);
            });
            it("should trigger fuse OFF at the end", async () => {
              const ret = await loadFixture(makeTest);
              console.log("ret", ret);
              const status = ret.rebalanceFuseOff?.fuseStatus || 0;
              expect(status === FUSE_OFF_1 || status === FUSE_ON_LOWER_LIMIT_2).eq(true);
              expect(ret.rebalanceFuseOff?.price || 0).lte(ret.thresholdsB[FUSE_IDX_UPPER_LIMIT_OFF]);
            });
          });
          describe('Move tokenB prices down, up', function () {
            async function makeTest(): Promise<IMovePriceResults> {
              const b = await loadFixture(prepareStrategy);
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-down-up.csv`;
              return movePriceUpDown(b,{
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: false,
                swapAmountPart: 500
              });
            }
            it("should trigger fuse ON (FUSE_ON_LOWER_LIMIT_2)", async () => {
              const ret = await loadFixture(makeTest);
              console.log("ret", ret);
              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_LOWER_LIMIT_2);
              expect(ret.rebalanceFuseOn?.price || 0).lte(ret.thresholdsB[FUSE_IDX_LOWER_LIMIT_ON]);
            });
            it("should trigger fuse OFF at the end", async () => {
              const ret = await loadFixture(makeTest);
              console.log("ret", ret);
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