/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  ConverterStrategyBase__factory,
  IERC20__factory,
} from '../../../../typechain';
import {Misc} from "../../../../scripts/utils/Misc";
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";

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
      await UniversalUtils.movePoolPriceUp(signer1, state, b.swapper, swapAmount);
    } else {
      await UniversalUtils.movePoolPriceDown(signer1, state, b.swapper, swapAmount);
    }
  }
//endregion Utils

//region Unit tests
  describe("Multiple users make actions simultaneously", () => {
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
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer1, signer2);
        await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        describe("Multiple users deposit/withdraw, price changes", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("all users should withdraw expected amounts on balance", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer1);

            const users = [signer2, signer3, signer4, signer5]; // last user doesn't deposit anything
            const amounts = ["100", "1000", "10000", "5000"];
            const deposits = [0, 0, 0, 0];
            const balances = [0, 0, 0, 0];

            for (let i = 0; i < users.length; ++i) {

              // deposit
              for (let j = i + 1; j < users.length; ++j) {
                const signer = users[i];
                const amount = parseUnits(amounts[j], 6);
                // i-th user deposits j-th amount
                await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
                await TokenUtils.getToken(b.asset, signer.address, amount);
                await b.vault.connect(signer).deposit(amount, signer.address, {gasLimit: 19_000_000});
                deposits[i] += +formatUnits(amount, 6);

                await movePrices(b, i % 2 === 0, (i + 1) / 10);

                if (await b.strategy.needRebalance()) {
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
                }
              }

              // withdraw
              for (let j = i + 1; j < users.length; ++j) {
                const signer = users[j];
                const amount = parseUnits(amounts[i], 6);
                // j-th user withdraws i-th amount
                const maxAmount = await b.vault.connect(signer).maxWithdraw(signer.address);
                await b.vault.connect(signer).withdraw(
                    maxAmount.lt(amount) ? maxAmount : amount,
                    signer.address,
                    signer.address,
                    {gasLimit: 19_000_000}
                );
                await movePrices(b, i % 2 === 0, (i + 1) / 10);

                if (await b.strategy.needRebalance()) {
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
                }
              }
            }

            // withdraw-all
            for (let i = 0; i < users.length; ++i) {
              const signer = users[i];
              const maxAmount = await b.vault.connect(signer).maxWithdraw(signer.address);
              if (maxAmount.gt(0)) {
                await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
              }

              await movePrices(b, i % 2 === 0, (i + 1) / 10);
              if (await b.strategy.needRebalance()) {
                await b.strategy.rebalanceNoSwaps(true);
              }

              balances[i] = +formatUnits(
                await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(signer.address),
                6
              );
            }

            console.log("deposits", deposits);
            console.log("balances", balances);
            for (let i = 0; i < users.length - 1; ++i) { // last user doesn't deposit anything
              expect(balances[i]*100/deposits[i]).gt(99); // 1% for fees is ok
            }
          });
        });
      });
    });
  });
//endregion Unit tests
});