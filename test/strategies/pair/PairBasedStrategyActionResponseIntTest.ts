/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  ConverterStrategyBase__factory,
  IController__factory,
  IERC20__factory, IERC20Metadata__factory, ISwapper__factory, TetuLiquidator__factory,

} from '../../../typechain';
import {Misc} from "../../../scripts/utils/Misc";
import {defaultAbiCoder, formatUnits, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults} from "../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import {
  PLATFORM_ALGEBRA,
  PLATFORM_KYBER,
  PLATFORM_PANCAKE,
  PLATFORM_UNIV3
} from "../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../baseUT/strategies/pair/PairStrategyFixtures";
import {
  PairBasedStrategyPrepareStateUtils
} from "../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {UniversalUtils} from "../../baseUT/strategies/UniversalUtils";
import {IDefaultState, PackedData} from "../../baseUT/utils/PackedData";
import {UniversalTestUtils} from "../../baseUT/utils/UniversalTestUtils";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {GAS_LIMIT, GAS_LIMIT_PAIR_BASED_WITHDRAW, GAS_REBALANCE_NO_SWAP} from "../../baseUT/GasLimits";
import {
  ENTRY_TO_POOL_DISABLED,
  ENTRY_TO_POOL_IS_ALLOWED,
  PLAN_SWAP_REPAY_0
} from "../../baseUT/AppConstants";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {BigNumber} from "ethers";
import {CaptureEvents, IEventsSet} from "../../baseUT/strategies/CaptureEvents";
import {MockAggregatorUtils} from "../../baseUT/mocks/MockAggregatorUtils";
import {InjectUtils} from "../../baseUT/strategies/InjectUtils";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from '../../baseUT/utils/HardhatUtils';
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {buildEntryData1} from "../../baseUT/utils/EntryDataUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {PlatformUtils} from "../../baseUT/utils/PlatformUtils";

