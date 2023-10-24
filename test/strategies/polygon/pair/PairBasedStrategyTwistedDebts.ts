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
import {IBuilderResults, KYBER_PID_DEFAULT_BLOCK} from "../../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/pair/PairStrategyFixtures";
import {
  IListStates,
  IPrepareOverCollateralParams,
  PairBasedStrategyPrepareStateUtils
} from "../../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {
  ENTRY_TO_POOL_DISABLED,
  ENTRY_TO_POOL_IS_ALLOWED,
  FUSE_OFF_1,
  PLAN_REPAY_SWAP_REPAY_1,
  PLAN_SWAP_REPAY_0
} from "../../../baseUT/AppConstants";
import {BigNumber} from "ethers";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {PairWithdrawByAggUtils} from "../../../baseUT/strategies/pair/PairWithdrawByAggUtils";
import {buildEntryData1} from "../../../baseUT/utils/EntryDataUtils";

describe('PairBasedStrategyTwistedDebts', function() {

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    [signer, signer2, signer3] = await ethers.getSigners();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Data types
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
//endregion Data types

//region Utils
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

  interface IStrategyInfo {
    name: string,
  }

  const strategies: IStrategyInfo[] = [
    {name: PLATFORM_UNIV3,},
    {name: PLATFORM_ALGEBRA,},
    {name: PLATFORM_KYBER,},
  ];
//endregion Utils

//region Unit tests
  describe("Prices up", () => {
    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );
        await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(signer, b.strategy.address);
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
        const states: IStateNum[] = [];
        const pathOut = `./tmp/${strategyInfo.name}-folded-debts-up-user-prepare-strategy.csv`;

        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await ConverterUtils.disableDForce(signer);
        // await InjectUtils.redeployAave3PoolAdapters(signer);

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

        describe("Test set", () => {
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

            const planEntryData = buildEntryData1();
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

        describe("withdraw various amounts", () => {
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
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
          let snapshotLocal0: string;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
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

        describe('Full withdraw when fuse is triggered ON', function () {
          let snapshotLocal0: string;
          let builderResults: IBuilderResults;
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
            builderResults = await prepareStrategy();
            // prepare fuse
            await PairBasedStrategyPrepareStateUtils.prepareFuse(builderResults, true);
            // enable fuse
            await builderResults.strategy.connect(signer).rebalanceNoSwaps(true, {gasLimit: 10_000_000});
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          async function makeWithdrawAll(): Promise<IListStates> {
            const ptr = await PairWithdrawByAggUtils.prepareWithdrawTest(signer, signer2, builderResults, {
              movePricesUp: true, // not used here
              skipOverCollateralStep: true,
              pathTag: "#full-withdraw-fuse-on"
            });

            return PairWithdrawByAggUtils.completeWithdrawTest(signer, signer2, builderResults, {
              singleIteration: false,
              entryToPool: ENTRY_TO_POOL_DISABLED,
              planKind: PLAN_SWAP_REPAY_0,
              propNotUnderlying: "0",
              states0: ptr.states,
              pathOut: ptr.pathOut
            });
          }

          it("initially should set fuse triggered ON", async () => {
            const state = await PackedData.getDefaultState(builderResults.strategy);
            expect(state.fuseStatus > FUSE_OFF_1).eq(true);
          });
          it("initially should set withdrawDone = 0", async () => {
            const state = await PackedData.getDefaultState(builderResults.strategy);
            expect(state.withdrawDone).eq(0);
          });
          it("should not enter to the pool at the end", async () => {
            const ret = await loadFixture(makeWithdrawAll);
            const stateLast = ret.states[ret.states.length - 1];
            expect(stateLast.strategy.liquidity).lt(1000);
          });
          it("should set expected investedAssets", async () => {
            const ret = await loadFixture(makeWithdrawAll);
            const stateFirst = ret.states[0];
            const stateLast = ret.states[ret.states.length - 1];
            expect(stateLast.strategy.investedAssets).lt(1000);
          });
          it("should set expected totalAssets", async () => {
            const ret = await loadFixture(makeWithdrawAll);
            const uncoveredLoss = StateUtilsNum.getTotalUncoveredLoss(ret.states);
            const stateFirst = ret.states[0];
            const stateLast = ret.states[ret.states.length - 1];
            expect(stateLast.vault.totalAssets + uncoveredLoss).approximately(stateFirst.vault.totalAssets, 100);
          });
          it("should set withdrawDone=1 at the end", async () => {
            const ret = await loadFixture(makeWithdrawAll);
            const stateFirst = ret.states[0];
            const stateLast = ret.states[ret.states.length - 1];
            expect(stateLast.pairState?.withdrawDone).eq(1);
            expect(stateFirst.pairState?.withdrawDone).eq(0);
          });
          it("should set lastRebalanceNoSwap to 0 at the end", async () => {
            const ret = await loadFixture(makeWithdrawAll);
            const stateLast = ret.states[ret.states.length - 1];
            expect(stateLast.pairState?.lastRebalanceNoSwap).eq(0);
          });
        });
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
        await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(signer, b.strategy.address);
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
        const platform = await converterStrategyBase.PLATFORM();
        const states: IStateNum[] = [];
        const pathOut = `./tmp/${strategyInfo.name}-folded-debts-down-user-prepare-strategy.csv`;

        await InjectUtils.injectTetuConverter(signer);
        await ConverterUtils.disableAaveV2(signer);
        await ConverterUtils.disableDForce(signer);
        // await InjectUtils.redeployAave3PoolAdapters(signer);

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

          const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_REPAY_SWAP_REPAY_1, Misc.MAX_UINT]);
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
//endregion Unit tests
});