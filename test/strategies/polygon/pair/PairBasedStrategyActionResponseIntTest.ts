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
import {StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {MaticAddresses} from '../../../../scripts/addresses/MaticAddresses';
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

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  let libUniv3: UniswapV3Lib;
  let libAlgebra: AlgebraLib;
  let libKyber: KyberLib;
//endregion Variables

//region before, after
  before(async function() {
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();

    libUniv3 = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib;
    libAlgebra = await DeployerUtils.deployContract(signer, 'AlgebraLib') as AlgebraLib;
    libKyber = await DeployerUtils.deployContract(signer, 'KyberLib') as KyberLib;
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
  function getLib(platform: string) : UniswapV3Lib | AlgebraLib | KyberLib {
    return platform === PLATFORM_ALGEBRA
      ? libAlgebra
      : platform === PLATFORM_KYBER
        ? libKyber
        : libUniv3;
  }
//endregion Utils

//region Unit tests
  describe("Fuse off, need-rebalance off", () => {
    interface IStrategyInfo {
      name: string,
    }
    const strategies: IStrategyInfo[] = [
      // { name: PLATFORM_UNIV3,},
      // { name: PLATFORM_ALGEBRA,},
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

          expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 300);
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
          expect(stateAfter.strategy.liquidity).gt(10);
        });
        it("should hardwork successfully", async () => {
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
          await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.strategy.investedAssets).lt(10);
        });
      });
    });
  });
  describe("Fuse ON, need-rebalance off", () => {
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

        console.log("activate fuse ON");
        const lib = getLib(await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM());
        const priceA = +formatUnits(await lib.getPrice(b.pool, MaticAddresses.USDC_TOKEN), 6);
        const priceB = +formatUnits(await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN), 6);
        console.log("priceA, priceB", priceA, priceB);

        const ttA = [priceA - 0.0008, priceA - 0.0006, priceA + 0.0008, priceA + 0.0006].map(x => parseUnits(x.toString(), 18));
        const ttB = [
          priceB - 0.0008,
          priceB - 0.0006,
          priceB - 0.0001, // (!) fuse ON
          priceB - 0.0002
        ].map(x => parseUnits(x.toString(), 18));

        await b.strategy.setFuseThresholds(0, [ttA[0], ttA[1], ttA[2], ttA[3]]);
        await b.strategy.setFuseThresholds(1, [ttB[0], ttB[1], ttB[2], ttB[3]]);

        // make rebalance to update fuse status
        expect(await b.strategy.needRebalance()).eq(true);
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

          expect(stateAfter.strategy.liquidity).lt(10);
        });
        it("should revert on hardwork", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(
            b.strategy.address,
            await Misc.impersonate(b.splitter.address)
          );

          // put additional asset on balance of the strategy (to be able to run real hardwork)
          await TokenUtils.getToken(b.asset, b.strategy.address, parseUnits('2000', 6));

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
      });
    });
  });
  describe("Fuse off, need-rebalance ON", () => {

  });
  describe("Fuse ON, need-rebalance ON", () => {

  });

//endregion Unit tests
});