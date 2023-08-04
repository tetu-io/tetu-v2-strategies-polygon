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
 *  F1, NR1      not possible, see needStrategyRebalance impl
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

  async function prepareNeedRebalanceOn(b: IBuilderResults) {
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const platform = await converterStrategyBase.PLATFORM();
    const state = await PackedData.getDefaultState(b.strategy);

    // move strategy to "need to rebalance" state
    const lib = getLib(platform);
    let countRebalances = 0;
    for (let i = 0; i < 10; ++i) {
      let swapAmount: BigNumber;
      const amounts = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
      const priceB = await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN);
      const swapAmount0 = amounts[1].mul(priceB).div(parseUnits('1', 6));
      swapAmount = swapAmount0.add(swapAmount0.div(100));
      await UniversalUtils.movePoolPriceUp(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000);
      if (await b.strategy.needRebalance()) {
        if (countRebalances === 0) {
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
          countRebalances++;
        } else {
          break;
        }
      }
    }
  }

  async function prepareFuse(b: IBuilderResults, triggerOn: boolean) {
    console.log("activate fuse ON");
    const lib = getLib(await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM());
    const priceA = +formatUnits(await lib.getPrice(b.pool, MaticAddresses.USDC_TOKEN), 6);
    const priceB = +formatUnits(await lib.getPrice(b.pool, MaticAddresses.USDT_TOKEN), 6);
    console.log("priceA, priceB", priceA, priceB);

    const ttA = [priceA - 0.0008, priceA - 0.0006, priceA + 0.0008, priceA + 0.0006].map(x => parseUnits(x.toString(), 18));
    const ttB = [
      priceB - 0.0008,
      priceB - 0.0006,
      priceB + (triggerOn ? -0.0001 : 0.0004), // (!) fuse ON/OFF
      priceB + (triggerOn ? -0.0002 : 0.0002),
    ].map(x => parseUnits(x.toString(), 18));

    await b.strategy.setFuseThresholds(0, [ttA[0], ttA[1], ttA[2], ttA[3]]);
    await b.strategy.setFuseThresholds(1, [ttB[0], ttB[1], ttB[2], ttB[3]]);
  }
//endregion Utils

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
       * Fuse OFF by default, rebalance is not needed
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
       * Fuse OFF by default. We set fuse thresholds in such a way as to trigger fuse ON.
       * Rebalance is not required after the depositing.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

        console.log('deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

        // activate fuse
        await prepareFuse(b, true);

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
       * Fuse OFF by default. We change prices in such a way that rebalancing is required.
       * We make at first single rebalance to be sure that initial amount is deposited to the pool.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);

        console.log('deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

        await prepareNeedRebalanceOn(b);

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

          expect(stateAfter.strategy.liquidity).lt(stateBefore.strategy.liquidity);
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
      });
    });
  });

  describe("Empty strategy with need-rebalance ON", () => {
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
       * Make deposit.
       * Change thresholds and set fuse ON
       * Withdraw all
       * Change thresholds and set fuse OFF => need rebalance = true
       * Make rebalance of the empty strategy.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const states: IStateNum[] = [];
        const pathOut = "./tmp/prepareStrategy.csv";

        console.log("prepareStrategy.1");
        const b = await PairStrategyFixtures.buildPairStrategyUsdtUsdc(strategyInfo.name, signer, signer2);
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `init`));
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        console.log("prepareStrategy.2");
        // make deposit
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});
        console.log("prepareStrategy.3");

        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `deposit`));
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        // set fuse ON
        await prepareFuse(b, true);
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fuse-on`));
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
        console.log("prepareStrategy.4");
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `rebalance`));
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        // withdraw all liquidity from the strategy
        await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `withdraw`));
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        console.log("prepareStrategy.5");
        await prepareFuse(b, false);
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
//endregion Unit tests
});