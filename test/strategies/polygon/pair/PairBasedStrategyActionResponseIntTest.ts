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
import {defaultAbiCoder, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {HardhatUtils} from "../../../baseUT/utils/HardhatUtils";

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

describe('PairBasedStrategyActionResponseIntTest', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) return;

//region Constants
  const ENTRY_TO_POOL_DISABLED = 0;
  const ENTRY_TO_POOL_IS_ALLOWED = 1;
  const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;

  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;
//endregion Constants

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    [signer, signer2, signer3] = await ethers.getSigners();
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  /**
   * There are 6 possible actions and 2 flags: fuse F and need-rebalance NR
   * Possible responses: 0: revert, 1: ok, 1*: success-but-dont-enter-to-pool
   *             deposit, withdraw, rebalance, reduce debts, hardwork, emergency exit
   *  F0, NR0      1         1         0             1           1         1
   *  F1, NR0      1*        1         0             1*          0         1
   *  F0, NR1      0         0         1             1           0         1
   *  F1, NR1      not possible, see needStrategyRebalance impl
   *  Following tests check response in each case.
   */
  describe("Fuse, Need-rebalance combinations", () => {
    describe("Fuse off, need-rebalance off", () => {
      interface IStrategyInfo {
        name: string,
      }

      const strategies: IStrategyInfo[] = [
        {name: PLATFORM_UNIV3,},
        {name: PLATFORM_ALGEBRA,},
        {name: PLATFORM_KYBER,},
      ];

      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        /**
         * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
         * Fuse OFF by default, rebalance is not needed
         */
        async function prepareStrategy(): Promise<IBuilderResults> {
          const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

          console.log('deposit...');
          // make deposit and enter to the pool
          for (let i = 0; i < 5; ++i) {
            await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
            await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
            await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

            const state = await PackedData.getDefaultState(b.strategy);
            if (state.totalLiquidity.gt(0)) {
              break;
            }
          }

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

          it("totalLiquidity should be > 0", async () => {
            const b = await loadFixture(prepareStrategy);
            const state = await PackedData.getDefaultState(b.strategy);
            expect(state.totalLiquidity.gt(0)).eq(true);
          });
          it("should deposit successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
          });
          it("should withdraw successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 300);
          });
          it("should withdraw-all successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            console.log('stateBefore', stateBefore);
            console.log('stateAfter', stateAfter);

            expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
            expect(stateBefore.vault.userShares).gt(0);
            expect(stateAfter.vault.userShares).eq(0);
          });
          it("should revert on rebalance", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const needRebalanceBefore = await b.strategy.needRebalance();
            expect(needRebalanceBefore).eq(false);

            const platform = await converterStrategyBase.PLATFORM();
            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-9 No rebalance needed"
              : platform === PLATFORM_ALGEBRA
                ? "AS-9 No rebalance needed"
                : "KS-9 No rebalance needed";

            await expect(
              b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage); // NO_REBALANCE_NEEDED
          });
          it("should rebalance debts successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
            const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.strategy.withdrawByAggStep(
              quote.tokenToSwap,
              Misc.ZERO_ADDRESS,
              quote.amountToSwap,
              "0x",
              planEntryData,
              ENTRY_TO_POOL_IS_ALLOWED,
              {gasLimit: 19_000_000}
            );
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).approximately(stateBefore.strategy.investedAssets, 100);
          });
          it("should hardwork successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
            );

            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await converterStrategyBase.doHardWork({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).gte(stateBefore.strategy.investedAssets - 0.001);
          });
          it("should make emergency exit successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).lt(10);
          });
          it("isReadyToHardWork should return expected value", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
            );
            const platform = await converterStrategyBase.PLATFORM();

            // currently kyber's isReadyToHardWork returns true without need to call prepareToHardwork
            expect(await converterStrategyBase.isReadyToHardWork()).eq(platform === PLATFORM_KYBER);
          });
          it("isReadyToHardWork should return expected value after hardwork", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
                b.strategy.address,
                await Misc.impersonate(b.splitter.address)
            );
            const platform = await converterStrategyBase.PLATFORM();
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

            expect(await converterStrategyBase.isReadyToHardWork()).eq(true);
            await converterStrategyBase.doHardWork({gasLimit: 19_000_000});
            // currently kyber's isReadyToHardWork returns true without need to call prepareToHardwork
            expect(await converterStrategyBase.isReadyToHardWork()).eq(platform === PLATFORM_KYBER);
          });
        });
      });
    });
    describe("Fuse ON, need-rebalance off", () => {
      interface IStrategyInfo {
        name: string,
      }

      const strategies: IStrategyInfo[] = [
        {name: PLATFORM_UNIV3,},
        {name: PLATFORM_ALGEBRA,},
        {name: PLATFORM_KYBER,},
      ];

      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        /**
         * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
         * Fuse OFF by default. We set fuse thresholds in such a way as to trigger fuse ON.
         */
        async function prepareStrategy(): Promise<IBuilderResults> {
          const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

          console.log('deposit...');
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
          await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

          // activate fuse
          await PairBasedStrategyPrepareStateUtils.prepareFuse(b, true);

          // make rebalance to update fuse status
          expect(await b.strategy.needRebalance()).eq(true);
          console.log('rebalance...');
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
          expect(await b.strategy.needRebalance()).eq(false);

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

          it("should deposit on balance, don't deposit to pool", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
            expect(stateAfter.strategy.liquidity).eq(stateBefore.strategy.liquidity);
          });
          it("should withdraw successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 300);
          });
          it("should withdraw-all successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
            expect(stateBefore.vault.userShares).gt(0);
            expect(stateAfter.vault.userShares).eq(0);
          });
          it("should revert on rebalance", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            const needRebalanceBefore = await b.strategy.needRebalance();
            expect(needRebalanceBefore).eq(false);

            const platform = await converterStrategyBase.PLATFORM();
            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-9 No rebalance needed"
              : platform === PLATFORM_ALGEBRA
                ? "AS-9 No rebalance needed"
                : "KS-9 No rebalance needed";

            await expect(
              b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage); // NO_REBALANCE_NEEDED
          });
          it("should rebalance debts successfully but dont enter to the pool", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
            const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.strategy.withdrawByAggStep(
              quote.tokenToSwap,
              Misc.ZERO_ADDRESS,
              quote.amountToSwap,
              "0x",
              planEntryData,
              ENTRY_TO_POOL_IS_ALLOWED,
              {gasLimit: 19_000_000}
            );
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.liquidity).lt(10);
          });
          it("should revert on hardwork", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
            );

            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

            const platform = await converterStrategyBase.PLATFORM();
            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-14 Fuse is active"
              : platform === PLATFORM_ALGEBRA
                ? "AS-14 Fuse is active"
                : "KS-14 Fuse is active";

            await expect(
              converterStrategyBase.doHardWork({gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage);
          });
          it("should make emergency exit successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).lt(10);
          });
          it("isReadyToHardWork should return false even if hardwork is really necessary", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
            );

            expect(await converterStrategyBase.isReadyToHardWork()).eq(false);
            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

            expect(await converterStrategyBase.isReadyToHardWork()).eq(false); // fuse is active, so no changes in results
          });
        });
      });
    });
    describe("Fuse off, need-rebalance ON", () => {
      interface IStrategyInfo {
        name: string,
      }

      const strategies: IStrategyInfo[] = [
        {name: PLATFORM_UNIV3,},
        {name: PLATFORM_ALGEBRA,},
        {name: PLATFORM_KYBER,},
      ];

      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        /**
         * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
         * Fuse OFF by default. We change prices in such a way that rebalancing is required.
         * We make at first single rebalance to be sure that initial amount is deposited to the pool.
         */
        async function prepareStrategy(): Promise<IBuilderResults> {
          const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

          console.log('deposit...');
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
          await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

          await PairBasedStrategyPrepareStateUtils.prepareNeedRebalanceOn(signer, signer2, b);

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

          it("rebalance is required", async () => {
            const b = await loadFixture(prepareStrategy);
            expect(await b.strategy.needRebalance()).eq(true);
          });
          it("should revert on deposit", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
            const platform = await converterStrategyBase.PLATFORM();

            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-1 Need rebalance"
              : platform === PLATFORM_ALGEBRA
                ? "AS-1 Need rebalance"
                : "KS-1 Need rebalance";
            await expect(
              b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage);
          });
          it("should revert on withdraw", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
            const platform = await converterStrategyBase.PLATFORM();

            const needRebalanceBefore = await b.strategy.needRebalance();
            expect(needRebalanceBefore).eq(true);

            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-1 Need rebalance"
              : platform === PLATFORM_ALGEBRA
                ? "AS-1 Need rebalance"
                : "KS-1 Need rebalance";
            await expect(
              b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage);
          });
          it("should revert on withdraw-all", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
            const platform = await converterStrategyBase.PLATFORM();

            const needRebalanceBefore = await b.strategy.needRebalance();
            expect(needRebalanceBefore).eq(true);

            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-1 Need rebalance"
              : platform === PLATFORM_ALGEBRA
                ? "AS-1 Need rebalance"
                : "KS-1 Need rebalance";
            await expect(
              b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage);
          });
          it("should revert on rebalance", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const needRebalanceBefore = await b.strategy.needRebalance();
            expect(needRebalanceBefore).eq(true);

            await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
            expect(await b.strategy.needRebalance()).eq(false);
          });
          it("should rebalance debts successfully but dont enter to the pool", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]);
            const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);
            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            console.log("stateBefore", stateBefore);

            await b.strategy.withdrawByAggStep(
              quote.tokenToSwap,
              Misc.ZERO_ADDRESS,
              quote.amountToSwap,
              "0x",
              planEntryData,
              ENTRY_TO_POOL_DISABLED,
              {gasLimit: 19_000_000}
            );
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            console.log("stateAfter", stateAfter);

            expect(
                stateAfter.strategy.liquidity < stateBefore.strategy.liquidity
                || stateAfter.strategy.liquidity === 0
            ).eq(true);
          });
          it("should revert on hardwork", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
            );

            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

            const platform = await converterStrategyBase.PLATFORM();
            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-1 Need rebalance"
              : platform === PLATFORM_ALGEBRA
                ? "AS-1 Need rebalance"
                : "KS-1 Need rebalance";

            await expect(
              converterStrategyBase.doHardWork({gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage);
          });
          it("should make emergency exit successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).lt(10);
          });
          it("isReadyToHardWork should return false even if hardwork is really necessary", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
            );

            expect(await converterStrategyBase.isReadyToHardWork()).eq(false);
            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

            expect(await converterStrategyBase.isReadyToHardWork()).eq(false); // need rebalance is still true, so no changes in results
          });
        });
      });
    });
  });

  describe("Empty strategy", () => {
    describe("No deposits", () => {
      interface IStrategyInfo {
        name: string,
      }

      const strategies: IStrategyInfo[] = [
        {name: PLATFORM_UNIV3,},
        {name: PLATFORM_ALGEBRA,},
        {name: PLATFORM_KYBER,},
      ];

      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        async function prepareStrategy(): Promise<IBuilderResults> {
          return PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);
        }

        describe(`${strategyInfo.name}`, () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          it("isReadyToHardWork should return expected values", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
                b.strategy.address,
                await Misc.impersonate(b.splitter.address)
            );
            const platform = await converterStrategyBase.PLATFORM();

            // currently kyber's isReadyToHardWork returns true without need to call prepareToHardwork
            expect(await converterStrategyBase.isReadyToHardWork()).eq(platform === PLATFORM_KYBER);
          });
        });
      });
    });
    describe("Empty strategy with need-rebalance ON", () => {
      interface IStrategyInfo {
        name: string,
      }

      const strategies: IStrategyInfo[] = [
        {name: PLATFORM_UNIV3,},
        {name: PLATFORM_ALGEBRA,},
        {name: PLATFORM_KYBER,},
      ];

      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        /**
         * Make deposit.
         * Change thresholds and set fuse ON
         * Withdraw all
         * Change thresholds and set fuse OFF => need rebalance = true
         * Make rebalance of the empty strategy.
         */
        async function prepareStrategy(): Promise<IBuilderResults> {
          const states: IStateNum[] = [];
          const pathOut = "./tmp/prepareStrategy.csv";

          const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `init`));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          // make deposit
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
          await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});

          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `deposit`));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          // set fuse ON
          await PairBasedStrategyPrepareStateUtils.prepareFuse(b, true);
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fuse-on`));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `rebalance`));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          // withdraw all liquidity from the strategy
          await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `withdraw`));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fuse-off`));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

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

          it("should make rebalance successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(await b.strategy.needRebalance()).eq(true);
            await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
            expect(await b.strategy.needRebalance()).eq(false);
          });
          it("should not revert on rebalance debts", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
            const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
            await b.strategy.withdrawByAggStep(
                quote.tokenToSwap,
                Misc.ZERO_ADDRESS,
                quote.amountToSwap,
                "0x",
                planEntryData,
                ENTRY_TO_POOL_IS_ALLOWED,
                {gasLimit: 19_000_000}
            );
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).approximately(stateBefore.strategy.investedAssets, 100);
          });
          it("should make emergency exit successfully", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

            expect(stateAfter.strategy.investedAssets).lt(10);
          });
        });
      });
    });
  });
  describe("Large user has just exit the strategy @skip-on-coverage", () => {
    interface IStrategyInfo {
      name: string,
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3,},
      {name: PLATFORM_ALGEBRA,},
      {name: PLATFORM_KYBER,},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 100 USDC, also he has additional 100 USDC on the balance.
       * Another big user enters to the strategy. Prices are changed, rebalances are made.
       * Big user exits the strategy.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
        const states: IStateNum[] = [];
        const pathOut = "./tmp/large-user-prepare-strategy.csv";

        const state = await PackedData.getDefaultState(b.strategy);
        await UniversalUtils.makePoolVolume(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, parseUnits("50000", 6));

        console.log('Small user deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('200', 6));
        await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: 19_000_000});
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "d0"));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        console.log('Big user deposit...');
        await IERC20__factory.connect(b.asset, signer2).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer2.address, parseUnits('100000', 6));
        await b.vault.connect(signer2).deposit(parseUnits('50000', 6), signer2.address, {gasLimit: 19_000_000});
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "d1"));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        // change prices and make rebalance
        console.log('Change prices...');

        const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
          signer,
          b,
          state.tokenA,
          state.tokenB,
          true,
        );
        await UniversalUtils.movePoolPriceUp(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000);
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "p"));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        console.log('Rebalance debts...');
        // rebalance debts
        await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
          await b.strategy.connect(await UniversalTestUtils.getAnOperator(b.strategy.address, signer)),
          Misc.ZERO_ADDRESS,
          true
        );
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "unfold"));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        if (await b.strategy.needRebalance()) {
          console.log('Rebalance...');
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
        }

        console.log('Withdraw...');
        let done = false;
        while (! done) {
          const amountToWithdraw = await b.vault.maxWithdraw(signer2.address);
          const portion = parseUnits('5000', 6);
          if (portion.lt(amountToWithdraw)) {
            console.log("withdraw...", portion);
            await b.vault.connect(signer2).withdraw(portion, signer2.address, signer2.address, {gasLimit: 19_000_000});
          } else {
            console.log("withdraw all...", amountToWithdraw);
            await b.vault.connect(signer2).withdrawAll({gasLimit: 19_000_000});
            done = true;
          }
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "w"));
          await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          if (await b.strategy.needRebalance()) { // for kyber
            console.log("rebalance");
            await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
            states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "r"));
            await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
          }
        }

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

        it("rebalance should not be required", async () => {
          const b = await loadFixture(prepareStrategy);
          expect(await b.strategy.needRebalance()).eq(false);
        });
        it("small user should deposit successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
        });
        it("small user should withdraw successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await b.vault.connect(signer).withdraw(parseUnits('30', 6), signer.address, signer.address, {gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 30);
        });
        it("small user should withdraw-all successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);

          expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
          expect(stateBefore.strategy.assetBalance).gt(0);
          expect(stateAfter.strategy.assetBalance).lt(0.1);
        });
        it("should rebalance debts successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
          const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await b.strategy.withdrawByAggStep(
              quote.tokenToSwap,
              Misc.ZERO_ADDRESS,
              quote.amountToSwap,
              "0x",
              planEntryData,
              ENTRY_TO_POOL_IS_ALLOWED,
              {gasLimit: 19_000_000}
          );
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.strategy.investedAssets).approximately(stateBefore.strategy.investedAssets, 100);
        });
        it("should hardwork successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(
              b.strategy.address,
              await Misc.impersonate(b.splitter.address)
          );

          // put additional fee to profit holder bo make isReadyToHardwork returns true
          await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await converterStrategyBase.doHardWork({gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.strategy.investedAssets).gt(stateBefore.strategy.investedAssets);
        });
        it("should make emergency exit successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.strategy.investedAssets).lt(10);
        });
      });
    });
  });
//endregion Unit tests
});