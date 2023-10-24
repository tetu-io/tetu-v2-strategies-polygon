import {
  getAaveThreePlatformAdapter,
  getAaveTwoPlatformAdapter,
  getConverterAddress,
  Misc
} from "../../scripts/utils/Misc";
import {
  Aave3PlatformAdapter, AaveTwoPlatformAdapter,
  BorrowManager,
  BorrowManager__factory, ConverterController,
  ConverterController__factory,
  ConverterStrategyBase__factory, DebtMonitor,
  DebtMonitor__factory, IERC20Metadata__factory,
  IPoolAdapter__factory, IRebalancingV2Strategy__factory,
  StrategySplitterV2__factory, TetuConverter,
  TetuConverter__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {ConverterUtils} from "../baseUT/utils/ConverterUtils";
import {CustomConverterDeployHelper} from "../baseUT/converter/CustomConverterDeployHelper";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {makeFullWithdraw} from "../../scripts/utils/WithdrawAllByAggUtils";
import {ENTRY_TO_POOL_DISABLED, PLAN_SWAP_REPAY_0} from "../baseUT/AppConstants";
import {defaultAbiCoder} from "ethers/lib/utils";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {IEventsSet} from "../baseUT/strategies/CaptureEvents";
import fs from "fs";
import {BigNumber} from "ethers";
import {vault} from "../../typechain/@tetu_io/tetu-contracts-v2/contracts";

describe("UpdateAaveAdaptersCloseAllBorrows @skip-on-coverage", () => {
  const VAULT_NSR = "0x0D397F4515007AE4822703b74b9922508837A04E";
  const VAULT_OLD = "0xF9D7A7fDd6fa57eBcA160d6D2B5B6C4651F7E740";
  const OPERATOR = "0xF1dCce3a6c321176C62b71c091E3165CC9C3816E";

  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    // signer = signers[0];
    signer = await Misc.impersonate(OPERATOR);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Utils
  interface IStrategyInfo {
    countPositionsBeforeWithdraw: number;
    countPositionsAfterWithdraw: number;
    strategy: string;
    avgApr: BigNumber;
  }

  async function unregisterPlatformAdapter(borrowManager: BorrowManager, platformAdapter: string): Promise<BorrowManager.AssetPairStructOutput[]> {
    const countPairs = (await borrowManager.platformAdapterPairsLength(platformAdapter)).toNumber();
    const pairs: BorrowManager.AssetPairStructOutput[] = [];
    for (let i = 0; i < countPairs; ++i) {
      const pair = await borrowManager.platformAdapterPairsAt(platformAdapter, i);
      pairs.push(pair);
    }
    await borrowManager.removeAssetPairs(
      platformAdapter,
      pairs.map(x => x.assetLeft),
      pairs.map(x => x.assetRight)
    );
    return pairs;
  }
  async function registerPlatformAdapter(borrowManager: BorrowManager, platformAdapter: string, pairs: BorrowManager.AssetPairStructOutput[]){
    await borrowManager.addAssetPairs(
      platformAdapter,
      pairs.map(x => x.assetLeft),
      pairs.map(x => x.assetRight)
    );
  }
  async function deployAave3(converterController: ConverterController): Promise<Aave3PlatformAdapter> {
    const converterNormal = await CustomConverterDeployHelper.createAave3PoolAdapter(signer);
    const converterEMode = await CustomConverterDeployHelper.createAave3PoolAdapterEMode(signer);
    return CustomConverterDeployHelper.createAave3PlatformAdapter(
      signer,
      converterController.address,
      MaticAddresses.AAVE3_POOL,
      converterNormal.address,
      converterEMode.address,
    );
  }

  async function deployAaveTwo(converterController: ConverterController): Promise<AaveTwoPlatformAdapter> {
    const converterNormalTwo = await CustomConverterDeployHelper.createAaveTwoPoolAdapter(signer);
    return CustomConverterDeployHelper.createAaveTwoPlatformAdapter(
      signer,
      converterController.address,
      MaticAddresses.AAVE_LENDING_POOL,
      converterNormalTwo.address,
    );
  }

  async function printAvgAprsForNsrVault() {
    const vaultNsr = TetuVaultV2__factory.connect(VAULT_NSR, signer);
    const splitter = await StrategySplitterV2__factory.connect(await vaultNsr.splitter(), signer);
    const strategies = await splitter.allStrategies();

    for(const strategy of strategies) {
      // get averageApr for each strategy
      const avgApr = await splitter.averageApr(strategy);
      console.log("averageApr", strategy, avgApr);
    }
  }

  async function withdrawAllFromOldVault(debtMonitor: DebtMonitor): Promise<IStrategyInfo[]> {
    const vault = TetuVaultV2__factory.connect(VAULT_OLD, signer);
    const splitter = await StrategySplitterV2__factory.connect(await vault.splitter(), signer);
    const strategies = await splitter.allStrategies();
    const operator = signer;

    // withdraw all
    const dest: IStrategyInfo[] = [];
    for(const strategy of strategies) {
      const converterStrategyBase = await ConverterStrategyBase__factory.connect(strategy, operator);

      const countPositionsBeforeWithdraw = (await debtMonitor.getPositionsForUser(strategy)).length;
      const avgApr = await splitter.averageApr(strategy);

      console.log("vault.balance.before", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(vault.address));
      console.log("splitter.balance.before", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(splitter.address));
      console.log("strategy.balance.before", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(converterStrategyBase.address));
      console.log("continueInvesting");
      await splitter.continueInvesting(strategy, 1);
      console.log("doHardWork");
      await splitter.connect(operator).doHardWork();
      console.log("pauseInvesting");
      await splitter.pauseInvesting(strategy);

      await getPlatformsAdapterInfoForStrategy("before emergency exit", strategy, debtMonitor);
      console.log("investedAssets", await converterStrategyBase.investedAssets());
      await converterStrategyBase.emergencyExit();
      console.log("investedAssets after emergencyExit1", await converterStrategyBase.investedAssets());
      console.log("vault.balance.after", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(vault.address));
      console.log("splitter.balance.after", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(splitter.address));
      console.log("strategy.balance.after", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(converterStrategyBase.address));

      await getPlatformsAdapterInfoForStrategy("after emergency exit", strategy, debtMonitor);

      const countPositionsAfterWithdraw = (await debtMonitor.getPositionsForUser(strategy)).length;

      const strategyInfo: IStrategyInfo = {
        avgApr,
        strategy,
        countPositionsBeforeWithdraw,
        countPositionsAfterWithdraw
      }
      dest.push(strategyInfo);

      console.log("strategy balance", await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(strategy));
    }

    return dest;
  }

  async function withdrawAllFromNsrVault(): Promise<IStrategyInfo[]> {
    const vaultNsr = TetuVaultV2__factory.connect(VAULT_NSR, signer);
    const splitter = await StrategySplitterV2__factory.connect(await vaultNsr.splitter(), signer);
    const strategies = await splitter.allStrategies();
    const operator = signer;
    const tetuConverter = TetuConverter__factory.connect(MaticAddresses.TETU_CONVERTER, signer);
    const converterController = ConverterController__factory.connect(await tetuConverter.controller(), signer);
    const debtMonitor = DebtMonitor__factory.connect(await converterController.debtMonitor(), signer);

    const dest: IStrategyInfo[] = [];
    for(const strategy of strategies) {
      // get averageApr for each strategy
      const avgApr = await splitter.averageApr(strategy);
      console.log("apr", strategy, avgApr);

      const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy, signer);
      const countPositionsBeforeWithdraw = (await debtMonitor.getPositionsForUser(strategy)).length;

      // set strategy to pause
      await splitter.pauseInvesting(strategy);

      // withdraw all
      const pathOut = `./tmp/withdraw_${strategy}.csv`;
      const states: IStateNum[] = [];
      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }
      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(operator, operator, converterStrategyBase, vaultNsr, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };
      await saver("b");

      await makeFullWithdraw(
        IRebalancingV2Strategy__factory.connect(strategy, operator),
        {
          entryToPool: ENTRY_TO_POOL_DISABLED,
          aggregator: MaticAddresses.TETU_LIQUIDATOR, //  MaticAddresses.AGG_ONEINCH_V5,
          planEntryDataGetter: async () => defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY_0, 0]),
          saveStates: saver,
          maxAmountToSwap: "30000",
          isCompleted: async (completed: boolean) => {
            return completed;
          }
        }
      );

      const countPositionsAfterWithdraw = (await debtMonitor.getPositionsForUser(strategy)).length;
      const strategyInfo: IStrategyInfo = {
        avgApr,
        strategy,
        countPositionsBeforeWithdraw,
        countPositionsAfterWithdraw
      }
      dest.push(strategyInfo);
      console.log("Strategy info", strategyInfo);
    }

    console.log("withdrawAllFromNsrVault - done");

    return dest;
  }

  async function unPauseAndRebalanceNsr(strategies: IStrategyInfo[]) {
    const vaultNsr = TetuVaultV2__factory.connect(VAULT_NSR, signer);
    const splitter = await StrategySplitterV2__factory.connect(await vaultNsr.splitter(), signer);
    const operator = signer;

    // set avg APR
    for(const si of strategies) {
      console.log("Avg apr 0", si.strategy, await splitter.averageApr(si.strategy));
      await splitter.continueInvesting(si.strategy, si.avgApr);
      console.log("Avg apr 1", si.strategy, await splitter.averageApr(si.strategy));
    }

    for(const si of strategies) {
      const converterStrategyBase = ConverterStrategyBase__factory.connect(si.strategy, signer);

      const pathOut = `./tmp/rebalance_${si.strategy}.csv`;
      const states: IStateNum[] = [];
      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }
      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(operator, operator, converterStrategyBase, vaultNsr, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };
      await saver("b");

      const rebalancingV2Strategy = IRebalancingV2Strategy__factory.connect(si.strategy, signer);
      console.log("rebalanceNoSwaps.start", si.strategy);
      await rebalancingV2Strategy.rebalanceNoSwaps(false, {gasLimit: 19_000_000});
      console.log("rebalanceNoSwaps.end");

      await saver("a");
    }
  }

  async function getPlatformsAdapterInfo(title: string, borrowManager: BorrowManager, debtMonitor: DebtMonitor) {
    const countPositions = (await debtMonitor.getCountPositions()).toNumber();
    console.log("Count platform adapters", title, await borrowManager.platformAdaptersLength());
    console.log("countPositions", title, countPositions);
    for (let i = 0; i < countPositions; ++i) {
      const poolAdapterAddress = await debtMonitor.positions(i);
      const poolAdapter = await IPoolAdapter__factory.connect(poolAdapterAddress, signer);
      const config = await poolAdapter.getConfig();
      const status = await poolAdapter.getStatus();
      const platformAdapter = await borrowManager.converterToPlatformAdapter(config.originConverter);
      console.log("getPlatformsAdapterInfo.poolAdapter", poolAdapter.address);
      console.log("getPlatformsAdapterInfo.platformAdapter", platformAdapter);
      console.log("getPlatformsAdapterInfo.user", config.user);
      console.log("getPlatformsAdapterInfo.status", status);
    }
  }

  async function getPlatformsAdapterInfoForStrategy(title: string,  strategy: string, debtMonitor: DebtMonitor) {
    const positions = await debtMonitor.getPositionsForUser(strategy);
    for (const poolAdapterAddress of positions) {
      const poolAdapter = await IPoolAdapter__factory.connect(poolAdapterAddress, signer);
      const config = await poolAdapter.getConfig();
      const status = await poolAdapter.getStatus();
      console.log("Pool adapter user", title, config.user, config, status);
    }
  }

  async function tryToCloseBorrow(poolAdapter: string, tetuConverterAsGov: TetuConverter) {
    const vault = TetuVaultV2__factory.connect(VAULT_OLD, signer);
    const splitter = await StrategySplitterV2__factory.connect(await vault.splitter(), signer);

    const pa = await IPoolAdapter__factory.connect(poolAdapter, signer);
    const config = await pa.getConfig();
    console.log("status", await pa.getStatus());
    console.log("config", config);

    const converterStrategyBase = ConverterStrategyBase__factory.connect(config.user, signer);
    console.log("vault.balance.0", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(vault.address));
    console.log("splitter.balance.0", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(splitter.address));
    console.log("strategy.balance.0", await converterStrategyBase.asset(), await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).balanceOf(converterStrategyBase.address));

    await tetuConverterAsGov.repayTheBorrow(poolAdapter, false);
    console.log("status", await pa.getStatus());
    console.log("config", await pa.getConfig());
  }
