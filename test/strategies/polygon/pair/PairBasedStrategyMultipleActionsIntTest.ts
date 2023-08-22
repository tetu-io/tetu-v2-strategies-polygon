/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  ConverterStrategyBase__factory, IController__factory,
  IERC20__factory, IRebalancingV2Strategy, UniswapV3ConverterStrategy__factory,
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
import {
  ISwapper__factory
} from "../../../../typechain/factories/contracts/test/aave/Aave3PriceSourceBalancerBoosted.sol";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

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

  let signer: SignerWithAddress;
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
    [signer, signer2, signer3, signer4, signer5] = await ethers.getSigners();
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Utils
  async function movePrices(b: IBuilderResults, movePricesUp: boolean, swapAmountRatio: number) {
    const state = await PackedData.getDefaultState(b.strategy);
    const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
        signer,
        b,
        state.tokenA,
        state.tokenB,
        movePricesUp,
        swapAmountRatio
    );
    if (movePricesUp) {
      await UniversalUtils.movePoolPriceUp(signer, state, b.swapper, swapAmount);
    } else {
      await UniversalUtils.movePoolPriceDown(signer, state, b.swapper, swapAmount);
    }
  }
//endregion Utils

//region Unit tests
  describe("Multiple users make actions simultaneously, single strategy @skip-on-coverage", () => {
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
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);
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

  describe("Two univ3-strategies: loop with rebalance, hardwork, deposit and withdraw", () => {
    const CAPACITY_1 = "1500";
    const CAPACITY_2 = "6000";
    const USER_BALANCE_1 = "1000";
    const USER_BALANCE_2 = "6000";

    interface IPrepareResults extends IBuilderResults {
      strategy2: IRebalancingV2Strategy;
    }

    let snapshot: string;
    before(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshot);
    });

    async function prepareStrategy(): Promise<IPrepareResults> {
      const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc("univ3-1", signer, signer2);

      // deploy second strategy
      const strategy2 = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        b.gov,
      );

      await strategy2.init(
        b.core.controller,
        b.splitter.address,
        b.converter.address,
        MaticAddresses.UNISWAPV3_USDC_USDT_100,
        0,
        0,
        [0, 0, Misc.MAX_UINT, 0],
        [0, 0, Misc.MAX_UINT, 0],
      );

      await b.splitter.connect(b.gov).addStrategies([strategy2.address], [0]);

      // set strategy capacities
      await b.splitter.setStrategyCapacity(b.strategy.address, parseUnits(CAPACITY_1, 6));
      await b.splitter.setStrategyCapacity(strategy2.address, parseUnits(CAPACITY_2, 6));

      // prepare two users. Total amount to deposits is limited by 7000 usdc in summary
      await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
      await IERC20__factory.connect(b.asset, signer2).approve(b.vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
      await TokenUtils.getToken(b.asset, signer2.address, parseUnits('7000', 6));

      const investAmount = parseUnits("1000", 6);
      console.log('initial deposits...');
      await b.vault.connect(signer).deposit(investAmount, signer.address, {gasLimit: 19_000_000});
      await b.vault.connect(signer2).deposit(investAmount, signer2.address, {gasLimit: 19_000_000});

      return {...b, strategy2};
    }

    it('should not revert', async () => {
      const COUNT_CYCLES = 10;
      const b = await loadFixture(prepareStrategy);

      // Following amount is used as swapAmount for both tokens A and B...
      const swapAssetValueForPriceMove = parseUnits('500000', 6);
      // ... but WMATIC has different decimals than USDC, so we should use different swapAmount in that case
      const swapAssetValueForPriceMoveDown = strategyInfo.name === PLATFORM_UNIV3
      && strategyInfo.notUnderlyingToken === MaticAddresses.WMATIC_TOKEN
          ? parseUnits('300000', 18)
          : undefined;

      const state = await PackedData.getDefaultState(b.strategy);
      console.log("state", state);
      const price = await ISwapper__factory.connect(b.swapper, signer).getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6));

      const splitterSigner = await DeployerUtilsLocal.impersonate(await b.splitter.address);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

      const platformVoter = await DeployerUtilsLocal.impersonate(
          await IController__factory.connect(await b.vault.controller(), signer).platformVoter()
      );
      await converterStrategyBase.connect(platformVoter).setCompoundRatio(50000);

      let lastDirectionUp = false
      for (let i = 0; i < COUNT_CYCLES; i++) {
        console.log(`==================== CYCLE ${i} ====================`);
        await UniversalUtils.makePoolVolume(signer2, state, b.swapper, parseUnits('100000', 6));

        if (i % 3) {
          const movePricesUp = !lastDirectionUp;
          await PairBasedStrategyPrepareStateUtils.movePriceBySteps(
              signer,
              b,
              movePricesUp,
              state,
              strategyInfo.name === PLATFORM_KYBER
                  ? await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
                      signer,
                      b,
                      state.tokenA,
                      state.tokenB,
                      movePricesUp,
                      1.1
                  )
                  : swapAssetValueForPriceMove,
              swapAssetValueForPriceMoveDown,
              5
          );
          lastDirectionUp = !lastDirectionUp
        }

        if (await b.strategy.needRebalance()) {
          console.log('Rebalance..')
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
        }

        if (i % 5) {
          console.log('Hardwork..')
          await converterStrategyBase.connect(splitterSigner).doHardWork({gasLimit: 19_000_000});
        }

        if (i % 2) {
          console.log('Deposit..')
          await b.vault.connect(signer3).deposit(parseUnits('100.496467', 6), signer3.address, {gasLimit: 19_000_000});
        } else {
          console.log('Withdraw..');
          const toWithdraw = parseUnits('100.111437', 6)
          const balBefore = await TokenUtils.balanceOf(state.tokenA, signer3.address)
          await b.vault.connect(signer3).requestWithdraw()
          await b.vault.connect(signer3).withdraw(toWithdraw, signer3.address, signer3.address, {gasLimit: 19_000_000})
          const balAfter = await TokenUtils.balanceOf(state.tokenA, signer3.address)
          console.log(`To withdraw: ${toWithdraw.toString()}. Withdrawn: ${balAfter.sub(balBefore).toString()}`)
        }
      }

      await b.vault.connect(signer3).requestWithdraw();
      console.log('withdrawAll as signer3...');
      await b.vault.connect(signer3).withdrawAll({gasLimit: 19_000_000});

      await b.vault.connect(signer).requestWithdraw();
      console.log('withdrawAll...');
      await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
    });
  });
//endregion Unit tests
});