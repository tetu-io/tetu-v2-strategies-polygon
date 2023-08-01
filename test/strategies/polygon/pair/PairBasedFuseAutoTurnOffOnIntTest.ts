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
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PairStrategyLiquidityUtils} from "../../../baseUT/strategies/PairStrategyLiquidityUtils";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";

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

describe('PairBasedFuseAutoTurnOffOnIntTest', function () {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }
//region Constants
  const DEFAULT_FUSE_THRESHOLDS = ["0.9996", "0.9998", "1.0003", "1.0001"];

  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;
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
  }

  async function movePriceUpDown(b: IBuilderResults, p: IMovePriceParams): Promise<IMovePriceResults> {
    const states: IStateNum[] = [];
    const pathOut = p.pathOut;
    let rebalanceFuseOn: IPriceFuseStatus | undefined;
    let rebalanceFuseOff: IPriceFuseStatus | undefined;
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const platform = await converterStrategyBase.PLATFORM();
    const lib = platform === PLATFORM_ALGEBRA
        ? libAlgebra
        : platform === PLATFORM_KYBER
          ? libKyber
          : libUniv3;

    console.log('deposit...');
    await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(b.asset, signer.address, parseUnits('1000', 6));
    await b.vault.deposit(parseUnits('1000', 6), signer.address);

    const swapAmounts: BigNumber[] = [];

    const state = await PackedData.getDefaultState(b.strategy);
    for (let i = 0; i < p.maxCountRebalances; ++i) {
      console.log(`Swap and rebalance. Step ${i}`);
      const amounts = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
      const priceB = await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN);
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6));
      swapAmount = swapAmount.add(swapAmount.div(p.swapAmountPart || 100));
      swapAmounts.push(swapAmount);

      if (p.movePricesUpDown) {
        await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount);
      } else {
        await UniversalUtils.movePoolPriceDown(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount);
      }
      states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fw${i}`));
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      if ((await b.strategy.needRebalance())) {
        await b.strategy.rebalanceNoSwaps(true, { gasLimit: 9_000_000 });
        const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r${i}`);
        states.push(stateAfterRebalance);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        if (stateAfterRebalance.fuseStatusB !== FUSE_OFF_1) {
          rebalanceFuseOn = {
            fuseStatus: stateAfterRebalance.fuseStatusB || 0,
            price: stateAfterRebalance.converterDirect.borrowAssetsPrices[1]
          };
          break;
        }
      }
    }

    console.log("===========================");
    for (let i = 0; i < p.maxCountRebalances; ++i) {
      console.log(`Swap and rebalance. Step ${i}`);
      const amounts = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
      const priceB = await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN);
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6));
      swapAmount = swapAmount.add(swapAmount.div(p.swapAmountPart || 100));
      swapAmounts.push(swapAmount);

      if (p.movePricesUpDown) {
        await UniversalUtils.movePoolPriceDown(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount);
      } else {
        await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount);
      }
      states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `back${i}`));
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      if ((await b.strategy.needRebalance())) {
        await b.strategy.rebalanceNoSwaps(true, { gasLimit: 9_000_000 });
        const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r${i}`);
        states.push(stateAfterRebalance);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        if (stateAfterRebalance.fuseStatusB === FUSE_OFF_1) {
          rebalanceFuseOff = {
            fuseStatus: stateAfterRebalance.fuseStatusB || 0,
            price: stateAfterRebalance.converterDirect.borrowAssetsPrices[1]
          };
          break;
        }
      }
    }

    return {states, rebalanceFuseOn, rebalanceFuseOff};
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
      let snapshot: string;

      async function prepareStrategy(): Promise<IBuilderResults> {
        return PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);
      }

      describe(`${strategyInfo.name}`, () => {
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });
        describe("Use liquidator", () => {
          describe('Move tokenB prices up, down', function () {
            it("should trigger fuse ON (FUSE_ON_UPPER_LIMIT_3) then OFF", async () => {
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-up-down-b.csv`;
              const ret = await movePriceUpDown({
                maxCountRebalances: 7,
                pathOut,
                movePricesUpDown: true
              });
              console.log("ret.rebalanceFuseOff", ret.rebalanceFuseOff);
              console.log("ret.rebalanceFuseOn", ret.rebalanceFuseOn);

              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_UPPER_LIMIT_3);
              expect(ret.rebalanceFuseOn?.price || 0).gte(1.0003);

              expect(ret.rebalanceFuseOff?.fuseStatus || 0).eq(FUSE_OFF_1);
              expect(ret.rebalanceFuseOff?.price || 0).lte(1.0001);
            });
          });
          describe('Move tokenB prices down, up', function () {
            it("should trigger fuse ON (FUSE_ON_LOWER_LIMIT_2) then OFF", async () => {
              const pathOut = `./tmp/${strategyInfo.name}-fuse-move-prices-down-up-b.csv`;
              const ret = await movePriceUpDown({
                maxCountRebalances: 25,
                pathOut,
                movePricesUpDown: false,
                swapAmountPart: 150
              });
              console.log("ret.rebalanceFuseOff", ret.rebalanceFuseOff);
              console.log("ret.rebalanceFuseOn", ret.rebalanceFuseOn);

              expect(ret.rebalanceFuseOn?.fuseStatus || 0).eq(FUSE_ON_LOWER_LIMIT_2);
              expect(ret.rebalanceFuseOn?.price || 0).lte(0.9996);

              expect(ret.rebalanceFuseOff?.fuseStatus || 0).eq(FUSE_OFF_1);
              expect(ret.rebalanceFuseOff?.price || 0).gte(0.9998);
            });
          });
        });
      });
    });
  });

//endregion Unit tests
});