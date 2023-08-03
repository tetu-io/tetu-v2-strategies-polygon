/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  ConverterStrategyBase__factory,
  IERC20__factory,
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
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

/**
 * There are 6 possible actions and 2 flags: fuse F and need-rebalance NR
 * Possible responses: 0: revert, 1: ok, 1*: success-but-dont-enter-to-pool
 *             deposit, withdraw, rebalance, reduce debts, hardwork, emergency exit
 *  F0, NR0      1         1         0             1           1         1
 *  F1, NR0      1*        1         0             1*          0         1
 *  F0, NR1      0         0         1             1           0         1
 *  F1, NR1      0         0         0             1*          0         1
 *  Following tests check response in each case.
 */
describe('PairBasedStrategyActionResponseIntTest', function() {
  const ENTRY_TO_POOL_DISABLED = 0;
  const ENTRY_TO_POOL_IS_ALLOWED = 1;
  const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
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

//region Unit tests
  describe("Fuse off, need-rebalance off", () => {
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
       * Fuse OFF by default
       * Make small deposit.
       * Rebalance is not required after the depositing.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

        console.log('deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

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

          expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance + 300);
        });
        it("should revert on rebalance", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          const needRebalanceBefore = await b.strategy.needRebalance();
          expect(needRebalanceBefore).eq(false);

          await expect(
            b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000})
          ).revertedWith("U3S-1 Need rebalance"); // NEED_REBALANCE
        });
        it("should rebalance debts successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const planEntryData = defaultAbiCoder.encode(["uint256"], [PLAN_REPAY_SWAP_REPAY]);
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
        it("should harwork successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(
            b.strategy.address,
            await Misc.impersonate(b.splitter.address)
          );

          // put additional asset on balance of the strategy (to be able to run real hardwork)
          await TokenUtils.getToken(b.asset, b.strategy.address, parseUnits('2000', 6));

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await converterStrategyBase.doHardWork({gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.strategy.investedAssets).gt(stateBefore.strategy.investedAssets);
        });
        it("should make emergency exit successfully", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await converterStrategyBase.emergencyExit();
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.strategy.investedAssets).lt(10);
        });
      });
    });
  });
  describe("Fuse ON, need-rebalance off", () => {

  });
  describe("Fuse off, need-rebalance ON", () => {

  });
  describe("Fuse ON, need-rebalance ON", () => {

  });

//endregion Unit tests
});