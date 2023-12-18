/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  ConverterStrategyBase__factory, IController__factory,
  IERC20__factory, IRebalancingV2Strategy, ISetupPairBasedStrategy__factory, UniswapV3ConverterStrategy__factory,
} from '../../../../typechain';
import {Misc} from "../../../../scripts/utils/Misc";
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults, KYBER_PID_DEFAULT_BLOCK} from "../../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/pair/PairStrategyFixtures";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {
  ISwapper__factory
} from "../../../../typechain/factories/contracts/test/aave/Aave3PriceSourceBalancerBoosted.sol";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {IGetStateParams, IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {CaptureEvents} from "../../../baseUT/strategies/CaptureEvents";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";

/**
 * Try to make several actions one by one
 */
describe('PairBasedStrategyMultipleActionsIntTest @skip-on-coverage', function() {

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
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2, signer3, signer4, signer5] = await ethers.getSigners();
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
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
      // { name: PLATFORM_KYBER,},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
       * Fuse OFF by default, rebalance is not needed
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          POLYGON_NETWORK_ID,
          strategyInfo.name,
          signer,
          signer2,
          {
            kyberPid: KYBER_PID_DEFAULT_BLOCK,
          }
        );
        await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);

        if (await b.strategy.needRebalance()) {
          console.log("==================== rebalance.0 =======================");
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
        }

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
                const user = users[i];
                const amount = parseUnits(amounts[j], 6);
                // i-th user deposits j-th amount
                await IERC20__factory.connect(b.asset, user).approve(b.vault.address, Misc.MAX_UINT);
                await TokenUtils.getToken(b.asset, user.address, amount);
                console.log("==================== deposit.1 =======================");
                await b.vault.connect(user).deposit(amount, user.address, {gasLimit: 19_000_000});
                deposits[i] += +formatUnits(amount, 6);

                console.log("==================== move prices.1 =======================");
                await movePrices(b, i % 2 === 0, (i + 1) / 10);

                if (await b.strategy.needRebalance()) {
                  console.log("==================== rebalance.1 =======================");
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
                }
              }

              // withdraw
              for (let j = i + 1; j < users.length; ++j) {
                const user = users[j];
                const amount = parseUnits(amounts[i], 6);
                // j-th user withdraws i-th amount
                const maxAmount = await b.vault.connect(user).maxWithdraw(user.address);
                console.log("==================== withdraw =======================");
                await b.vault.connect(user).withdraw(
                    maxAmount.lt(amount) ? maxAmount : amount,
                    user.address,
                    user.address,
                    {gasLimit: 19_000_000}
                );
                console.log("==================== move prices.2 =======================");
                await movePrices(b, i % 2 === 0, (i + 1) / 10);

                if (await b.strategy.needRebalance()) {
                  console.log("==================== rebalance.2 =======================");
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
                }
              }
            }

            // withdraw-all
            for (let i = 0; i < users.length; ++i) {
              const user = users[i];
              const maxAmount = await b.vault.connect(user).maxWithdraw(user.address);
              if (maxAmount.gt(0)) {
                console.log("==================== withdraw all =======================");
                await b.vault.connect(user).withdrawAll({gasLimit: 19_000_000});
              }

              await movePrices(b, i % 2 === 0, (i + 1) / 10);
              if (await b.strategy.needRebalance()) {
                console.log("==================== rebalance.3 =======================");
                await b.strategy.rebalanceNoSwaps(true);
              }

              balances[i] = +formatUnits(
                await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(user.address),
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

  describe("Two univ3-strategies: loop with rebalance, hardwork, deposit and withdraw @skip-on-coverage", () => {
    const CAPACITY_1 = "1500";
    const CAPACITY_2 = "6000";
    const USER_BALANCE_1 = "1000";
    const USER_BALANCE_2 = "6000";

    let snapshot: string;
    before(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IPrepareResults extends IBuilderResults {
      strategy2: IRebalancingV2Strategy;
    }

    /**
     * Initialize two instances of Univ3 strategy, add both to the splitter.
     * Prepare initial balances of both users.
     */
    async function prepareStrategy(): Promise<IPrepareResults> {
      const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(POLYGON_NETWORK_ID, PLATFORM_UNIV3, signer, signer2);

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
      );

      await b.splitter.connect(b.gov).scheduleStrategies([strategy2.address]);
      await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
      await b.splitter.connect(b.gov).addStrategies([strategy2.address], [0], [Misc.MAX_UINT]);

      await ConverterUtils.whitelist([strategy2.address]);
      const profitHolder2 = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy2.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.dQUICK_TOKEN, MaticAddresses.WMATIC_TOKEN,])
      await ISetupPairBasedStrategy__factory.connect(strategy2.address, b.operator).setStrategyProfitHolder(profitHolder2.address);

      // set strategy capacities
      await b.splitter.setStrategyCapacity(b.strategy.address, parseUnits(CAPACITY_1, 6));
      await b.splitter.setStrategyCapacity(strategy2.address, parseUnits(CAPACITY_2, 6));

      // prepare two users. Total amount to deposits is limited by 7000 usdc in summary
      await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
      await IERC20__factory.connect(b.asset, signer2).approve(b.vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(b.asset, signer.address, parseUnits(USER_BALANCE_1, 6));
      await TokenUtils.getToken(b.asset, signer2.address, parseUnits(USER_BALANCE_2, 6));

      console.log('initial deposits...');
      await b.vault.connect(signer).deposit(parseUnits(USER_BALANCE_1, 6).div(2), signer.address, {gasLimit: 19_000_000});
      await b.vault.connect(signer2).deposit(parseUnits(USER_BALANCE_2, 6).div(2), signer2.address, {gasLimit: 19_000_000});

      return {...b, strategy2};
    }

    it('should not revert', async () => {
      const COUNT_CYCLES = 15;
      const b = await loadFixture(prepareStrategy);
      const swapAssetValueForPriceMove = parseUnits('500000', 6);
      const strategies = [b.strategy, b.strategy2];
      const users = [signer, signer2];

      const pathOut1 = "./tmp/two-univ3-loop-strategy1.csv"
      const pathOut2 = "./tmp/two-univ3-loop-strategy2.csv"
      const states: IStateNum[] = [];
      const states2: IStateNum[] = [];

      const state = await PackedData.getDefaultState(b.strategy);
      console.log("state", state);

      const price = await ISwapper__factory.connect(b.swapper, signer).getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6));

      const splitterSigner = await DeployerUtilsLocal.impersonate(await b.splitter.address);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
      const converterStrategyBase2 = ConverterStrategyBase__factory.connect(b.strategy2.address, signer);

      const registerStates = async function (name: string, p?: IGetStateParams) {
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, name, p));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut1, states, b.stateParams, true);

        states2.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase2, b.vault, name, p));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut2, states2, b.stateParams, true);
      }

      const platformVoter = await DeployerUtilsLocal.impersonate(
          await IController__factory.connect(await b.vault.controller(), signer).platformVoter()
      );
      await converterStrategyBase.connect(platformVoter).setCompoundRatio(50000);
      await registerStates("init");

      let lastDirectionUp = false
      for (let i = 0; i < COUNT_CYCLES; i++) {
        console.log(`==================== CYCLE ${i} ====================`);
        await UniversalUtils.makePoolVolume(signer3, state, b.swapper, parseUnits('100000', 6));


        if (i % 3) {
          const movePricesUp = !lastDirectionUp;
          await PairBasedStrategyPrepareStateUtils.movePriceBySteps(signer3, b, movePricesUp, state, swapAssetValueForPriceMove);
          lastDirectionUp = !lastDirectionUp;
          await registerStates("p");
        }

        for (const strategy of strategies) {
          if (await strategy.needRebalance()) {
            console.log('Rebalance..');
            const eventsSet = await CaptureEvents.makeRebalanceNoSwap(strategy);
            await registerStates("r", {eventsSet});
          }
        }

        if (i % 5) {
          for (const strategy of strategies) {
            console.log('Hardwork..')
            const eventsSet = await CaptureEvents.makeHardwork(ConverterStrategyBase__factory.connect(strategy.address, signer).connect(splitterSigner));
            // await ConverterStrategyBase__factory.connect(strategy.address, signer).connect(splitterSigner).doHardWork({gasLimit: 19_000_000});
            await registerStates("h", {eventsSet});
          }
        }

        for (let iuser = 0; iuser < 2; ++iuser) {
          const amountOnBalance = await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(users[iuser].address);
          switch (i % 4 + iuser) {
            case 0:
            case 2: {
              console.log(`User ${iuser} deposits..`, +formatUnits(amountOnBalance, 6));
              const amountToDeposit = i % 2 === (iuser === 0 ? 0 : 2)
                ? amountOnBalance.div(2)
                : amountOnBalance.mul(5).div(6);
              const eventsSet = await CaptureEvents.makeDeposit(b.vault.connect(users[iuser]), amountToDeposit, PLATFORM_UNIV3);
              // await b.vault.connect(users[iuser]).deposit(amountToDeposit, users[iuser].address, {gasLimit: 19_000_000});
              await registerStates(`d${iuser}`, {eventsSet});
              break;
            }
            case 3:
            case 4: {
              console.log(`User ${iuser} withdraws..`);
              const amountToWithdraw = i % 2 === (iuser === 0 ? 0 : 2)
                ? amountOnBalance.div(3)
                : amountOnBalance.mul(2).div(3);
              const balBefore = await TokenUtils.balanceOf(state.tokenA, users[iuser].address);
              await b.vault.connect(users[iuser]).requestWithdraw();
              // await b.vault.connect(users[iuser]).withdraw(amountToWithdraw, users[iuser].address, users[iuser].address, {gasLimit: 19_000_000})
              const eventsSet = await CaptureEvents.makeWithdraw(b.vault.connect(users[iuser]), amountToWithdraw, PLATFORM_UNIV3);
              const balAfter = await TokenUtils.balanceOf(state.tokenA, users[iuser].address)
              console.log(`To withdraw: ${amountToWithdraw.toString()}. Withdrawn: ${balAfter.sub(balBefore).toString()}`)
              await registerStates(`w${iuser}`, {eventsSet});
            }
          }
        }
      }

      for (let iuser = 0; iuser < 2; ++iuser) {
        await b.vault.connect(users[iuser]).requestWithdraw();
        console.log(`withdrawAll as ${iuser}...`);
        const eventsSet = await CaptureEvents.makeWithdrawAll(b.vault.connect(users[iuser]), PLATFORM_UNIV3);
        // await b.vault.connect(users[iuser]).withdrawAll({gasLimit: 19_000_000});

        await registerStates(`wa${iuser}`, {eventsSet});
      }
    });
  });
//endregion Unit tests
});
