/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  BorrowManager,
  BorrowManager__factory,
  ConverterController__factory,
  ConverterStrategyBase__factory,
  IDebtMonitor,
  IDebtMonitor__factory,
  IERC20__factory,
  IKeeperCallback__factory,
  IPlatformAdapter__factory,
  IPoolAdapter__factory, PairBasedStrategyReader, UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
} from '../../../../typechain';
import {Misc} from "../../../../scripts/utils/Misc";
import {formatUnits, parseUnits} from 'ethers/lib/utils';
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
  PLAN_SWAP_REPAY_0
} from "../../../baseUT/AppConstants";
import {BigNumber} from "ethers";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {
  PairWithdrawByAggUtils
} from "../../../baseUT/strategies/pair/PairWithdrawByAggUtils";
import {buildEntryData1} from "../../../baseUT/utils/EntryDataUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {IEventsSet} from "../../../baseUT/strategies/CaptureEvents";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

describe('PairBasedStrategyTwistedDebts', function () {
  /**
   * Max allowed count of steps required to reduce locked percent to the given value.
   * Without calculation of requiredAmountToReduceDebt this value can be very high
   */
  const MAX_ALLOWED_COUNT_STEPS = 5;

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;

  let reader: PairBasedStrategyReader;
//endregion Variables

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    [signer, signer2, signer3] = await ethers.getSigners();

    reader = await MockHelper.createPairBasedStrategyReader(signer);
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
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

  interface ITargetLockedAmountPercentConfig {
    /** 0.01 means that the locked-amount-percent should be reduced to 1% of the current value */
    percentRatio: number;
    maxCountSteps: number;

    /** Bad case: try to multiple requiredAmountToReduceDebt on the given number */
    useTooHugeAmount?: number; // 1 by default
    /** It's enough to run the test with the given params only 1 time - so all embedded foreach must use 1 item only */
    singleIterationOnly?: boolean; // false by default
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
//endregion Utils

//region Unit tests
  interface IStrategyInfo {
    name: string,
    amountDepositBySigner?: string; // "10000" by default
  }

  const strategies: IStrategyInfo[] = [
    // {name: PLATFORM_UNIV3, amountDepositBySigner: "250000"},
    {name: PLATFORM_ALGEBRA,},
    {name: PLATFORM_UNIV3, amountDepositBySigner: "25000"},
    // {name: PLATFORM_KYBER,}, /// Kyber is not used after security incident nov-2023
  ];

  describe("Prices up", () => {
    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      interface IPrepareStrategyResults {
        builderResults: IBuilderResults;
        states: IStateNum[];
      }

      async function prepareStrategy(): Promise<IPrepareStrategyResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          POLYGON_NETWORK_ID,
          strategyInfo.name,
          signer,
          signer2,
          {kyberPid: KYBER_PID_DEFAULT_BLOCK}
        );
        await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(signer, b.strategy.address);
        const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
        const states: IStateNum[] = [];
        const pathOut = `./tmp/${strategyInfo.name}-folded-debts-up-user-prepare-strategy.csv`;

        console.log('Deposit...');
        await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
        await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
        await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: 19_000_000});
        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "d0"));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

        const p: IPrepareOverCollateralParams = {
          countRebalances: 2,
          movePricesUp: true,
          swapAmountRatio: strategyInfo.name === PLATFORM_ALGEBRA ? 0.3 : 1.1,
          amountToDepositBySigner2: "100",
          amountToDepositBySigner: strategyInfo.amountDepositBySigner ?? "10000",
          changePricesInOppositeDirectionAtFirst: strategyInfo.name === PLATFORM_ALGEBRA
        }
        const listStates = await PairBasedStrategyPrepareStateUtils.prepareTwistedDebts(b, p, pathOut, signer, signer2);
        return {builderResults: b, states: [...states, ...listStates.states]};
      }

      describe(`${strategyInfo.name}`, () => {
        let snapshot: string;
        let builderResults: IBuilderResults;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
          builderResults = (await prepareStrategy()).builderResults;
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        describe("Test set", function () {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          it("should deposit successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);
            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
          });
          it("should withdraw successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            // 2163.780528 = 2163.7805280000002
            expect(stateAfter.user.assetBalance).approximately(stateBefore.user.assetBalance + 300, 1);
          });
          it("should withdraw-all successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            console.log('stateBefore', stateBefore);
            console.log('stateAfter', stateAfter);

            expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
            expect(stateBefore.vault.userShares).gt(0);
            expect(stateAfter.vault.userShares).eq(0);
          });
          it("should withdraw-all successfully when strategy balance is high", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            // add high enough amount on strategy balance, keep this amount on balance (don't enter to the pool)
            await converterStrategyBase.connect(await UniversalTestUtils.getAnOperator(builderResults.strategy.address, signer)).setReinvestThresholdPercent(100_000);
            await builderResults.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            console.log('stateBefore', stateBefore);
            console.log('stateAfter', stateAfter);

            expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
            expect(stateBefore.vault.userShares).gt(0);
            expect(stateAfter.vault.userShares).eq(0);
          });
          it("should revert on rebalance", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const needRebalanceBefore = await builderResults.strategy.needRebalance();
            expect(needRebalanceBefore).eq(false);

            const platform = await converterStrategyBase.PLATFORM();
            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-9 No rebalance needed"
              : platform === PLATFORM_ALGEBRA
                ? "AS-9 No rebalance needed"
                : "KS-9 No rebalance needed";

            await expect(
              builderResults.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage); // NO_REBALANCE_NEEDED
          });
          it("should rebalance debts successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const planEntryData = buildEntryData1();
            const quote = await builderResults.strategy.callStatic.quoteWithdrawByAgg(planEntryData);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.strategy.withdrawByAggStep(
              quote.tokenToSwap,
              Misc.ZERO_ADDRESS,
              quote.amountToSwap,
              "0x",
              planEntryData,
              ENTRY_TO_POOL_IS_ALLOWED,
              {gasLimit: 19_000_000}
            );
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            console.log("stateBefore", stateBefore);
            console.log("stateAfter", stateAfter);

            expect(stateAfter.strategy.investedAssets + stateAfter.strategy.assetBalance).approximately(
              stateBefore.strategy.investedAssets + stateBefore.strategy.assetBalance,
              100
            );
          });
          it("should hardwork successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              builderResults.strategy.address,
              await Misc.impersonate(builderResults.splitter.address)
            );

            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, builderResults.strategy);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await converterStrategyBase.doHardWork({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            expect(stateAfter.strategy.investedAssets).gte(stateBefore.strategy.investedAssets - 0.001);
          });
          it("should make emergency exit successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            expect(stateAfter.strategy.liquidity).lt(10);
          });

          if (strategyInfo.name === PLATFORM_UNIV3) {
            // requirePayAmountBack implementation is shared for all strategies, we can check it on single strategy only
            it("should requirePayAmountBack successfully", async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);
              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              // requirePayAmountBack is called by converter inside requireRepay
              const {checkBefore, checkAfter} = await callRequireRepay(builderResults);
              expect(checkBefore.length).gt(0, "health wasn't broken");
              expect(checkAfter.length).lt(checkBefore.length, "health wasn't restored");

              // withdraw all and receive expected amount back
              await builderResults.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              console.log('stateBefore', stateBefore);
              console.log('stateAfter', stateAfter);

              expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
              expect(stateBefore.vault.userShares).gt(0);
              expect(stateAfter.vault.userShares).eq(0);
            });
          }
        });

        describe("withdraw various amounts", function () {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          const withdrawAmountPercents = [1, 3, 7, 23, 41, 67, 77, 83, 91, 99];
          withdrawAmountPercents.forEach(function (percentToWithdraw: number) {
            it(`should withdraw ${percentToWithdraw}% successfully`, async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              const vault = builderResults.vault.connect(signer);
              const maxAmountToWithdraw = await vault.maxWithdraw(signer.address);
              const amountToWithdraw = maxAmountToWithdraw.mul(percentToWithdraw).div(100);
              await vault.withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              expect(stateAfter.user.assetBalance).approximately(
                stateBefore.user.assetBalance + +formatUnits(amountToWithdraw, builderResults.assetDecimals),
                1
              );
            });
          });
        })

        describe("withdraw several portions", function () {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          const MAX_COUNT_STEPS = 3;
          const withdrawAmountPercents = [3, 5, 11, 17, 23, 31]; // we assume that withdrawAmountPercents * MAX_COUNT_STEPS < 100
          withdrawAmountPercents.forEach(function (percentToWithdraw: number) {
            it(`should withdraw ${percentToWithdraw}% successfully several times`, async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              const vault = builderResults.vault.connect(signer);
              const maxAmountToWithdraw = await vault.maxWithdraw(signer.address);
              const amountToWithdraw = maxAmountToWithdraw.mul(percentToWithdraw).div(100);

              let step = 0;
              while (true) {
                console.log(`withdraw all by portions ================ ${step++} =============`)
                const maxAmount = await vault.maxWithdraw(signer.address);
                console.log("Max amount:", +formatUnits(maxAmount, builderResults.assetDecimals));
                await vault.withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 9_000_000});

                if (await builderResults.strategy.needRebalance()) {
                  console.log("rebalance");
                  await builderResults.strategy.rebalanceNoSwaps(true, {gasLimit: 9_000_000});
                }

                if (step === MAX_COUNT_STEPS) break;
              }
              console.log("withdrawAll");
              await vault.withdrawAll({gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              expect(stateAfter.user.assetBalance).approximately(
                stateBefore.user.assetBalance + +formatUnits(maxAmountToWithdraw, builderResults.assetDecimals),
                100
              );
            });
          });
        })

        describe("deposit various amounts", function () {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          const amountsToDeposit = ["100", "8000", "11000", "15000"]; // < total assets, ~ total assets, > total assets
          amountsToDeposit.forEach(function (amountToDeposit: string) {

            it(`should deposit ${amountToDeposit} successfully`, async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              await TokenUtils.getToken(builderResults.asset, signer.address, parseUnits(amountToDeposit, 6));
              await builderResults.vault.connect(signer).deposit(parseUnits(amountToDeposit, 6), signer.address, {gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

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
          before(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
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

        if (strategyInfo.name === PLATFORM_UNIV3) {
          describe("Rebalance to reduce locked amount percent, the pool has given proportions", function () {
            const TARGET_LOCKED_AMOUNT_PERCENT_RATIO: ITargetLockedAmountPercentConfig[] = [
              {percentRatio: 0.25, maxCountSteps: 3, useTooHugeAmount: 100, singleIterationOnly: true},
              {percentRatio: 0.05, maxCountSteps: 10},
              {percentRatio: 0.25, maxCountSteps: 3},
            ];
            const SWAP_AMOUNT_RATIO = [110, 0.01, 50, 99.95, 100.05];
            TARGET_LOCKED_AMOUNT_PERCENT_RATIO.forEach(lockedPercentConfig => {
              let currentLockedPercent: number;
              let targetLockedPercent: number;
              let uniswapStrategy: UniswapV3ConverterStrategy;
              before(async function () {
                const ret = await reader.getLockedUnderlyingAmount(builderResults.strategy.address);
                const estimatedUnderlyingAmount = +formatUnits(ret.estimatedUnderlyingAmount, builderResults.assetDecimals);
                const strategyTotalAssets = +formatUnits(ret.totalAssets, builderResults.assetDecimals);
                currentLockedPercent = estimatedUnderlyingAmount / strategyTotalAssets * 100;
                targetLockedPercent = currentLockedPercent * lockedPercentConfig.percentRatio;
              });

              SWAP_AMOUNT_RATIO.forEach(swapAmountRatio => {
                if (!lockedPercentConfig.singleIterationOnly || swapAmountRatio === SWAP_AMOUNT_RATIO[0]) {
                  const pathOut = `./tmp/up-${lockedPercentConfig.percentRatio}-${swapAmountRatio.toString()}.csv`;
                  describe(`reduce-locked-percent-ratio=${lockedPercentConfig.percentRatio} swapAmountRatio=${swapAmountRatio.toString()}`, function () {
                    let snapshotLevel0: string;
                    const states: IStateNum[] = [];

                    before(async function () {
                      snapshotLevel0 = await TimeUtils.snapshot();
                      await makeSwapToPrepareProportionsInPool();

                      const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

                      // estimate amount-to-reduce-debt

                      await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
                        builderResults.strategy.connect(await UniversalTestUtils.getAnOperator(builderResults.strategy.address, signer)),
                        Misc.ZERO_ADDRESS,
                        false,
                        lastState => {
                          return (lastState?.lockedPercent ?? 0) < targetLockedPercent
                        },
                        async (title: string, eventsSet: IEventsSet) => {
                          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault, `step${states.length}`, {eventsSet}));
                          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, builderResults.stateParams, true);
                          return states[states.length - 1];
                        },
                        async () => {
                          const requiredAmountToReduceDebt = await PairBasedStrategyPrepareStateUtils.getAmountToReduceDebtForStrategy(
                            builderResults.strategy.address,
                            reader,
                            targetLockedPercent,
                          );
                          // const state0 = states.length === 0
                          //   ? await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault)
                          //   : states[states.length - 1];
                          // const requiredAmountToReduceDebt2 = await PairBasedStrategyPrepareStateUtils.getRequiredAmountToReduceDebt(
                          //   signer,
                          //   state0,
                          //   reader,
                          //   targetLockedPercent,
                          //   await converterStrategyBase.asset()
                          // );
                          // console.log("state0", state0);
                          // console.log("currentLockedPercent", currentLockedPercent);
                          // console.log("targetLockedPercent", targetLockedPercent);
                          // console.log("requiredAmountToReduceDebt", requiredAmountToReduceDebt);
                          // console.log("requiredAmountToReduceDebt2", requiredAmountToReduceDebt2);
                          if (lockedPercentConfig.useTooHugeAmount) {
                            return requiredAmountToReduceDebt.mul(lockedPercentConfig.useTooHugeAmount);
                          } else {
                            return requiredAmountToReduceDebt.mul(110).div(100);
                          }
                        }
                      )
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshotLevel0);
                    });

                    async function makeSwapToPrepareProportionsInPool() {
                      const state = await PackedData.getDefaultState(builderResults.strategy);
                      uniswapStrategy = await UniswapV3ConverterStrategy__factory.connect(builderResults.strategy.address, signer);
                      const propNotUnderlying18Before = await uniswapStrategy.getPropNotUnderlying18();
                      console.log("propNotUnderlying18 before", propNotUnderlying18Before);
                      const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
                        signer,
                        builderResults,
                        state.tokenA,
                        state.tokenB,
                        false, // move price UP
                        swapAmountRatio / 100
                      );
                      await UniversalUtils.movePoolPriceUp(signer2, state, builderResults.swapper, swapAmount, 40000, builderResults.swapHelper);
                      const propNotUnderlying18After = await uniswapStrategy.getPropNotUnderlying18();
                      console.log("propNotUnderlying18 after", propNotUnderlying18After);
                    }

                    it("should make rebalance using single iteration", async () => {
                      console.log("propNotUnderlying18", await uniswapStrategy.getPropNotUnderlying18());
                      console.log("currentLockedPercent", currentLockedPercent);
                      console.log("targetLockedPercent", targetLockedPercent);
                      console.log("Count steps", states.length);
                      expect(states.length).lt(lockedPercentConfig.maxCountSteps);
                    });
                    it("should invest all liquidity to the pool", async () => {
                      const lastState = states[states.length - 1];
                      console.log(lastState);
                      expect(lastState.strategy.assetBalance).lt(lastState.strategy.totalAssets / 100);
                      expect(lastState.strategy.borrowAssetsBalances[0]).lt(1);
                    });
                    it("should reduce locked percent below the given value", async () => {
                      const lastState = states[states.length - 1];
                      expect(lastState.lockedPercent === undefined).eq(false);
                      expect(lastState.lockedPercent ?? 0).lt(targetLockedPercent);
                    });
                  })
                }
              });
            });
          });
        }
      });
    });
  });
  describe("Prices down", () => {
    strategies.forEach(function (strategyInfo: IStrategyInfo) {

      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          POLYGON_NETWORK_ID,
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
        let builderResults: IBuilderResults;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
          builderResults = await prepareStrategy()
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        describe("Test set", function () {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          it("should deposit successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
          });
          it("should withdraw successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: 8_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 300);
          });
          it("should withdraw-all successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.vault.connect(signer).withdrawAll({gasLimit: 8_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            console.log('stateBefore', stateBefore);
            console.log('stateAfter', stateAfter);

            expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
            expect(stateBefore.vault.userShares).gt(0);
            expect(stateAfter.vault.userShares).eq(0);
          });
          it("should revert on rebalance", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const needRebalanceBefore = await builderResults.strategy.needRebalance();
            expect(needRebalanceBefore).eq(false);

            const platform = await converterStrategyBase.PLATFORM();
            const expectedErrorMessage = platform === PLATFORM_UNIV3
              ? "U3S-9 No rebalance needed"
              : platform === PLATFORM_ALGEBRA
                ? "AS-9 No rebalance needed"
                : "KS-9 No rebalance needed";

            await expect(
              builderResults.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000})
            ).revertedWith(expectedErrorMessage); // NO_REBALANCE_NEEDED
          });
          it("should rebalance debts successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            const planEntryData = buildEntryData1();
            const quote = await builderResults.strategy.callStatic.quoteWithdrawByAgg(planEntryData);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await builderResults.strategy.withdrawByAggStep(
              quote.tokenToSwap,
              Misc.ZERO_ADDRESS,
              quote.amountToSwap,
              "0x",
              planEntryData,
              ENTRY_TO_POOL_IS_ALLOWED,
              {gasLimit: 19_000_000}
            );
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            console.log("stateBefore", stateBefore);
            console.log("stateAfter", stateAfter);

            expect(stateAfter.strategy.investedAssets).approximately(stateBefore.strategy.investedAssets, 100);
          });
          it("should hardwork successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(
              builderResults.strategy.address,
              await Misc.impersonate(builderResults.splitter.address)
            );

            // put additional fee to profit holder bo make isReadyToHardwork returns true
            await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, builderResults.strategy);

            const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
            await converterStrategyBase.doHardWork({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            expect(stateAfter.strategy.investedAssets).gte(stateBefore.strategy.investedAssets - 0.001);
          });
          it("should make emergency exit successfully", async () => {
            const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

            await converterStrategyBase.emergencyExit({gasLimit: 19_000_000});
            const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

            expect(stateAfter.strategy.liquidity).lt(10);
          });

          if (strategyInfo.name === PLATFORM_UNIV3) {
            // requirePayAmountBack implementation is shared for all strategies, we can check it on single strategy only
            it("should requirePayAmountBack successfully", async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);
              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              // requirePayAmountBack is called by converter inside requireRepay
              const {checkBefore, checkAfter} = await callRequireRepay(builderResults);
              expect(checkBefore.length).gt(0, "health wasn't broken");
              expect(checkAfter.length).lt(checkBefore.length, "health wasn't restored");

              // withdraw all and receive expected amount back
              await builderResults.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

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
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          const withdrawAmountPercents = [1, 3, 7, 23, 41, 67, 77, 83, 91, 99, ];
          withdrawAmountPercents.forEach(function (percentToWithdraw: number) {
            it(`should withdraw ${percentToWithdraw}% successfully`, async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              const vault = builderResults.vault.connect(signer);
              const maxAmountToWithdraw = await vault.maxWithdraw(signer.address);
              const amountToWithdraw = maxAmountToWithdraw.mul(percentToWithdraw).div(100);
              await vault.withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 9_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              expect(stateAfter.user.assetBalance).approximately(
                stateBefore.user.assetBalance + +formatUnits(amountToWithdraw, builderResults.assetDecimals),
                1
              );
            });
          });
        })

        describe("deposit various amounts", () => {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          // borrow-direction is changed on largest amount
          const amountsToDeposit = ["100", "8000", "11000", "40000"]; // < total assets, ~ total assets, > total assets
          amountsToDeposit.forEach(function (amountToDeposit: string) {

            it(`should deposit ${amountToDeposit} successfully`, async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              await TokenUtils.getToken(builderResults.asset, signer.address, parseUnits(amountToDeposit, 6));
              await builderResults.vault.connect(signer).deposit(parseUnits(amountToDeposit, 6), signer.address, {gasLimit: 19_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              StateUtilsNum.saveListStatesToCSVColumns(`./tmp/${strategyInfo.name}-deposit-${amountToDeposit}.csv`, [stateBefore, stateAfter], builderResults.stateParams, true);

              expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets, "totalAssets should increase");

              const directDebtExist = stateAfter.converterDirect.amountsToRepay.findIndex(x => x !== 0) !== -1;
              const reverseDebtExist = stateAfter.converterReverse.amountsToRepay.findIndex(x => x !== 0) !== -1;
              expect(!(directDebtExist && reverseDebtExist)).eq(true, "scb-807: direct and revers borrows are not allowed at the same time");

            });
          });
        })

        describe("withdraw several portions", function () {
          let snapshotLocal0: string;
          beforeEach(async function () {
            snapshotLocal0 = await TimeUtils.snapshot();
          });
          afterEach(async function () {
            await TimeUtils.rollback(snapshotLocal0);
          });

          const MAX_COUNT_STEPS = 5;
          const withdrawAmountPercents = [3, 5, 11, ]; // we assume that withdrawAmountPercents * MAX_COUNT_STEPS < 100
          withdrawAmountPercents.forEach(function (percentToWithdraw: number) {
            it(`should withdraw ${percentToWithdraw}% successfully several times`, async () => {
              const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

              const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);
              const vault = builderResults.vault.connect(signer);
              const maxAmountToWithdraw = await vault.maxWithdraw(signer.address);
              const amountToWithdraw = maxAmountToWithdraw.mul(percentToWithdraw).div(100);

              let step = 0;
              while (true) {
                console.log(`withdraw all by portions ================ ${step++} =============`)
                const maxAmount = await vault.maxWithdraw(signer.address);
                console.log("Max amount:", +formatUnits(maxAmount, builderResults.assetDecimals));
                await vault.withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: 9_000_000});

                if (await builderResults.strategy.needRebalance()) {
                  console.log("rebalance");
                  await builderResults.strategy.rebalanceNoSwaps(true, {gasLimit: 9_000_000});
                }

                if (step === MAX_COUNT_STEPS) break;
              }
              await vault.withdrawAll({gasLimit: 9_000_000});
              const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault);

              expect(stateAfter.user.assetBalance).approximately(
                stateBefore.user.assetBalance + +formatUnits(maxAmountToWithdraw, builderResults.assetDecimals),
                100
              );
            });
          });
        })

        if (strategyInfo.name === PLATFORM_UNIV3) {
          describe("Rebalance to reduce locked amount percent, the pool has given proportions", function () {
            const TARGET_LOCKED_AMOUNT_PERCENT_RATIO: ITargetLockedAmountPercentConfig[] = [
              {percentRatio: 0.05, maxCountSteps: 10},
              {percentRatio: 0.25, maxCountSteps: 3}
            ];
            const SWAP_AMOUNT_RATIO = [0.01, 50, 99.95, /* 100.05, 110 */ ];
            TARGET_LOCKED_AMOUNT_PERCENT_RATIO.forEach(lockedPercentConfig => {
              let currentLockedPercent: number;
              let targetLockedPercent: number;
              let uniswapStrategy: UniswapV3ConverterStrategy;
              before(async function () {
                const ret = await reader.getLockedUnderlyingAmount(builderResults.strategy.address);
                const estimatedUnderlyingAmount = +formatUnits(ret.estimatedUnderlyingAmount, builderResults.assetDecimals);
                const strategyTotalAssets = +formatUnits(ret.totalAssets, builderResults.assetDecimals);
                currentLockedPercent = estimatedUnderlyingAmount / strategyTotalAssets * 100;
                targetLockedPercent = currentLockedPercent * lockedPercentConfig.percentRatio;
              });

              SWAP_AMOUNT_RATIO.forEach(swapAmountRatio => {
                const pathOut = `./tmp/down-${lockedPercentConfig.percentRatio}-${swapAmountRatio.toString()}.csv`;
                describe(`reduce-locked-percent-ratio=${lockedPercentConfig.percentRatio} swapAmountRatio=${swapAmountRatio.toString()}`, function () {
                  let snapshotLevel0: string;
                  const states: IStateNum[] = [];

                  before(async function () {
                    snapshotLevel0 = await TimeUtils.snapshot();
                    await makeSwapToPrepareProportionsInPool();

                    const converterStrategyBase = ConverterStrategyBase__factory.connect(builderResults.strategy.address, signer);

                    // estimate amount-to-reduce-debt

                    await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
                      builderResults.strategy.connect(await UniversalTestUtils.getAnOperator(builderResults.strategy.address, signer)),
                      Misc.ZERO_ADDRESS,
                      false,
                      lastState => {
                        return (lastState?.lockedPercent ?? 0) < targetLockedPercent
                      },
                      async (title: string, eventsSet: IEventsSet) => {
                        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault, `step${states.length}`, {eventsSet}));
                        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, builderResults.stateParams, true);
                        return states[states.length - 1];
                      },
                      async () => {
                        // const state0 = states.length === 0
                        //   ? await StateUtilsNum.getState(signer, signer, converterStrategyBase, builderResults.vault)
                        //   : states[states.length - 1];
                        const requiredAmountToReduceDebt = await PairBasedStrategyPrepareStateUtils.getAmountToReduceDebtForStrategy(
                          builderResults.strategy.address,
                          reader,
                          targetLockedPercent,
                        );
                        // const requiredAmountToReduceDebt = await PairBasedStrategyPrepareStateUtils.getRequiredAmountToReduceDebt(
                        //   signer,
                        //   state0,
                        //   reader,
                        //   targetLockedPercent,
                        //   await converterStrategyBase.asset()
                        // );
                        return requiredAmountToReduceDebt.mul(110).div(100);
                      }
                    )
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLevel0);
                  });

                  async function makeSwapToPrepareProportionsInPool() {
                    const state = await PackedData.getDefaultState(builderResults.strategy);
                    uniswapStrategy = await UniswapV3ConverterStrategy__factory.connect(builderResults.strategy.address, signer);
                    const propNotUnderlying18Before = await uniswapStrategy.getPropNotUnderlying18();
                    console.log("propNotUnderlying18 before", propNotUnderlying18Before);
                    const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
                      signer,
                      builderResults,
                      state.tokenA,
                      state.tokenB,
                      true, // move price UP
                      swapAmountRatio / 100
                    );
                    await UniversalUtils.movePoolPriceUp(signer2, state, builderResults.swapper, swapAmount, 40000, builderResults.swapHelper);
                    const propNotUnderlying18After = await uniswapStrategy.getPropNotUnderlying18();
                    console.log("propNotUnderlying18 after", propNotUnderlying18After);
                  }

                  it("should make rebalance using single iteration", async () => {
                    console.log("propNotUnderlying18", await uniswapStrategy.getPropNotUnderlying18());
                    console.log("currentLockedPercent", currentLockedPercent);
                    console.log("targetLockedPercent", targetLockedPercent);
                    console.log("Count states", states.length);
                    // console.log(states);
                    expect(states.length).lt(MAX_ALLOWED_COUNT_STEPS);
                  });
                  it("should invest most part of liquidity to the pool", async () => {
                    const lastState = states[states.length - 1];
                    expect(lastState.strategy.assetBalance).lt(lastState.strategy.totalAssets / 10);
                    expect(lastState.strategy.borrowAssetsBalances[0]).lt(lastState.strategy.totalAssets / 10); // assume that we have only stablecoins here, they are comparable
                  });
                  it("should reduce locked percent below the given value", async () => {
                    const lastState = states[states.length - 1];
                    expect(lastState.lockedPercent === undefined).eq(false);
                    expect(lastState.lockedPercent ?? 0).lt(targetLockedPercent);
                  });
                })
              });
            });
          });
        }
      });
    });
  });
//endregion Unit tests
});