describe('PairBasedStrategyActionResponseIntTest', function() {
  const SWAP_AMOUNT_DEFAULT = 1.1;
  const SWAP_AMOUNT_ALGEBRA = 0.25;
  const CHAINS_IN_ORDER_EXECUTION: number[] = [ZKEVM_NETWORK_ID, BASE_NETWORK_ID, POLYGON_NETWORK_ID];

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
//endregion Variables

//region Utils
  function tokenName(token: string): string {
    switch (token) {
      case MaticAddresses.USDC_TOKEN: return "USDC";
      case MaticAddresses.USDT_TOKEN: return "USDT";
      case MaticAddresses.WETH_TOKEN: return "WETH";
      case MaticAddresses.WMATIC_TOKEN: return "WMATIC";

      case BaseAddresses.USDC_TOKEN: return "USDC";
      case BaseAddresses.USDbC_TOKEN: return "USDbC";
      case BaseAddresses.WETH_TOKEN: return "WETH";
      case BaseAddresses.DAI_TOKEN: return "DAI";
      default: return token;
    }
  }

//endregion Utils

//region Unit tests
  CHAINS_IN_ORDER_EXECUTION.forEach(function (chainId) {
    describe(`chain ${chainId}`, function () {
//region before, after
      before(async function() {
        this.timeout(1200000);

        await HardhatUtils.setupBeforeTest(chainId);
        snapshotBefore = await TimeUtils.snapshot();

        // we need to display full objects, so we use util.inspect, see
        // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
        require("util").inspect.defaultOptions.depth = null;

        [signer, signer2, signer3] = await ethers.getSigners();

        await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
      });

      after(async function() {
        await TimeUtils.rollback(snapshotBefore);
      });
//endregion before, after

      describe("Prepare strategy", function() {
        interface IStrategyInfo {
          chainId: number;
          name: string,
          notUnderlyingToken: string;
          tag?: string; // to be able to distinct tests
        }
        const strategies: IStrategyInfo[] = [
          {chainId: ZKEVM_NETWORK_ID, name: PLATFORM_PANCAKE, notUnderlyingToken: ZkevmAddresses.USDT_TOKEN},
          {chainId: BASE_NETWORK_ID, name: PLATFORM_PANCAKE, notUnderlyingToken: BaseAddresses.USDbC_TOKEN},
          {chainId: POLYGON_NETWORK_ID, name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
          {chainId: POLYGON_NETWORK_ID, name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
          // {chainId: POLYGON_NETWORK_ID, name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN}, /// Kyber is not used after security incident nov-2023
          // todo Uncomment when volatile pairs will be used  {chainId: POLYGON_NETWORK_ID, name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN},
          // todo Uncomment when volatile pairs will be used {chainId: POLYGON_NETWORK_ID, name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN},
        ];

        strategies.forEach(function (strategyInfo: IStrategyInfo) {
          if (chainId === strategyInfo.chainId) {
            describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}${strategyInfo.tag ?? ""}`, () => {
            let b: IBuilderResults;
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
              b = await createStrategy();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function createStrategy(): Promise<IBuilderResults> {
              const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
                strategyInfo.chainId,
                strategyInfo.name,
                signer,
                signer2,
                {
                  notUnderlying: strategyInfo.notUnderlyingToken,
                  customParams: {
                    depositFee: 0,
                    withdrawFee: 300,
                    compoundRatio: 50_000,
                    buffer: 0
                  }
                }
              );

              await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(signer, b.strategy.address);

              return b;
            }

            describe("Deposit 1000 USDC, put additional 1000 USDC on user's balance", function() {
              let snapshotLevel0: string;
              before(async function () {
                snapshotLevel0 = await TimeUtils.snapshot();
                await makeDeposit();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLevel0);
              });
              async function makeDeposit() {
                console.log('deposit...');

                // make deposit and enter to the pool
                // let's ensure, that strategy has entered to the pool ... otherwise try to make more deposits
                for (let i = 0; i < 5; ++i) {
                  await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
                  await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
                  await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: GAS_LIMIT});

                  const state = await PackedData.getDefaultState(b.strategy);
                  if (state.totalLiquidity.gt(0)) {
                    break;
                  }
                }

                return b;
              }

              describe("Fuse off, need-rebalance off", () => {
                let snapshotLevel1: string;
                let snapshotLevel1Each: string;
                before(async function () {
                  snapshotLevel1 = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel1);
                });
                beforeEach(async function () {
                  snapshotLevel1Each = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotLevel1Each);
                });

                it("totalLiquidity should be > 0", async () => {
                  const state = await PackedData.getDefaultState(b.strategy);
                  expect(state.totalLiquidity.gt(0)).eq(true);
                });
                it("should deposit successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  console.log("Singer deposits 1000, asset balance", await IERC20Metadata__factory.connect(b.asset, signer).balanceOf(signer.address));
                  console.log("asset", b.asset);
                  await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
                });
                it("should withdraw successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 300);
                });
                it("should withdraw-all successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  console.log('stateBefore', stateBefore);

                  await b.vault.connect(signer).withdrawAll({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  console.log('stateAfter', stateAfter);

                  expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
                  expect(stateBefore.vault.userShares).gt(0);
                  expect(stateAfter.vault.userShares).eq(0);
                });
                it("should revert on rebalance", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const needRebalanceBefore = await b.strategy.needRebalance();
                  expect(needRebalanceBefore).eq(false);

                  const platform = await converterStrategyBase.PLATFORM();
                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-9 No rebalance needed");

                  await expect(
                    b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage); // NO_REBALANCE_NEEDED
                });
                it("should rebalance debts successfully", async () => {
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
                    {gasLimit: GAS_LIMIT}
                  );
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  console.log("stateBefore", stateBefore);
                  console.log("stateAfter", stateAfter);

                  expect(stateAfter.strategy.investedAssets + stateAfter.strategy.assetBalance).approximately(
                    stateBefore.strategy.investedAssets + stateBefore.strategy.assetBalance,
                    100
                  );
                });
                it("should hardwork successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(
                    b.strategy.address,
                    await Misc.impersonate(b.splitter.address)
                  );

                  // put additional fee to profit holder bo make isReadyToHardwork returns true
                  await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  const operator = await UniversalTestUtils.getAnOperator(b.strategy.address, signer);
                  const eventsSet = await CaptureEvents.makeHardworkInSplitter(converterStrategyBase, operator);

                  const liquidator = await IController__factory.connect(
                    await ConverterStrategyBase__factory.connect(b.strategy.address, signer).controller(),
                    signer
                  ).liquidator();
                  console.log("Largest pool", await TetuLiquidator__factory.connect(liquidator, signer).largestPools("0x0d1e753a25ebda689453309112904807625befbe"));

                  await converterStrategyBase.doHardWork({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "a", {eventsSet});

                  expect(stateAfter.strategy.investedAssets).gte(stateBefore.strategy.investedAssets - 0.001);
                });
                it("should make emergency exit successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  await converterStrategyBase.emergencyExit({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.strategy.liquidity).lt(10);
                });
                it("isReadyToHardWork should return expected value", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(
                    b.strategy.address,
                    await Misc.impersonate(b.splitter.address)
                  );
                  const platform = await converterStrategyBase.PLATFORM();

                  // currently kyber's isReadyToHardWork returns true without need to call prepareToHardwork
                  expect(await converterStrategyBase.isReadyToHardWork()).eq(platform === PLATFORM_KYBER || platform === PLATFORM_PANCAKE);
                });
                /** scb-776: isReadyToHardWork can return true just after hardwork call */
                it.skip("isReadyToHardWork should return expected value after hardwork", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(
                    b.strategy.address,
                    await Misc.impersonate(b.splitter.address)
                  );
                  const platform = await converterStrategyBase.PLATFORM();
                  await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

                  expect(await converterStrategyBase.isReadyToHardWork()).eq(true);
                  await converterStrategyBase.doHardWork({gasLimit: GAS_LIMIT});
                  // currently kyber's isReadyToHardWork returns true without need to call prepareToHardwork
                  expect(await converterStrategyBase.isReadyToHardWork()).eq(platform === PLATFORM_KYBER || platform === PLATFORM_PANCAKE);
                });

                it("withdraw should not exceed gas limits @skip-on-coverage", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const tx = await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  const cr = await tx.wait();
                  controlGasLimitsEx(cr.gasUsed, GAS_LIMIT_PAIR_BASED_WITHDRAW, (u, t) => {
                    expect(u).to.be.below(t + 1);
                  });
                });
              });
              describe("Fuse ON, need-rebalance off", () => {
                let snapshotLevel1: string;
                let snapshotLevel1Each: string;
                before(async function () {
                  snapshotLevel1 = await TimeUtils.snapshot();
                  await prepareStrategy();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel1);
                });
                beforeEach(async function () {
                  snapshotLevel1Each = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotLevel1Each);
                });

                async function prepareStrategy() {
                  // activate fuse
                  await PairBasedStrategyPrepareStateUtils.prepareFuse(b, true);

                  // make rebalance to update fuse status
                  expect(await b.strategy.needRebalance()).eq(true);
                  console.log('rebalance...');
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT});
                  expect(await b.strategy.needRebalance()).eq(false);

                  return b;
                }

                it("should deposit on balance, don't deposit to pool", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
                  expect(stateAfter.strategy.liquidity).eq(stateBefore.strategy.liquidity);
                });
                it("should withdraw successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 300);
                });
                it("should withdraw-all successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await b.vault.connect(signer).withdrawAll({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
                  expect(stateBefore.vault.userShares).gt(0);
                  expect(stateAfter.vault.userShares).eq(0);
                });
                it("should revert on rebalance", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  const needRebalanceBefore = await b.strategy.needRebalance();
                  expect(needRebalanceBefore).eq(false);

                  const platform = await converterStrategyBase.PLATFORM();
                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-9 No rebalance needed");

                  await expect(
                    b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage); // NO_REBALANCE_NEEDED
                });
                it("should rebalance debts successfully but dont enter to the pool", async () => {
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
                    {gasLimit: GAS_LIMIT}
                  );
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.strategy.liquidity).lt(10);
                });
                it("should revert on hardwork", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(
                    b.strategy.address,
                    await Misc.impersonate(b.splitter.address)
                  );

                  // put additional fee to profit holder bo make isReadyToHardwork returns true
                  await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

                  const platform = await converterStrategyBase.PLATFORM();
                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-14 Fuse is active");

                  await expect(
                    converterStrategyBase.doHardWork({gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage);
                });
                it("should make emergency exit successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await converterStrategyBase.emergencyExit({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.strategy.liquidity).lt(10);
                });
                it("isReadyToHardWork should return false even if hardwork is really necessary", async () => {
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
              describe("Fuse off, need-rebalance ON", () => {
                let snapshotLevel1: string;
                let snapshotLevel1Each: string;
                before(async function () {
                  snapshotLevel1 = await TimeUtils.snapshot();
                  await prepareStrategy();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel1);
                });
                beforeEach(async function () {
                  snapshotLevel1Each = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotLevel1Each);
                });

                async function prepareStrategy() {
                  await PairBasedStrategyPrepareStateUtils.prepareNeedRebalanceOn(signer, signer2, b,
                    undefined,
                    strategyInfo.name !== PLATFORM_ALGEBRA
                  );
                }

                it("rebalance is required", async () => {
                  expect(await b.strategy.needRebalance()).eq(true);
                });
                it("should revert on deposit", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                  const platform = await converterStrategyBase.PLATFORM();

                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-1 Need rebalance");
                  await expect(
                    b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage);
                });
                it("should revert on withdraw", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                  const platform = await converterStrategyBase.PLATFORM();

                  const needRebalanceBefore = await b.strategy.needRebalance();
                  expect(needRebalanceBefore).eq(true);

                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-1 Need rebalance");
                  await expect(
                    b.vault.connect(signer).withdraw(parseUnits('300', 6), signer.address, signer.address, {gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage);
                });
                it("should revert on withdraw-all", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                  const platform = await converterStrategyBase.PLATFORM();

                  const needRebalanceBefore = await b.strategy.needRebalance();
                  expect(needRebalanceBefore).eq(true);

                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-1 Need rebalance");
                  await expect(
                    b.vault.connect(signer).withdrawAll({gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage);
                });
                it("should revert on rebalance", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const needRebalanceBefore = await b.strategy.needRebalance();
                  expect(needRebalanceBefore).eq(true);

                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT});
                  expect(await b.strategy.needRebalance()).eq(false);
                });
                it("should rebalance debts successfully but dont enter to the pool", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const planEntryData = defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY_0, 0]);
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
                    {gasLimit: GAS_LIMIT}
                  );
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  console.log("stateAfter", stateAfter);

                  expect(
                    stateAfter.strategy.liquidity < stateBefore.strategy.liquidity
                    || stateAfter.strategy.liquidity === 0
                  ).eq(true);
                });
                it("should revert on hardwork", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(
                    b.strategy.address,
                    await Misc.impersonate(b.splitter.address)
                  );

                  // put additional fee to profit holder bo make isReadyToHardwork returns true
                  await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

                  const platform = await converterStrategyBase.PLATFORM();
                  const expectedErrorMessage = PlatformUtils.getErrorMessage(platform, "-1 Need rebalance");

                  await expect(
                    converterStrategyBase.doHardWork({gasLimit: GAS_LIMIT})
                  ).revertedWith(expectedErrorMessage);
                });
                it("should make emergency exit successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await converterStrategyBase.emergencyExit({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.strategy.liquidity).lt(10);
                });
                it("isReadyToHardWork should return false even if hardwork is really necessary", async () => {
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

              describe("SCB-791: withdraw almost-all shouldn't change share prices", () => {
                const PRECISION = 2e-6;
                let snapshotLevel1: string;
                let snapshotLevel1Each: string;
                let state: IDefaultState;

                before(async function () {
                  snapshotLevel1 = await TimeUtils.snapshot();
                  await prepareStrategy();
                  state = await PackedData.getDefaultState(b.strategy);
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel1);
                });
                beforeEach(async function () {
                  snapshotLevel1Each = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotLevel1Each);
                });

                let amountToWithdraw: BigNumber;

                async function prepareStrategy() {
                  await b.vault.connect(b.gov).setFees(0, 0);

                  console.log('deposit...');
                  await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
                  await TokenUtils.getToken(b.asset, signer.address, parseUnits('35000', 6));
                  await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: GAS_LIMIT});

                  amountToWithdraw = (await b.vault.maxWithdraw(signer.address)).sub(parseUnits("1", 6));

                  await PairBasedStrategyPrepareStateUtils.prepareInsurance(b, "1000");

                  if (strategyInfo.tag === "movePricesUpBeforeWithdraw") {
                    const state = await PackedData.getDefaultState(b.strategy);
                    await UniversalUtils.movePoolPriceUp(signer, state, b.swapper, parseUnits("12000", 6));
                  }
                }

                it("should withdraw almost all successfully, use standard swapper", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  console.log("stateBefore", stateBefore);
                  console.log("stateAfter", stateAfter);

                  expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, PRECISION);
                });

                it("should withdraw almost all successfully, mocked swapper returns higher amount  for any swap", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                  const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
                    converter: b.converter.address,
                    token0: state.tokenA,
                    token1: state.tokenB,
                    increaseOutput: true
                  });

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, mockedSwapper.address);
                  await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, b.swapper);
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, PRECISION);
                });

                it("should withdraw almost all successfully, mocked swapper returns smaller amount for any swap", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
                    converter: b.converter.address,
                    token0: state.tokenA,
                    token1: state.tokenB,
                    increaseOutput: false
                  });

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, mockedSwapper.address);
                  await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, b.swapper);
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, PRECISION);
                });

                it("should withdraw almost all successfully, token0=>token1 swap amount higher, token0=>token1 swap amount lower", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
                    converter: b.converter.address,
                    token0: state.tokenA,
                    token1: state.tokenB,
                    increaseOutput: true,
                    reverseDirections: true,
                  });

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, mockedSwapper.address);
                  await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, b.swapper);
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, PRECISION);
                });

                it("should withdraw almost all successfully, token0=>token1 swap amount lower, token0=>token1 swap amount higher", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const mockedSwapper = await MockAggregatorUtils.createMockSwapper(signer, {
                    converter: b.converter.address,
                    token0: state.tokenA,
                    token1: state.tokenB,
                    increaseOutput: false,
                    reverseDirections: true,
                  });

                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, mockedSwapper.address);
                  await b.vault.connect(signer).withdraw(amountToWithdraw, signer.address, signer.address, {gasLimit: GAS_LIMIT});
                  await MockAggregatorUtils.injectSwapperToLiquidator(PlatformUtils.getTetuLiquidator(chainId), b, b.swapper);
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, PRECISION);
                });
              });
              describe("Emergency exit", () => {
                it("user should be able to withdraw all liquidity after emergency exit", async () => {
                  const pathOut = `./tmp/${strategyInfo.name}-emergency-exit.csv`;
                  const states: IStateNum[] = [];
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  const maxWithdraw = +formatUnits(
                    await b.vault.connect(signer).maxWithdraw(signer.address),
                    b.assetDecimals
                  );

                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "init"));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  console.log("========= Emergency exit start ==========")
                  await converterStrategyBase.emergencyExit();

                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "ee"));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  console.log("========= Withdraw all ==========")
                  await b.vault.connect(signer).withdrawAll({gasLimit: GAS_LIMIT});

                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "final"));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  const initialUserBalance = states[0].user.assetBalance;
                  expect(states[states.length - 1].user.assetBalance).approximately(initialUserBalance + maxWithdraw, 0.1);
                });
              });
            });
            describe("State: empty strategy", () => {
              describe("No deposits", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                it("isReadyToHardWork should return expected values", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(
                    b.strategy.address,
                    await Misc.impersonate(b.splitter.address)
                  );
                  const platform = await converterStrategyBase.PLATFORM();

                  // currently kyber's isReadyToHardWork returns true without need to call prepareToHardwork
                  expect(await converterStrategyBase.isReadyToHardWork()).eq(
                    platform === PLATFORM_KYBER
                    || platform === PLATFORM_PANCAKE
                  );
                });
              });
              describe("Empty strategy with need-rebalance ON", () => {
                let snapshotLevel1: string;
                let snapshotLevel1Each: string;
                before(async function () {
                  snapshotLevel1 = await TimeUtils.snapshot();
                  await prepareStrategy();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel1);
                });
                beforeEach(async function () {
                  snapshotLevel1Each = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotLevel1Each);
                });
                /**
                 * Make deposit.
                 * Change thresholds and set fuse ON
                 * Withdraw all
                 * Change thresholds and set fuse OFF => need rebalance = true
                 * Make rebalance of the empty strategy.
                 */
                async function prepareStrategy() {
                  const states: IStateNum[] = [];
                  const pathOut = "./tmp/prepareStrategy.csv";

                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `init`));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  // make deposit
                  await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
                  await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
                  await b.vault.connect(signer).deposit(parseUnits('1000', 6), signer.address, {gasLimit: GAS_LIMIT});

                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `deposit`));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  // set fuse ON
                  await PairBasedStrategyPrepareStateUtils.prepareFuse(b, true);
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fuse-on`));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT});
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `rebalance`));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  // withdraw all liquidity from the strategy
                  await b.vault.connect(signer).withdrawAll({gasLimit: GAS_LIMIT});
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `withdraw`));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `fuse-off`));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                }

                it("should make rebalance successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                  const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(await b.strategy.needRebalance()).eq(true);
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT});
                  expect(await b.strategy.needRebalance()).eq(false);
                });
                it("should not revert on rebalance debts", async () => {
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
                    {gasLimit: GAS_LIMIT}
                  );
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.strategy.investedAssets).approximately(stateBefore.strategy.investedAssets, 100);
                });
                it("should make emergency exit successfully", async () => {
                  const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                  await converterStrategyBase.emergencyExit({gasLimit: GAS_LIMIT});
                  const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                  expect(stateAfter.strategy.liquidity).lt(10);
                });
              });
            });
            describe("State: large user has just exit the strategy", () => {
              let snapshotLevel1: string;
              let snapshotLevel1Each: string;
              before(async function () {
                snapshotLevel1 = await TimeUtils.snapshot();
                await prepareStrategy();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLevel1);
              });
              beforeEach(async function () {
                snapshotLevel1Each = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshotLevel1Each);
              });

              /**
               * Initially signer deposits 100 USDC, also he has additional 100 USDC on the balance.
               * Another big user enters to the strategy. Prices are changed, rebalances are made.
               * Big user exits the strategy.
               */
              async function prepareStrategy(): Promise<IBuilderResults> {
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                const states: IStateNum[] = [];
                const pathOut = "./tmp/large-user-prepare-strategy.csv";

                const state = await PackedData.getDefaultState(b.strategy);
                await UniversalUtils.makePoolVolume(signer2, state, b.swapper, parseUnits("50000", 6));

                console.log('Small user deposit...');
                await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
                await TokenUtils.getToken(b.asset, signer.address, parseUnits('200', 6));
                await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: GAS_LIMIT});
                states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "d0"));
                await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                console.log('Big user deposit...');
                const largeAmountToDeposit = strategyInfo.name === PLATFORM_PANCAKE
                  ? parseUnits('20000', 6) // avoid !PRICE 99970
                  : parseUnits('50000', 6);

                await IERC20__factory.connect(b.asset, signer2).approve(b.vault.address, Misc.MAX_UINT);
                await TokenUtils.getToken(b.asset, signer2.address, parseUnits('100000', 6));
                await b.vault.connect(signer2).deposit(largeAmountToDeposit, signer2.address, {gasLimit: GAS_LIMIT});
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
                  strategyInfo.name === PLATFORM_ALGEBRA
                    ? SWAP_AMOUNT_ALGEBRA
                    : SWAP_AMOUNT_DEFAULT
                );
                await UniversalUtils.movePoolPriceUp(signer2, state, b.swapper, swapAmount, 40000);
                states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "p"));
                await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                console.log('Rebalance debts...');
                // rebalance debts
                await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
                  b.strategy.connect(await UniversalTestUtils.getAnOperator(b.strategy.address, signer)),
                  Misc.ZERO_ADDRESS,
                  false,
                  () => true
                );
                states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "unfold"));
                await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                if (await b.strategy.needRebalance()) {
                  console.log('Rebalance...');
                  await b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT});
                }

                console.log('Withdraw...');
                let done = false;
                while (! done) {
                  const amountToWithdraw = await b.vault.maxWithdraw(signer2.address);
                  const portion = parseUnits('5000', 6);
                  if (portion.lt(amountToWithdraw)) {
                    console.log("withdraw...", portion);
                    await b.vault.connect(signer2).withdraw(portion, signer2.address, signer2.address, {gasLimit: GAS_LIMIT});
                  } else {
                    console.log("withdraw all...", amountToWithdraw);
                    await b.vault.connect(signer2).withdrawAll({gasLimit: GAS_LIMIT});
                    done = true;
                  }
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "w"));
                  await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                  if (await b.strategy.needRebalance()) { // for kyber
                    console.log("rebalance");
                    await b.strategy.rebalanceNoSwaps(true, {gasLimit: GAS_LIMIT});
                    states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "r"));
                    await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                  }
                }

                return b;
              }

              it("rebalance should not be required", async () => {
                expect(await b.strategy.needRebalance()).eq(false);
              });
              it("small user should deposit successfully", async () => {
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await b.vault.connect(signer).deposit(parseUnits('100', 6), signer.address, {gasLimit: GAS_LIMIT});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                expect(stateAfter.vault.totalAssets).gt(stateBefore.vault.totalAssets);
              });
              it("small user should withdraw successfully", async () => {
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await b.vault.connect(signer).withdraw(parseUnits('30', 6), signer.address, signer.address, {gasLimit: GAS_LIMIT});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                expect(stateAfter.user.assetBalance).eq(stateBefore.user.assetBalance + 30);
              });
              it("small user should withdraw-all successfully", async () => {
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await b.vault.connect(signer).withdrawAll({gasLimit: GAS_LIMIT});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                console.log("stateBefore", stateBefore);
                console.log("stateAfter", stateAfter);

                expect(stateAfter.user.assetBalance).gt(stateBefore.user.assetBalance);
                expect(stateBefore.strategy.assetBalance).gt(0);
                expect(stateAfter.strategy.assetBalance).lt(0.1);
              });
              it("should rebalance debts successfully", async () => {
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
                  {gasLimit: GAS_LIMIT}
                );
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                expect(stateAfter.strategy.investedAssets).approximately(stateBefore.strategy.investedAssets, 100);
              });
              it("should hardwork successfully", async () => {
                const converterStrategyBase = ConverterStrategyBase__factory.connect(
                  b.strategy.address,
                  await Misc.impersonate(b.splitter.address)
                );

                // put additional fee to profit holder bo make isReadyToHardwork returns true
                await PairBasedStrategyPrepareStateUtils.prepareToHardwork(signer, b.strategy);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await converterStrategyBase.doHardWork({gasLimit: GAS_LIMIT});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                console.log("stateBefore", stateBefore);
                console.log("stateAfter", stateAfter);
                expect(stateAfter.strategy.investedAssets + stateAfter.strategy.assetBalance).gt(
                  stateBefore.strategy.investedAssets + stateBefore.strategy.assetBalance
                );
              });
              it("should make emergency exit successfully", async () => {
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

                const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);
                await converterStrategyBase.emergencyExit({gasLimit: GAS_LIMIT});
                const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault);

                expect(stateAfter.strategy.liquidity).lt(10);
              });
            });
          });
          }
        });
      });

      describe("Loop with rebalance, hardwork, deposit and withdraw with various compound rates", () => {
        interface IStrategyInfo {
          chainId: number;
          name: string,
          notUnderlyingToken: string;
          compoundRatio: number;
        }

        const strategies: IStrategyInfo[] = [
          {chainId: BASE_NETWORK_ID, name: PLATFORM_PANCAKE, notUnderlyingToken: BaseAddresses.USDbC_TOKEN, compoundRatio: 0},

          {chainId: POLYGON_NETWORK_ID, name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 50_000},
          {chainId: POLYGON_NETWORK_ID, name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 50_000},
          {chainId: POLYGON_NETWORK_ID, name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 0},

          {chainId: POLYGON_NETWORK_ID, name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 0},
          // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 10_000},
          // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 100_000},

          // {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 0}, // todo movePriceBySteps cannot change prices

          // {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN, compoundRatio: 50_000}, // todo movePriceBySteps cannot change prices

          // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WMATIC_TOKEN, compoundRatio: 50_000}, // todo npm coverage produces SB too high
          // {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.WETH_TOKEN, compoundRatio: 50_000}, // todo movePriceBySteps cannot change prices
        ];

        strategies.forEach(function (strategyInfo: IStrategyInfo) {
          if (chainId === strategyInfo.chainId) {
            async function prepareStrategy(): Promise<IBuilderResults> {
              const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
                strategyInfo.chainId,
                strategyInfo.name,
                signer,
                signer2,
                {
                  notUnderlying: strategyInfo.notUnderlyingToken,
                  customParams: {
                    depositFee: 0,
                    withdrawFee: 300,
                    compoundRatio: strategyInfo.compoundRatio,
                    buffer: 0
                  }
                }
              );
              await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(
                signer,
                b.strategy.address,
                "0.00001" // we need very small amount to avoid increasing of share price on hardwork
              );

              await PairBasedStrategyPrepareStateUtils.prepareInsurance(b);

              await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
              await IERC20__factory.connect(b.asset, signer3).approve(b.vault.address, Misc.MAX_UINT);
              await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
              await TokenUtils.getToken(b.asset, signer3.address, parseUnits('2000', 6));

              const investAmount = parseUnits("1000", 6);
              console.log('initial deposits...');
              await b.vault.connect(signer).deposit(investAmount, signer.address, {gasLimit: GAS_LIMIT});
              await b.vault.connect(signer3).deposit(investAmount, signer3.address, {gasLimit: GAS_LIMIT});

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

                const operator = await UniversalTestUtils.getAnOperator(b.strategy.address, signer);
                const reader = await MockHelper.createPairBasedStrategyReader(signer);

                // Following amount is used as swapAmount for both tokens A and B...
                const swapAssetValueForPriceMove = parseUnits('300000', 6);
                // ... but WMATIC has different decimals than USDC, so we should use different swapAmount in that case
                const swapAssetValueForPriceMoveDown = strategyInfo.name === PLATFORM_UNIV3
                && strategyInfo.notUnderlyingToken === MaticAddresses.WMATIC_TOKEN
                  ? parseUnits('300000', 18)
                  : undefined;

                const state = await PackedData.getDefaultState(b.strategy);
                console.log("state", state);
                const price = await ISwapper__factory.connect(b.swapper, signer).getPrice(state.pool, state.tokenB, Misc.ZERO_ADDRESS, 0);
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
                      swapAssetValueForPriceMove,
                      swapAssetValueForPriceMoveDown,
                      3
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
                      PlatformUtils.getTetuLiquidator(chainId),
                      true,
                      () => true,
                      async (stateTitle, eventsSet): Promise<IStateNum> => {
                        states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, stateTitle, {eventsSet}));
                        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                        return states[states.length - 1];
                      }
                    );
                  }

                  if (i % 5) {
                    console.log('Hardwork..')
                    const eventsSet = await CaptureEvents.makeHardworkInSplitter(converterStrategyBase, operator);
                    states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `h${i}`, {eventsSet}));
                    StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                  }

                  if (i % 2) {
                    console.log('Withdraw..');
                    const toWithdraw = parseUnits('100.111437', 6)
                    const balBefore = await TokenUtils.balanceOf(state.tokenA, signer3.address)
                    await b.vault.connect(signer3).requestWithdraw()

                    const eventsSet = await CaptureEvents.makeWithdraw(b.vault.connect(signer3), toWithdraw, platform);
                    const balAfter = await TokenUtils.balanceOf(state.tokenA, signer3.address)
                    console.log(`To withdraw: ${toWithdraw.toString()}. Withdrawn: ${balAfter.sub(balBefore).toString()}`)
                    states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `w${i}`, {eventsSet}));
                    StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                  } else {
                    console.log('Deposit..')
                    const eventsSet = await CaptureEvents.makeDeposit(b.vault.connect(signer3), parseUnits('100.496467', 6), platform);
                    states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `d${i}`, {eventsSet}));
                    StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                  }

                  const readerResults = await reader.getLockedUnderlyingAmount(b.strategy.address);
                  const locketAmount = +formatUnits(readerResults.estimatedUnderlyingAmount, b.assetDecimals);
                  const totalAsset = +formatUnits(readerResults.totalAssets, b.assetDecimals);
                  const lockedPercent = 100 * locketAmount / totalAsset;
                  console.log(`locketAmount=${locketAmount} totalAsset=${totalAsset} lockedPercent=${lockedPercent}`);
                  if (lockedPercent > maxLockedPercent) {
                    console.log("Rebalance debts");
                    const planEntryData = buildEntryData1();
                    const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);
                    const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
                      b.strategy,
                      quote.tokenToSwap,
                      Misc.ZERO_ADDRESS,
                      quote.amountToSwap,
                      "0x",
                      planEntryData,
                      ENTRY_TO_POOL_IS_ALLOWED
                    );
                    states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `wba${i}`, {eventsSet}));
                    StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
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

                if (await b.strategy.needRebalance()) {
                  console.log('Rebalance..')
                  const eventsSet = await CaptureEvents.makeRebalanceNoSwap(b.strategy);
                  states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `r-all`, {eventsSet}));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                }

                console.log('withdrawAll as signer...');
                await b.vault.connect(signer).requestWithdraw();
                const eventsSet1 = await CaptureEvents.makeWithdrawAll(b.vault.connect(signer), platform);
                states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, `w-all-s1`, {eventsSet: eventsSet1}));
                StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

                // shouldn't revert up to the end
              });
            });
          }
        });
      });

      describe("Check invariants on loops", () => {
        const COUNT_CYCLES = 20;
        const maxLockedPercent = 15;
        const WITHDRAW_FEE = 300;
        /** Currently withdraw-fee is used as priceChangeTolerance for security reasons */
        const PRICE_CHANGE_TOLERANCE = WITHDRAW_FEE;

        interface IStrategyInfo {
          chainId: number;
          caseTag: string;
          name: string,
          notUnderlyingToken: string;
          compoundRatio: number;
          initialAmountOnSignerBalance: string;
          investAmount: string;
          initialInsuranceBalance: string;
          initialAmountOnSignerBalanceUser?: string; // by default initialAmountOnSignerBalance
          investAmountSignerUser?: string; // by default investAmount
          initialLastDirectionUp?: boolean; // false by default
          countBlocksToAdvance: number; // 2000 by default
          percentToWithdraw?: number; // 6 by default
          percentToDeposit?: number; // 6 by default
          dontChangePrices?: boolean; // false by default
        }

        const strategies: IStrategyInfo[] = [
          { // large total assets, enough insurance to cover any losses, small withdraw/deposits, don't change prices
            chainId: POLYGON_NETWORK_ID,
            caseTag: "case1",
            name: PLATFORM_UNIV3,
            notUnderlyingToken: MaticAddresses.USDT_TOKEN,
            compoundRatio: 0,
            initialAmountOnSignerBalance: "80000",
            investAmount: "50000",
            initialInsuranceBalance: "1000",
            initialLastDirectionUp: false,
            countBlocksToAdvance: 15000,
            dontChangePrices: true
          },
          // { // large total assets, enough insurance to cover any losses, small withdraw/deposits, change prices
          //   chainId: POLYGON_NETWORK_ID,
          //   caseTag: "case6",
          //   name: PLATFORM_UNIV3,
          //   notUnderlyingToken: MaticAddresses.USDT_TOKEN,
          //   compoundRatio: 80_000,
          //   initialAmountOnSignerBalance: "8000",
          //   investAmount: "5000",
          //   initialInsuranceBalance: "1000",
          //   initialLastDirectionUp: false,
          //   countBlocksToAdvance: 10000,
          //   dontChangePrices: false
          // },
          // { // large total assets, enough insurance to cover any losses, small withdraw/deposits, change prices
          //   chainId: POLYGON_NETWORK_ID,
          //   caseTag: "case5",
          //   name: PLATFORM_UNIV3,
          //   notUnderlyingToken: MaticAddresses.USDT_TOKEN,
          //   compoundRatio: 50_000,
          //   initialAmountOnSignerBalance: "8000",
          //   investAmount: "5000",
          //   initialInsuranceBalance: "1000",
          //   initialLastDirectionUp: true,
          //   countBlocksToAdvance: 10000,
          //   dontChangePrices: false
          // },
          // { // large total assets, enough insurance to cover any losses, small withdraw/deposits, change prices
          //   chainId: POLYGON_NETWORK_ID,
          //   caseTag: "case4",
          //   name: PLATFORM_UNIV3,
          //   notUnderlyingToken: MaticAddresses.USDT_TOKEN,
          //   compoundRatio: 0,
          //   initialAmountOnSignerBalance: "80000",
          //   investAmount: "50000",
          //   initialInsuranceBalance: "1000",
          //   initialLastDirectionUp: false,
          //   countBlocksToAdvance: 10000,
          //   dontChangePrices: false
          // },
          // { // not enough insurance, small user, don't change prices
          //   chainId: POLYGON_NETWORK_ID,
          //   caseTag: "case2",
          //   name: PLATFORM_UNIV3,
          //   notUnderlyingToken: MaticAddresses.USDT_TOKEN,
          //   compoundRatio: 0,
          //   initialAmountOnSignerBalance: "8000",
          //   investAmount: "5000",
          //   initialAmountOnSignerBalanceUser: "2000",
          //   investAmountSignerUser: "1000",
          //   initialInsuranceBalance: "0",
          //   initialLastDirectionUp: false,
          //   countBlocksToAdvance: 7000,
          //   percentToWithdraw: 10,
          //   percentToDeposit: 80,
          //   dontChangePrices: true
          // },
          // { // not enough insurance, large user, change prices
          //   chainId: POLYGON_NETWORK_ID,
          //   caseTag: "case3",
          //   name: PLATFORM_UNIV3,
          //   notUnderlyingToken: MaticAddresses.USDT_TOKEN,
          //   compoundRatio: 0,
          //   initialAmountOnSignerBalance: "2000",
          //   investAmount: "1000",
          //   initialAmountOnSignerBalanceUser: "80000",
          //   investAmountSignerUser: "50000",
          //   initialInsuranceBalance: "0",
          //   initialLastDirectionUp: false,
          //   countBlocksToAdvance: 7000,
          //   percentToWithdraw: 10,
          //   percentToDeposit: 80,
          //   dontChangePrices: true
          // },
        ];

        strategies.forEach(function (strategyInfo: IStrategyInfo) {
          if (chainId === strategyInfo.chainId) {
            async function prepareStrategy(): Promise<IBuilderResults> {
              const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
                strategyInfo.chainId,
                strategyInfo.name,
                signer,
                signer2,
                {
                  notUnderlying: strategyInfo.notUnderlyingToken,
                  customParams: {
                    depositFee: 0,
                    withdrawFee: WITHDRAW_FEE,
                    compoundRatio: strategyInfo.compoundRatio,
                    buffer: 0
                  }
                }
              );

              // we need very small thresholds to avoid increasing of share price on hardwork
              await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(signer, b.strategy.address, "0.00001");

              await PairBasedStrategyPrepareStateUtils.prepareInsurance(b, strategyInfo.initialInsuranceBalance);

              await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
              await IERC20__factory.connect(b.asset, signer3).approve(b.vault.address, Misc.MAX_UINT);
              await TokenUtils.getToken(b.asset, signer.address, parseUnits(strategyInfo.initialAmountOnSignerBalance, 6));
              await TokenUtils.getToken(b.asset, signer3.address, parseUnits(strategyInfo.initialAmountOnSignerBalanceUser ?? strategyInfo.initialAmountOnSignerBalance, 6));

              return b;
            }

            describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}-${strategyInfo.caseTag}`, () => {
              let snapshot: string;

              interface IResults {
                ret: IStateNum[];
                totalWithdrawFee: number;
                totalWithdraw: number;
                totalDeposit: number;
              }

              before(async function () {
                snapshot = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot);
              });

              interface IAdditionalParams {
                deposit?: number;
                withdraw?: number;
                withdrawFee?: number;
              }

              async function makeCalculations(): Promise<IResults> {
                const b = await loadFixture(prepareStrategy);
                const states: IStateNum[] = [];
                const user = signer3;
                const statesParams = b.stateParams;
                statesParams.additionalParams = ["Deposit", "Withdraw", "Withdraw fee",];
                let totalWithdrawFee = 0;
                let totalWithdraw = 0;
                let totalDeposit = 0;

                const saver = async (title: string, eventsSet?: IEventsSet, ap?: IAdditionalParams): Promise<IStateNum> => {
                  states.push(await StateUtilsNum.getState(signer, user, converterStrategyBase, b.vault, title, {
                    eventsSet,
                    additionalParamValues: [
                      ap?.deposit ?? 0,
                      ap?.withdraw ?? 0,
                      ap?.withdrawFee ?? 0,
                    ]
                  }));
                  StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
                  return states[states.length - 1];
                }
                const pathOut = `./tmp/event-invariants-${strategyInfo.name}-${strategyInfo.caseTag}.csv`;

                const operator = await UniversalTestUtils.getAnOperator(b.strategy.address, signer);
                const reader = await MockHelper.createPairBasedStrategyReader(signer);

                // Following amount is used as swapAmount for both tokens A and B...
                const swapAssetValueForPriceMove = parseUnits('300000', 6);
                const state = await PackedData.getDefaultState(b.strategy);

                const splitterSigner = await DeployerUtilsLocal.impersonate(await b.splitter.address);
                const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
                const platform = await converterStrategyBase.PLATFORM();

                await saver("init");

                console.log('initial deposits...');
                await saver(`ds`, await CaptureEvents.makeDeposit(b.vault.connect(signer), parseUnits(strategyInfo.investAmount, 6), platform));
                await saver(`ds3`, await CaptureEvents.makeDeposit(b.vault.connect(signer3), parseUnits(strategyInfo.investAmountSignerUser ?? strategyInfo.investAmount, 6), platform));

                let lastDirectionUp = strategyInfo.initialLastDirectionUp;
                for (let i = 0; i < COUNT_CYCLES; i++) {
                  console.log(`==================== CYCLE ${i} ====================`);
                  if (i % 1) { // provide some rewards
                    await UniversalUtils.makePoolVolume(signer2, state, b.swapper, parseUnits('100000', 6));
                    await TimeUtils.advanceNBlocks(strategyInfo.countBlocksToAdvance ?? 2000);
                  }

                  if (i % 3 && !strategyInfo.dontChangePrices) {
                    const movePricesUp = !lastDirectionUp;
                    console.log(`Change prices.. ==================== ${i} ==================== ${movePricesUp ? "up" : "down"}`);
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
                      swapAssetValueForPriceMove,
                      5
                    );
                    lastDirectionUp = !lastDirectionUp;
                    await saver(`p${i}`);
                  }

                  if (await b.strategy.needRebalance()) {
                    console.log(`Rebalance.. ==================== ${i} ====================`)
                    await saver(`r${i}`, await CaptureEvents.makeRebalanceNoSwap(b.strategy));
                  }

                  // let's give some time to increase the debts
                  await TimeUtils.advanceNBlocks(strategyInfo.countBlocksToAdvance ?? 2000);

                  if (i % 5) {
                    console.log(`Hardwork.. ==================== ${i} ==================== `)
                    await saver(`h${i}`, await CaptureEvents.makeHardworkInSplitter(converterStrategyBase, operator));
                  }

                  // let's give some time to increase the debts
                  await TimeUtils.advanceNBlocks(strategyInfo.countBlocksToAdvance ?? 2000);

                  if (i % 3) {
                    const maxWithdraw = await b.vault.maxWithdraw(user.address);
                    const toWithdraw = maxWithdraw.mul(i % 4 ? (strategyInfo.percentToWithdraw ?? 1) : 1).div(100);
                    const lastWithdrawFee = +formatUnits(toWithdraw, b.assetDecimals) * (100_000 / (100_000 - PRICE_CHANGE_TOLERANCE) - 1);
                    totalWithdrawFee += lastWithdrawFee;
                    totalWithdraw += +formatUnits(toWithdraw, b.assetDecimals);
                    console.log(`Withdraw.. ==================== ${i} ==================== max=${maxWithdraw} to=${toWithdraw}`);
                    await saver(`w${i}`, await CaptureEvents.makeWithdraw(b.vault.connect(user), toWithdraw, platform), {
                      withdraw: +formatUnits(toWithdraw, b.assetDecimals),
                      withdrawFee: lastWithdrawFee
                    });
                  } else {
                    const maxDeposit = await IERC20Metadata__factory.connect(b.asset, signer).balanceOf(user.address);
                    const toDeposit = maxDeposit.mul(i % 5 ? 3 : (strategyInfo.percentToDeposit ?? 2)).div(100);
                    totalDeposit += +formatUnits(toDeposit, b.assetDecimals);
                    console.log(`Deposit.. ==================== ${i} ==================== max=${maxDeposit} to=${toDeposit}`);
                    await saver(`d${i}`, await CaptureEvents.makeDeposit(b.vault.connect(user), toDeposit, platform), {
                      deposit: +formatUnits(toDeposit, b.assetDecimals)
                    });
                  }

                  { // withdraw by agg
                    const readerResults = await reader.getLockedUnderlyingAmount(b.strategy.address);
                    const locketAmount = +formatUnits(readerResults.estimatedUnderlyingAmount, b.assetDecimals);
                    const totalAsset = +formatUnits(readerResults.totalAssets, b.assetDecimals);
                    const lockedPercent = 100 * locketAmount / totalAsset;
                    console.log(`locketAmount=${locketAmount} totalAsset=${totalAsset} lockedPercent=${lockedPercent}`);
                    if (lockedPercent > maxLockedPercent) {
                      console.log(`Rebalance debts.. ==================== ${i} ====================`);
                      const planEntryData = buildEntryData1();
                      const quote = await b.strategy.callStatic.quoteWithdrawByAgg(planEntryData);
                      await saver(`wba${i}`, await CaptureEvents.makeWithdrawByAggStep(
                        b.strategy,
                        quote.tokenToSwap,
                        Misc.ZERO_ADDRESS,
                        quote.amountToSwap,
                        "0x",
                        planEntryData,
                        ENTRY_TO_POOL_IS_ALLOWED
                      ));
                    }
                  }
                }

                {
                  console.log(`Withdraw all as signer3 ==========================================`)
                  const maxWithdraw = await b.vault.maxWithdraw(user.address);

                  await b.vault.connect(signer3).requestWithdraw();
                  const eventsSet3 = await CaptureEvents.makeWithdrawAll(b.vault.connect(user), platform);
                  await saver("w-all", eventsSet3, {
                    withdraw: +formatUnits(maxWithdraw, b.assetDecimals),
                    withdrawFee: +formatUnits(maxWithdraw, b.assetDecimals) * (100_000 / (100_000 - PRICE_CHANGE_TOLERANCE) - 1)
                  });
                }

                return {
                  ret: states,
                  totalDeposit,
                  totalWithdraw,
                  totalWithdrawFee
                };
              }

              it('should change insurance in expected values', async () => {
                const {ret} = await loadFixture(makeCalculations);
                const first = ret[0];
                const last = ret[ret.length - 1];

                // Delta insurance = totalWithdrawFee + sendToInsurance + debtPaid + toInsuranceRecycle - lossCovered
                const deltaInsurance = last.insurance.assetBalance - first.insurance.assetBalance;
                const sendToInsurance = ret.reduce((prev, cur) => prev + (cur.events?.sentToInsurance ?? 0), 0);
                const debtPaid = ret.reduce((prev, cur) => prev + (cur.events?.payDebtToInsurance.debtPaid ?? 0), 0);
                const toInsuranceRecycle = ret.reduce((prev, cur) => prev + (cur.events?.toInsuranceRecycle ?? 0), 0);
                const lossCovered = ret.reduce((prev, cur) => prev + (cur.events?.lossCoveredVault ?? 0), 0);
                const totalWithdrawFee = ret.reduce((prev, cur) => prev + (cur.events?.feeTransferVault ?? 0), 0);
                console.log("deltaInsurance", deltaInsurance);
                console.log("sendToInsurance", sendToInsurance);
                console.log("debtPaid", debtPaid);
                console.log("toInsuranceRecycle", toInsuranceRecycle);
                console.log("lossCovered", lossCovered);
                console.log("totalWithdrawFee", totalWithdrawFee);

                // withdraw fees give errors
                expect(deltaInsurance).approximately(totalWithdrawFee + sendToInsurance + debtPaid + toInsuranceRecycle - lossCovered, 0.1);
              });
              it('should set debt to insurance to expected value', async () => {
                const {ret, totalWithdrawFee, totalWithdraw, totalDeposit} = await loadFixture(makeCalculations);
                const last = ret[ret.length - 1];

                // Debt to insurance = OnCoverLossInc - debtPaid + debtToInsuranceOnProfitInc
                const coverLossInc = ret.reduce((prev, cur) => prev + (cur.events?.onCoverLoss.debtToInsuranceInc ?? 0), 0);
                const debtPaid = ret.reduce((prev, cur) => prev + (cur.events?.payDebtToInsurance.debtPaid ?? 0), 0);
                const debtToInsuranceOnProfitInc = ret.reduce((prev, cur) => prev + (cur.events?.changeDebtToInsuranceOnProfit.increaseToDebt ?? 0), 0);
                const notEnoughInsurance = ret.reduce((prev, cur) => prev + (cur.events?.onCoverLoss.lossUncoveredNotEnoughInsurance ?? 0), 0);

                expect(last.strategy.debtToInsurance - notEnoughInsurance).approximately(coverLossInc - debtPaid + debtToInsuranceOnProfitInc, 1e-4);
              });
              it("should change debt to insurance in expected way", async () => {
                const {ret} = await loadFixture(makeCalculations);
                const first = ret[0];
                const last = ret[ret.length - 1];

                const debtToInsuranceInc = ret.reduce((prev, cur) => prev + (cur.events?.onCoverLoss.debtToInsuranceInc ?? 0), 0);
                const debtToInsurancePaid = ret.reduce((prev, cur) => prev + (cur.events?.payDebtToInsurance.debtPaid ?? 0), 0);
                const debtToInsuranceOnProfitInc = ret.reduce((prev, cur) => prev + (cur.events?.changeDebtToInsuranceOnProfit.increaseToDebt ?? 0), 0);

                console.log("last.strategy.debtToInsurance", last.strategy.debtToInsurance);
                console.log("first.strategy.debtToInsurance", first.strategy.debtToInsurance);
                console.log("debtToInsuranceInc", debtToInsuranceInc);
                console.log("debtToInsurancePaid", debtToInsurancePaid);
                console.log("debtToInsuranceOnProfitInc", debtToInsuranceOnProfitInc);

                expect(last.strategy.debtToInsurance - first.strategy.debtToInsurance).approximately(debtToInsuranceOnProfitInc + debtToInsuranceInc - debtToInsurancePaid, 0.01);
              });

              if (strategyInfo.initialInsuranceBalance !== "0") {

                // todo
                it.skip('borrow losses + swap losses = covered losses + increaseToDebts', async () => {
                  const {ret} = await loadFixture(makeCalculations);
                  const last = ret[ret.length - 1];

                  const swapLosses = ret.reduce((prev, cur) => prev + (cur.events?.lossSplitter ?? 0), 0);
                  const increaseToDebts = ret.reduce((prev, cur) => prev + (cur.events?.fixPriceChanges.increaseToDebt ?? 0), 0);
                  const notEnoughInsurance = ret.reduce((prev, cur) => prev + (cur.events?.onCoverLoss.lossUncoveredNotEnoughInsurance ?? 0), 0);
                  const coveredLoss = ret.reduce((prev, cur) => prev + (cur.events?.lossCoveredVault ?? 0), 0);
                  const currentDebtsExist = (last.converterReverse.amountsToRepay.length !== 0 && last.converterReverse.amountsToRepay[0] > 0)
                    || (last.converterDirect.amountsToRepay.length !== 0 && last.converterDirect.amountsToRepay[0] > 0);
                  const paidDebts1 = ret.reduce((prev, cur) => prev + (cur.events?.borrowResults.losses ?? 0) - (cur.events?.borrowResults.gains ?? 0), 0)
                  const paidDebts2 = (last.previewBorrowResults?.borrowLosses ?? 0) - (last.previewBorrowResults?.borrowGains ?? 0);
                  const lossesForBorrowing = currentDebtsExist ? increaseToDebts : paidDebts1 + paidDebts2;

                  console.log("swapLosses", swapLosses);
                  console.log("notEnoughInsurance", notEnoughInsurance);
                  console.log("coveredLoss", coveredLoss);
                  console.log("increaseToDebts", increaseToDebts);
                  console.log("paidDebts", paidDebts1, paidDebts2, paidDebts1 + paidDebts2);
                  console.log("lossesForBorrowing", lossesForBorrowing);

                  if (strategyInfo.dontChangePrices === true) {
                    expect(coveredLoss + increaseToDebts).approximately(lossesForBorrowing + swapLosses + notEnoughInsurance, 0.01);
                  } else {
                    expect(coveredLoss + increaseToDebts).gt(lossesForBorrowing + swapLosses + notEnoughInsurance);
                  }
                });

                it('finalSharePrice is not changed', async () => {
                  const {ret, totalWithdrawFee, totalWithdraw, totalDeposit} = await loadFixture(makeCalculations);

                  const first = ret[0];
                  const last = ret[ret.length - 1];
                  const uncoveredLoss = StateUtilsNum.getTotalUncoveredLoss(ret);
                  const finalSharePrice = (last.vault.totalAssets + uncoveredLoss) / last.vault.totalSupply;

                  if (strategyInfo.compoundRatio === 0) {
                    expect(finalSharePrice).approximately(first.vault.sharePrice, 1e-4);
                  } else {
                    expect(finalSharePrice).gte(first.vault.sharePrice);
                  }
                });
              }
            });
          }
        });
      });
    });
  });
//endregion Unit tests
});
