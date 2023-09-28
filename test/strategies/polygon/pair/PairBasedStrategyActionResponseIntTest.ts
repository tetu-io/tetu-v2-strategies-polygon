/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {BorrowManager, BorrowManager__factory, ConverterController__factory, ConverterStrategyBase__factory, IController__factory, IDebtMonitor, IDebtMonitor__factory, IERC20__factory, IKeeperCallback__factory, IPlatformAdapter__factory, IPoolAdapter__factory,} from '../../../../typechain';
import {Misc} from "../../../../scripts/utils/Misc";
import {defaultAbiCoder, formatUnits, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults, KYBER_PID_DEFAULT_BLOCK} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {
  IPrepareOverCollateralParams,
  PairBasedStrategyPrepareStateUtils
} from "../../../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {GAS_LIMIT_PAIR_BASED_WITHDRAW, GAS_REBALANCE_NO_SWAP} from "../../../baseUT/GasLimits";
import {ENTRY_TO_POOL_DISABLED, ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY, PLAN_SWAP_REPAY} from "../../../baseUT/AppConstants";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {
  ISwapper__factory
} from "../../../../typechain/factories/contracts/test/aave/Aave3PriceSourceBalancerBoosted.sol";
import {controlGasLimitsEx} from "../../../../scripts/utils/GasLimitUtils";
import {BigNumber} from "ethers";
import {CaptureEvents} from "../../../baseUT/strategies/CaptureEvents";
import {MockAggregatorUtils} from "../../../baseUT/mocks/MockAggregatorUtils";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {MockHelper} from "../../../baseUT/helpers/MockHelper";