//endregion Utils

  it("should not revert", async () => {
    const tetuConverter = getConverterAddress();
    const converterControllerAddress = await TetuConverter__factory.connect(tetuConverter, signer).controller();
    const converterController = ConverterController__factory.connect(converterControllerAddress, signer);
    const borrowManagerAddress = await converterController.borrowManager();
    const debtMonitorAddress = await converterController.debtMonitor();
    const governanceAddress = await converterController.governance();

    const converterGovernance = await Misc.impersonate(governanceAddress);
    const borrowManagerAsGov = BorrowManager__factory.connect(borrowManagerAddress, converterGovernance);
    const debtMonitor = DebtMonitor__factory.connect(debtMonitorAddress, converterGovernance);
    const tetuConverterAsGov = TetuConverter__factory.connect(tetuConverter, converterGovernance);

    // freeze current version of AAVE3 and AAVE2 pool adapters
    const aave3PlatformAdapterAddress = await getAaveThreePlatformAdapter(signer);
    console.log("aave3PlatformAdapterAddress old", aave3PlatformAdapterAddress);
    const aaveTwoPlatformAdapterAddress = await getAaveTwoPlatformAdapter(signer);
    console.log("aaveTwoPlatformAdapterAddress old", aaveTwoPlatformAdapterAddress);
    await getPlatformsAdapterInfo("initial", borrowManagerAsGov, debtMonitor);

    // withdraw all from old-strategy
    await tryToCloseBorrow("0xDbB0a8F194e9D9AB8b6bf53a1083364F5c8de1ff", tetuConverterAsGov);
    console.log("tryToCloseBorrow.done");

    const infoStrategiesOld = await withdrawAllFromOldVault(debtMonitor);
    console.log("infoStrategiesOld", infoStrategiesOld);

    await getPlatformsAdapterInfo("after withdraw old", borrowManagerAsGov, debtMonitor);

    // withdraw all from all NSR-strategies
    await printAvgAprsForNsrVault();
    const infoStrategiesNsr = await withdrawAllFromNsrVault();
    console.log("infoStrategiesNsr", infoStrategiesNsr);


    await getPlatformsAdapterInfo("after withdraw", borrowManagerAsGov, debtMonitor);

    // unregister all asset pairs for AAVE3 pool adapter
    const pairsAave3 = await unregisterPlatformAdapter(borrowManagerAsGov, aave3PlatformAdapterAddress);
    const pairsAaveTwo = await unregisterPlatformAdapter(borrowManagerAsGov, aaveTwoPlatformAdapterAddress);
    console.log("pairsAave3", pairsAave3);
    console.log("pairsAaveTwo", pairsAaveTwo);

    await ConverterUtils.disablePlatformAdapter(signer, aave3PlatformAdapterAddress);
    await ConverterUtils.disablePlatformAdapter(signer, aaveTwoPlatformAdapterAddress);
    await getPlatformsAdapterInfo("after disable aave", borrowManagerAsGov, debtMonitor);

    // create new platform adapters for AAVE3 and AAVETwo
    const platformAdapterAave3 = await deployAave3(converterController);
    const platformAdapterAaveTwo = await deployAaveTwo(converterController);

    // register all pairs with new platform adapter for AAVE3 and AAVETwo
    await registerPlatformAdapter(borrowManagerAsGov, platformAdapterAave3.address, pairsAave3);
    await registerPlatformAdapter(borrowManagerAsGov, platformAdapterAaveTwo.address, pairsAaveTwo);

    await getPlatformsAdapterInfo("after", borrowManagerAsGov, debtMonitor);

    // unpause and rebalance NSR strategies
    await unPauseAndRebalanceNsr(infoStrategiesNsr);
  });
});