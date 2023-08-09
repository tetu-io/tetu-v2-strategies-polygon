/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  AlgebraLib,
  ConverterStrategyBase__factory,
  IERC20__factory, KyberLib, UniswapV3Lib,
} from '../../../../typechain';
import {Misc} from "../../../../scripts/utils/Misc";
import {defaultAbiCoder, formatUnits, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {MaticAddresses} from '../../../../scripts/addresses/MaticAddresses';
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {PairStrategyLiquidityUtils} from "../../../baseUT/strategies/PairStrategyLiquidityUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
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
 * Try to make several actions one by one
 */
describe('PairBasedStrategyMultipleActionsIntTest', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) return;

//region Constants
  const ENTRY_TO_POOL_DISABLED = 0;
  const ENTRY_TO_POOL_IS_ALLOWED = 1;
  const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;

  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;

  const FUSE_IDX_LOWER_LIMIT_ON = 0;
  const FUSE_IDX_LOWER_LIMIT_OFF = 1;
  const FUSE_IDX_UPPER_LIMIT_ON = 2;
  const FUSE_IDX_UPPER_LIMIT_OFF = 3;

  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;
//endregion Constants

//region Variables
  let snapshotBefore: string;

  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
  let signer4: SignerWithAddress;
  let signer5: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer1, signer2, signer3, signer4, signer5] = await ethers.getSigners();
  })

  after(async function() {
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
  async function movePrices(b: IBuilderResults, movePricesUp: boolean, swapAmountRatio: number) {
    const state = await PackedData.getDefaultState(b.strategy);
    const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
        signer1,
        b,
        state.tokenA,
        state.tokenB,
        movePricesUp,
        swapAmountRatio
    );
    if (movePricesUp) {
      await UniversalUtils.movePoolPriceUp(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount);
    } else {
      await UniversalUtils.movePoolPriceDown(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount);
    }
  }
//endregion Utils

//region Unit tests
  describe("Deposit, rebalance, withdraw-all", () => {
    interface IStrategyInfo {
      name: string,
    }
    const strategies: IStrategyInfo[] = [
      { name: PLATFORM_UNIV3,},
      { name: PLATFORM_ALGEBRA,},
      { name: PLATFORM_KYBER,},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
       * Fuse OFF by default, rebalance is not needed
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer1, signer2);
        await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
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

        it("multiple users should deposit/withdraw successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer1);

          const users = [signer2, signer3, signer4, signer5];
          const amounts = ["100", "1000", "10000", "5000"];

          for (let i = 0; i < users.length; ++i) {

            for (let j = i + 1; j < users.length; ++j) {
              const signer = users[i];
              const amount = parseUnits(amounts[j], 6);
              // i-th user deposits j-th amount
              await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
              await TokenUtils.getToken(b.asset, signer.address, amount);
              await b.vault.connect(signer).deposit(amount, signer.address);

              await movePrices(b, i % 2 === 0, (i + 1) / 10);

              if (await b.strategy.needRebalance()) {
                await b.strategy.rebalanceNoSwaps(true);
              }
            }

            for (let j = i + 1; j < users.length; ++j) {
              const signer = users[j];
              const amount = parseUnits(amounts[i], 6);
              // j-th user withdraws i-th amount
              const maxAmount = await b.vault.connect(signer).maxWithdraw();
              await b.vault.connect(signer).withdraw(
                  maxAmount.lt(amount) ? maxAmount : amount,
                  signer.address,
                  signer.address
              );
              await movePrices(b, i % 2 === 0, (i + 1) / 10);

              if (await b.strategy.needRebalance()) {
                await b.strategy.rebalanceNoSwaps(true);
              }
            }
          }
        });
      });
    });
  });
//endregion Unit tests
});