describe('PairBasedStrategyActionResponseIntTest', function() {

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
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

//region Utils
  function tokenName(token: string): string {
    switch (token) {
      case MaticAddresses.USDC_TOKEN: return "USDC";
      case MaticAddresses.USDT_TOKEN: return "USDT";
      case MaticAddresses.WETH_TOKEN: return "WETH";
      case MaticAddresses.WMATIC_TOKEN: return "WMATIC";
      default: return token;
    }
  }

  interface ICheckHealthResult {
    poolAdapter: string;
    amountBorrowAsset: BigNumber;
    amountCollateralAsset: BigNumber;
  }

  interface IRequireRepayParams {
    /** Addon to min and target health factors, i.e. 50 (2 decimals) */
    addon?: number;
    /** We need to fix health of pool adapters belong to the given ACTIVE platform adapter only */
    platformKindOnly?: number;
  }

  interface IRequireRepayResults {
    checkBefore: ICheckHealthResult[];
    checkAfter: ICheckHealthResult[];
  }

  async function getCheckHealthResultsForStrategy(
      strategy: string,
      debtMonitor: IDebtMonitor,
      borrowManager: BorrowManager,
      platformKindOnly?: number
  ): Promise<ICheckHealthResult[]> {
    const check0 = await debtMonitor.checkHealth(
        0,
        100,
        100
    );
    const dest: ICheckHealthResult[] = [];
    for (let i = 0; i < check0.outPoolAdapters.length; ++i) {
      const config = await IPoolAdapter__factory.connect(check0.outPoolAdapters[i], signer).getConfig();
      if (config.user.toLowerCase() === strategy.toLowerCase()) {
        if (platformKindOnly) {
          const platformAdapter = IPlatformAdapter__factory.connect(
              await borrowManager.converterToPlatformAdapter(config.originConverter),
              signer
          );
          if (await platformAdapter.platformKind() !== platformKindOnly || await platformAdapter.frozen()) {
            console.log(`Skip ${check0.outPoolAdapters[i]}`);
            continue;
          }
        }

        dest.push({
          poolAdapter: check0.outPoolAdapters[i],
          amountBorrowAsset: check0.outAmountBorrowAsset[i],
          amountCollateralAsset: check0.outAmountCollateralAsset[i]
        })
      }
    }
    return dest;
  }

  /** Test the call of requireRepay and the subsequent call of requirePayAmountBack() */
  async function callRequireRepay(b: IBuilderResults, p?: IRequireRepayParams): Promise<IRequireRepayResults> {
    const defaultState = await PackedData.getDefaultState(b.strategy);

    // increase health factors to break "health"
    const addon = p?.addon ?? 50;
    const converterController = ConverterController__factory.connect(await b.converter.controller(), signer);
    const converterGovernance = await Misc.impersonate(await converterController.governance());
    const minHealthFactor = await converterController.minHealthFactor2();
    const targetHealthFactor = await converterController.targetHealthFactor2();
    await converterController.connect(converterGovernance).setTargetHealthFactor2(targetHealthFactor + addon);
    await converterController.connect(converterGovernance).setMinHealthFactor2(minHealthFactor + addon);
    const debtMonitor = IDebtMonitor__factory.connect(await converterController.debtMonitor(), signer);

    // we need to clean custom target factors for the assets in use
    const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);
    await borrowManager.setTargetHealthFactors(
      [defaultState.tokenA, defaultState.tokenB],
      [targetHealthFactor + addon, targetHealthFactor + addon]
    );

    // calculate amounts required to restore health
    const checkBefore = await getCheckHealthResultsForStrategy(b.strategy.address, debtMonitor, borrowManager, p?.platformKindOnly);

    // call requireRepay on converter, requirePayAmountBack is called inside
    const keeperCallback = IKeeperCallback__factory.connect(
      b.converter.address,
      await Misc.impersonate(await converterController.keeper())
    );
    for (const check of checkBefore) {
      await keeperCallback.requireRepay(check.amountBorrowAsset, check.amountCollateralAsset, check.poolAdapter);
    }

    // ensure that health is restored
    const checkAfter = await getCheckHealthResultsForStrategy(b.strategy.address, debtMonitor, borrowManager, p?.platformKindOnly);
    return {checkBefore, checkAfter}
  }
//endregion Utils

//region Unit tests
  describe("Fuse off, need-rebalance off", () => {
    interface IStrategyInfo {
      name: string,
      notUnderlyingToken: string;
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN},
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
       * Fuse OFF by default, rebalance is not needed
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
        {
              kyberPid: KYBER_PID_DEFAULT_BLOCK,
              notUnderlying: strategyInfo.notUnderlyingToken
            }
        );

        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

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

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}`, () => {
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
          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);

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
        /** scb-776: isReadyToHardWork can return true just after hardwork call */
        it.skip("isReadyToHardWork should return expected value after hardwork", async () => {
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

        it("withdraw should not exceed gas limits @skip-on-coverage", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const tx = await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 19_000_000});
          const cr = await tx.wait();
          controlGasLimitsEx(cr.gasUsed, GAS_LIMIT_PAIR_BASED_WITHDRAW, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });
  });
  describe("Fuse ON, need-rebalance off", () => {
    interface IStrategyInfo {
      name: string,
      notUnderlyingToken: string;
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN},

      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN},
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
       * Fuse OFF by default. We set fuse thresholds in such a way as to trigger fuse ON.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {
              kyberPid: KYBER_PID_DEFAULT_BLOCK,
              notUnderlying: strategyInfo.notUnderlyingToken
            }
        );
        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

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

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}`, () => {
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
      notUnderlyingToken: string;
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN},

      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN},
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
       * Fuse OFF by default. We change prices in such a way that rebalancing is required.
       * We make at first single rebalance to be sure that initial amount is deposited to the pool.
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {
              kyberPid: KYBER_PID_DEFAULT_BLOCK,
              notUnderlying: strategyInfo.notUnderlyingToken
            }
        );
        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);


        console.log('deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

        await PairBasedStrategyPrepareStateUtils.prepareNeedRebalanceOn(signer, signer2, b);

        return b;
      }

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}`, () => {
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

  describe("State: empty strategy", () => {
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
          return PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {
              kyberPid: KYBER_PID_DEFAULT_BLOCK,
            }
          );
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

          const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {
              kyberPid: KYBER_PID_DEFAULT_BLOCK,
            }
          );
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
  describe("State: large user has just exit the strategy @skip-on-coverage", () => {
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
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
        const states: IStateNum[] = [];
        const pathOut = "./tmp/large-user-prepare-strategy.csv";

        const state = await PackedData.getDefaultState(b.strategy);
        await UniversalUtils.makePoolVolume(signer2, state, b.swapper, parseUnits("50000", 6));

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
        await UniversalUtils.movePoolPriceUp(signer2, state, b.swapper, swapAmount, 40000);
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "p"));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        console.log('Rebalance debts...');
        // rebalance debts
        await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
          await b.strategy.connect(await UniversalTestUtils.getAnOperator(b.strategy.address, signer)),
          Misc.ZERO_ADDRESS,
            () => true
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

  describe("State: twisted debts", () => {
    interface IStrategyInfo {
      name: string,
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3,},
      {name: PLATFORM_ALGEBRA,},
      {name: PLATFORM_KYBER,},
    ];

    describe("Prices up", () => {
      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        async function prepareStrategy(): Promise<IBuilderResults> {
          const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {kyberPid: KYBER_PID_DEFAULT_BLOCK}
          );
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
          const states: IStateNum[] = [];
          const pathOut = `./tmp/${strategyInfo.name}-folded-debts-up-user-prepare-strategy.csv`;

          await InjectUtils.injectTetuConverter(signer);
          await ConverterUtils.disableAaveV2(signer);
          await ConverterUtils.disableDForce(signer);
          await InjectUtils.redeployAave3PoolAdapters(signer);

          console.log('Deposit...');
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
          await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: 19_000_000});
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "d0"));
          await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          const p: IPrepareOverCollateralParams = {
            countRebalances: 2,
            movePricesUp: true,
            swapAmountRatio: 1.1,
            amountToDepositBySigner2: "100",
            amountToDepositBySigner: "10000"
          }
          await PairBasedStrategyPrepareStateUtils.prepareTwistedDebts(b, p, pathOut, signer, signer2);
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

            // 2163.780528 = 2163.7805280000002
            expect(stateAfter.user.assetBalance).approximately(stateBefore.user.assetBalance + 300, 1);
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
          it("should withdraw-all successfully when strategy balance is high", async () => {
            const b = await loadFixture(prepareStrategy);
            const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

            // add high enough amount on strategy balance, keep this amount on balance (don't enter to the pool)
            await converterStrategyBase.connect(await UniversalTestUtils.getAnOperator(b.strategy.address, signer)).setReinvestThresholdPercent(100_000);
            await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});

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
            console.log("stateBefore", stateBefore);
            console.log("stateAfter", stateAfter);

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

          describe("withdraw various amounts", () => {
            let snapshot2: string;
            before(async function () {
              snapshot2 = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot2);
            });

            const withdrawAmountPercents = [1, 3, 7, 23, 41, 67, 77, 83, 91, 99];
            withdrawAmountPercents.forEach(function (percentToWithdraw: number) {
              it(`should withdraw ${percentToWithdraw}% successfully`, async () => {
                const b = await loadFixture(prepareStrategy);
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                const vault = b.vault.connect(signer);
                const maxAmountToWithdraw = await vault.maxWithdraw(signer.address);
                const amountToWithdraw = maxAmountToWithdraw.mul(percentToWithdraw).div(100);
                await vault.withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                expect(stateAfter.user.assetBalance).approximately(
                  stateBefore.user.assetBalance + +formatUnits(amountToWithdraw, b.assetDecimals),
                  1
                );
              });
            });
          })

          describe("deposit various amounts", () => {
            let snapshot2: string;
            before(async function () {
              snapshot2 = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot2);
            });

            const amountsToDeposit = ["100", "8000", "11000", "15000"]; // < total assets, ~ total assets, > total assets
            amountsToDeposit.forEach(function (amountToDeposit: string) {

              it(`should deposit ${amountToDeposit} successfully`, async () => {
                const b = await loadFixture(prepareStrategy);
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await TokenUtils.getToken(b.asset, signer.address, parseUnits(amountToDeposit, 6));
                await b.vault.connect(signer).deposit(parseUnits(amountToDeposit, 6), signer.address, {gasLimit: 19_000_000});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                console.log("stateBefore", stateBefore);
                console.log("stateAfter", stateAfter);

                expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets, "totalAssets should increase");

                const directDebtExist = stateAfter.converterDirect.amountsToRepay.findIndex(x => x !== 0) !== -1;
                const reverseDebtExist = stateAfter.converterReverse.amountsToRepay.findIndex(x => x !== 0) !== -1;
                expect(!(directDebtExist && reverseDebtExist)).eq(true, "scb-807: direct and revers borrows are not allowed at the same time");
              });
            });
          })

          if (strategyInfo.name === PLATFORM_UNIV3) {
            // requirePayAmountBack implementation is shared for all strategies, we can check it on single strategy only
            it("should requirePayAmountBack successfully", async () => {

              const b = await loadFixture(prepareStrategy);

              const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

              // requirePayAmountBack is called by converter inside requireRepay
              const {checkBefore, checkAfter} = await callRequireRepay(b);
              expect(checkBefore.length).gt(0, "health wasn't broken");
              expect(checkAfter.length).lt(checkBefore.length, "health wasn't restored");

              // withdraw all and receive expected amount back
              await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

              console.log('stateBefore', stateBefore);
              console.log('stateAfter', stateAfter);

              expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
              expect(stateBefore.vault.userShares).gt(0);
              expect(stateAfter.vault.userShares).eq(0);
            });
          }
        });
      });
    });
    describe("Prices down", () => {
      strategies.forEach(function (strategyInfo: IStrategyInfo) {

        async function prepareStrategy(): Promise<IBuilderResults> {
          const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {kyberPid: KYBER_PID_DEFAULT_BLOCK}
          );
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
          const platform = await converterStrategyBase.PLATFORM();
          const states: IStateNum[] = [];
          const pathOut = `./tmp/${strategyInfo.name}-folded-debts-down-user-prepare-strategy.csv`;

          await InjectUtils.injectTetuConverter(signer);
          await ConverterUtils.disableAaveV2(signer);
          await ConverterUtils.disableDForce(signer);
          await InjectUtils.redeployAave3PoolAdapters(signer);

          const state = await PackedData.getDefaultState(b.strategy);
          await UniversalUtils.makePoolVolume(signer2, state, b.swapper, parseUnits("50000", 6));

          console.log('Deposit...');
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
          await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: 19_000_000});
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "d0"));
          await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          const p: IPrepareOverCollateralParams = {
            countRebalances: 2,
            movePricesUp: false,
            swapAmountRatio: platform === PLATFORM_UNIV3 ? 1.1 : 0.3,
            amountToDepositBySigner2: "100",
            amountToDepositBySigner: "10000"
          }
          await PairBasedStrategyPrepareStateUtils.prepareTwistedDebts(b, p, pathOut, signer, signer2);

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
            await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 99_000_000});
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
            console.log("stateBefore", stateBefore);
            console.log("stateAfter", stateAfter);

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

          describe("withdraw various amounts", () => {
            let snapshot2: string;
            before(async function () {
              snapshot2 = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot2);
            });

            const withdrawAmountPercents = [1, 3, 7, 23, 41, 67, 77, 83, 91, 99];
            withdrawAmountPercents.forEach(function (percentToWithdraw: number) {
              it(`should withdraw ${percentToWithdraw}% successfully`, async () => {
                const b = await loadFixture(prepareStrategy);
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                const vault = b.vault.connect(signer);
                const maxAmountToWithdraw = await vault.maxWithdraw(signer.address);
                const amountToWithdraw = maxAmountToWithdraw.mul(percentToWithdraw).div(100);
                await vault.withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                expect(stateAfter.user.assetBalance).approximately(
                  stateBefore.user.assetBalance + +formatUnits(amountToWithdraw, b.assetDecimals),
                  1
                );
              });
            });
          })

          describe("deposit various amounts", () => {
            let snapshot2: string;
            before(async function () {
              snapshot2 = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot2);
            });

            // borrow-direction is changed on largest amount
            const amountsToDeposit = ["100", "8000", "11000", "40000"]; // < total assets, ~ total assets, > total assets
            amountsToDeposit.forEach(function (amountToDeposit: string) {

              it(`should deposit ${amountToDeposit} successfully`, async () => {
                const b = await loadFixture(prepareStrategy);
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await TokenUtils.getToken(b.asset, signer.address, parseUnits(amountToDeposit, 6));
                await b.vault.connect(signer).deposit(parseUnits(amountToDeposit, 6), signer.address, {gasLimit: 19_000_000});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                StateUtilsNum.saveListStatesToCSVColumns(`./tmp/${strategyInfo.name}-deposit-${amountToDeposit}.csv`, [stateBefore, stateAfter], b.stateParams, true);

                expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets, "totalAssets should increase");

                const directDebtExist = stateAfter.converterDirect.amountsToRepay.findIndex(x => x !== 0) !== -1;
                const reverseDebtExist = stateAfter.converterReverse.amountsToRepay.findIndex(x => x !== 0) !== -1;
                expect(!(directDebtExist && reverseDebtExist)).eq(true, "scb-807: direct and revers borrows are not allowed at the same time");

              });
            });
          })

          if (strategyInfo.name === PLATFORM_UNIV3) {
            // requirePayAmountBack implementation is shared for all strategies, we can check it on single strategy only
            it("should requirePayAmountBack successfully", async () => {

              const b = await loadFixture(prepareStrategy);

              const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

              // requirePayAmountBack is called by converter inside requireRepay
              const {checkBefore, checkAfter} = await callRequireRepay(b);
              expect(checkBefore.length).gt(0, "health wasn't broken");
              expect(checkAfter.length).lt(checkBefore.length, "health wasn't restored");

              // withdraw all and receive expected amount back
              await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

              console.log('stateBefore', stateBefore);
              console.log('stateAfter', stateAfter);

              expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
              expect(stateBefore.vault.userShares).gt(0);
              expect(stateAfter.vault.userShares).eq(0);
            });
          }
        });
      });
    });
  });

  describe.skip("State: emergency exit made (no pool, no debts)", () => {
    interface IStrategyInfo {
      name: string,
      notUnderlyingToken: string;
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      // {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      // {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN},
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {
            kyberPid: KYBER_PID_DEFAULT_BLOCK,
            notUnderlying: strategyInfo.notUnderlyingToken
          }
        );

        console.log('deposit...');

        // make deposit and enter to the pool
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('5000', 6));
        await b.vault.connect(signer).deposit(parseUnits('3000', 6), signer.address);

        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, b.operator);
        await converterStrategyBase.emergencyExit();

        return b;
      }

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}`, () => {
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
      });
    });
  });

  /**
   * Kyber is not supported here for two reasons:
   * 1) isReadyToHardWork always returns true for simplicity
   * 2) prepareNeedRebalanceOnBigSwap doesn't work with Kyber
   */
  describe.skip("SCB-776: Rebalance and hardwork (Univ3 and algebra only)", () => {
    interface IStrategyInfo {
      name: string,
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3,},
      {name: PLATFORM_ALGEBRA,},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {
            kyberPid: KYBER_PID_DEFAULT_BLOCK,
          }
        );
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

        console.log('initial deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('100000', b.assetDecimals));
        await b.vault.connect(signer).deposit(parseUnits('10000', b.assetDecimals), signer.address);
        expect(await converterStrategyBase.isReadyToHardWork()).eq(false);
        expect(await b.strategy.needRebalance()).eq(false);

        // set up needRebalance
        // we use prepareNeedRebalanceOnBigSwap instead of prepareNeedRebalanceOn to reproduce SCB-776
        await PairBasedStrategyPrepareStateUtils.prepareNeedRebalanceOnBigSwap(signer, signer2, b);

        expect(await b.strategy.needRebalance()).eq(true);
        return b;
      }

      describe(`${strategyInfo.name}`, () => {
        let snapshot: string;
        let snapshotEach: string;
        let init: IBuilderResults;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
          init = await prepareStrategy();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });
        beforeEach(async function () {
          snapshotEach = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshotEach);
        });

        /** scb-776: isReadyToHardWork can return true just after hardwork call */
        it.skip('doHardWork should set isReadyToHardWork OFF', async () => {
          const converterStrategyBase = ConverterStrategyBase__factory.connect(init.strategy.address, signer);

          // make rebalancing
          await init.strategy.rebalanceNoSwaps(true, {gasLimit: 10_000_000});
          expect(await init.strategy.needRebalance()).eq(false);

          // make hardwork
          await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, init.strategy);
          expect(await converterStrategyBase.isReadyToHardWork()).eq(true);
          await converterStrategyBase.connect(await DeployerUtilsLocal.impersonate(await init.splitter.address)).doHardWork();
          expect(await converterStrategyBase.isReadyToHardWork()).eq(false);
        });

        it('Rebalance doesn\'t exceed gas limit @skip-on-coverage', async () => {
          const rebalanceGasUsed = await init.strategy.estimateGas.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
          console.log('>>> REBALANCE GAS USED', rebalanceGasUsed.toNumber());
          expect(rebalanceGasUsed.toNumber()).lessThan(GAS_REBALANCE_NO_SWAP);
        });
      });
    });
  });

  describe("Loop with rebalance, hardwork, deposit and withdraw with various compound rates", () => {
    interface IStrategyInfo {
      name: string,
      notUnderlyingToken: string;
      compoundRatio: number;
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 0},
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 10_000},
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 100_000},

      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 0},
      // {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 0}, // todo movePriceBySteps cannot change prices

      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 50_000},
      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 50_000},
      // {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 50_000}, // todo movePriceBySteps cannot change prices

      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN, compoundRatio: 50_000}, // todo npm coverage produces SB too high
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN, compoundRatio: 50_000}, // todo movePriceBySteps cannot change prices
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
            strategyInfo.name,
            signer,
            signer2,
            {
              kyberPid: KYBER_PID_DEFAULT_BLOCK,
              notUnderlying: strategyInfo.notUnderlyingToken
            }
        );

        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await IERC20__factory.connect(b.asset, signer3).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await TokenUtils.getToken(b.asset, signer3.address, parseUnits('2000', 6));

        const investAmount = parseUnits("1000", 6);
        console.log('initial deposits...');
        await b.vault.connect(signer).deposit(investAmount, signer.address, {gasLimit: 19_000_000});
        await b.vault.connect(signer3).deposit(investAmount, signer3.address, {gasLimit: 19_000_000});

        return b;
      }

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}-${strategyInfo.compoundRatio}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it('should change share price in expected way (compoundRate 0 => no changes, > 0 => increase)', async () => {
          const COUNT_CYCLES = 10;
          const maxLockedPercent = 15;
          const b = await loadFixture(prepareStrategy);
          const states: IStateNum[] = [];
          const pathOut = `./tmp/${strategyInfo.name}-${tokenName(strategyInfo.notUnderlyingToken)}-${strategyInfo.compoundRatio}-test-loop.csv`;

          const reader = await MockHelper.createPairBasedStrategyReader(signer);

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
          const platform = await converterStrategyBase.PLATFORM();

          const stateBefore = await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `before`);
          states.push(stateBefore);

          const platformVoter = await DeployerUtilsLocal.impersonate(
            await IController__factory.connect(await b.vault.controller(), signer).platformVoter()
          );
          await converterStrategyBase.connect(platformVoter).setCompoundRatio(strategyInfo.compoundRatio);

          let lastDirectionUp = false
          for (let i = 0; i < COUNT_CYCLES; i++) {
            console.log(`==================== CYCLE ${i} ====================`);
            // provide some rewards
            await UniversalUtils.makePoolVolume(signer2, state, b.swapper, parseUnits('100000', 6));
            await TimeUtils.advanceNBlocks(1000);

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
              states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `p${i}`));
              StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
            }

            if (await b.strategy.needRebalance()) {
              console.log('Rebalance..')
              const eventsSet = await CaptureEvents.makeRebalanceNoSwap(b.strategy);
              states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r${i}`, {eventsSet}));
              StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
            }

            if (i % 4) {
              await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
                await b.strategy.connect(await UniversalTestUtils.getAnOperator(b.strategy.address, signer)),
                MaticAddresses.TETU_LIQUIDATOR,
                () => true,
                async (stateTitle, eventsSet) => {
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, stateTitle, {eventsSet}));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                }
              );
            }

            if (i % 5) {
              console.log('Hardwork..')
              const eventsSet = await CaptureEvents.makeHardwork(converterStrategyBase.connect(splitterSigner));
              states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `h${i}`, {eventsSet}));
              StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
            }

            if (i % 2) {
              console.log('Deposit..')
              const eventsSet = await CaptureEvents.makeDeposit(b.vault.connect(signer3), parseUnits('100.496467', 6), platform);
              states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `d${i}`, {eventsSet}));
              StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
            } else {
              console.log('Withdraw..');
              const toWithdraw = parseUnits('100.111437', 6)
              const balBefore = await TokenUtils.balanceOf(state.tokenA, signer3.address)
              await b.vault.connect(signer3).requestWithdraw()

              const eventsSet = await CaptureEvents.makeWithdraw(b.vault.connect(signer3), toWithdraw, platform);
              const balAfter = await TokenUtils.balanceOf(state.tokenA, signer3.address)
              console.log(`To withdraw: ${toWithdraw.toString()}. Withdrawn: ${balAfter.sub(balBefore).toString()}`)
              states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `w${i}`, {eventsSet}));
              StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
            }

            const readerResults = await reader.getLockedUnderlyingAmount(b.strategy.address);
            const locketAmount = +formatUnits(readerResults.estimatedUnderlyingAmount, b.assetDecimals);
            const totalAsset = +formatUnits(readerResults.totalAssets, b.assetDecimals);
            const lockedPercent = 100 * locketAmount / totalAsset;
            console.log(`locketAmount=${locketAmount} totalAsset=${totalAsset} lockedPercent=${lockedPercent}`);
            if (lockedPercent > maxLockedPercent) {
              console.log("Rebalance debts");
              const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]);
              const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);
              await b.strategy.withdrawByAggStep(
                quote.tokenToSwap,
                Misc.ZERO_ADDRESS,
                quote.amountToSwap,
                "0x",
                planEntryData,
                ENTRY_TO_POOL_IS_ALLOWED,
                {gasLimit: 19_000_000}
              );
            }
          }

          const stateAfter = await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `final`);
          states.push(stateAfter);
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          const uncoveredLoss = StateUtilsNum.getTotalUncoveredLoss(states);
          const finalSharePrice = (stateAfter.vault.totalAssets + uncoveredLoss) / stateAfter.vault.totalSupply;
          console.log("finalSharePrice", finalSharePrice);
          console.log("stateAfter.vault.totalAssets", stateAfter.vault.totalAssets);
          if (strategyInfo.notUnderlyingToken === MaticAddresses.WMATIC_TOKEN) {
            // it seems like there are no rewards in the pool usdc-wmatic, so share price can decrease a bit
            // todo fix rewards and check share price
          } else {
            if (strategyInfo.compoundRatio) {
              expect(finalSharePrice).gt(stateBefore.vault.sharePrice, "compoundRatio is not zero - rewards should increase the share price");
            } else {
              expect(finalSharePrice).approximately(stateBefore.vault.sharePrice, 1e-6, "compoundRatio is zero - the share price shouldn't change");
            }
          }

          console.log('withdrawAll as signer3...');
          await b.vault.connect(signer3).requestWithdraw();
          const eventsSet3 = await CaptureEvents.makeWithdrawAll(b.vault.connect(signer3), platform);
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `w-all-s3`, {eventsSet: eventsSet3}));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          console.log('withdrawAll as signer...');
          await b.vault.connect(signer).requestWithdraw();
          const eventsSet1 = await CaptureEvents.makeWithdrawAll(b.vault.connect(signer), platform);
          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `w-all-s1`, {eventsSet: eventsSet1}));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          // shouldn't revert up to the end
        });
      });
    });
  });

  describe("SCB-791: withdraw almost-all shouldn't change share prices", () => {
    let amountToWithdraw: BigNumber;

    interface IStrategyInfo {
      name: string,
      notUnderlyingToken: string;
      movePricesUpBeforeWithdraw?: boolean;
    }

    const strategies: IStrategyInfo[] = [
      // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, movePricesUpBeforeWithdraw: true},
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      /**
       * Initially signer deposits 1000 USDC, also he has additional 1000 USDC on the balance.
       * Fuse OFF by default, rebalance is not needed
       */
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {
            kyberPid: KYBER_PID_DEFAULT_BLOCK,
            notUnderlying: strategyInfo.notUnderlyingToken
          }
        );
        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await InjectUtils.redeployAave3PoolAdapters(signer);

        await b.vault.connect(b.gov).setFees(0, 0);

        console.log('deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('35000', 6));
        await b.vault.connect(signer).deposit(parseUnits('10000', 6), signer.address);

        amountToWithdraw = (await b.vault.maxWithdraw(signer.address)).sub(parseUnits("1", 6));

        await PairBasedStrategyPrepareStateUtils.prepareInsurance(b, "1000");

        if (strategyInfo.movePricesUpBeforeWithdraw) {
          const state = await PackedData.getDefaultState(b.strategy);
          await UniversalUtils.movePoolPriceUp(signer, state, b.swapper, parseUnits("12000", 6));
        }
        return b;
      }

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}:${strategyInfo.movePricesUpBeforeWithdraw ? "MovePricesUp" : ""}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("should withdraw almost all successfully, use standard swapper", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);

          expect(stateAfter.vault.sharePrice).eq(stateBefore.vault.sharePrice);
        });

        it("should withdraw almost all successfully, mocked swapper returns higher amount  for any swap", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const state = await PackedData.getDefaultState(b.strategy);
          const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
            converter: b.converter.address,
            token0: state.tokenA,
            token1: state.tokenB,
            increaseOutput: true
          });

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, mockedSwapper.address);
          await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, b.swapper);
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.vault.sharePrice).eq(stateBefore.vault.sharePrice);
        });

        it("should withdraw almost all successfully, mocked swapper returns smaller amount for any swap", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const state = await PackedData.getDefaultState(b.strategy);
          const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
            converter: b.converter.address,
            token0: state.tokenA,
            token1: state.tokenB,
            increaseOutput: false
          });

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, mockedSwapper.address);
          await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, b.swapper);
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.vault.sharePrice).eq(stateBefore.vault.sharePrice);
        });

        it("should withdraw almost all successfully, token0=>token1 swap amount higher, token0=>token1 swap amount lower", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const state = await PackedData.getDefaultState(b.strategy);
          const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
            converter: b.converter.address,
            token0: state.tokenA,
            token1: state.tokenB,
            increaseOutput: true,
            reverseDirections: true,
          });

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, mockedSwapper.address);
          await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, b.swapper);
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.vault.sharePrice).eq(stateBefore.vault.sharePrice);
        });

        it("should withdraw almost all successfully, token0=>token1 swap amount lower, token0=>token1 swap amount higher", async () => {
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const state = await PackedData.getDefaultState(b.strategy);
          const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
            converter: b.converter.address,
            token0: state.tokenA,
            token1: state.tokenB,
            increaseOutput: false,
            reverseDirections: true,
          });

          const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, mockedSwapper.address);
          await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
          await MockAggregatorUtils.injectSwapperToLiquidator(MaticAddresses.TETU_LIQUIDATOR, b, b.swapper);
          const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

          expect(stateAfter.vault.sharePrice).eq(stateBefore.vault.sharePrice);
        });

      });
    });
  });
//endregion Unit tests
});
