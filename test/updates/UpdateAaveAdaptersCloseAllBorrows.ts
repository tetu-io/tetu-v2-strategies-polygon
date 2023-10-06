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
  DebtMonitor__factory,
  IBorrowManager, IPoolAdapter__factory, IRebalancingV2Strategy__factory,
  StrategySplitterV2__factory,
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
import {ENTRY_TO_POOL_DISABLED, PLAN_SWAP_REPAY} from "../baseUT/AppConstants";
import {defaultAbiCoder} from "ethers/lib/utils";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {IEventsSet} from "../baseUT/strategies/CaptureEvents";
import fs from "fs";
import {BigNumber} from "ethers";
import {vault} from "../../typechain/@tetu_io/tetu-contracts-v2/contracts";

describe("UpdateAaveAdaptersCloseAllBorrows", () => {
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
      MaticAddresses.AAVE3_POOL,
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

      await getPlatformsAdapterInfoForStrategy("before emergency exit", strategy, debtMonitor);
      await converterStrategyBase.emergencyExit();
      await getPlatformsAdapterInfoForStrategy("after emergency exit", strategy, debtMonitor);

      const countPositionsAfterWithdraw = (await debtMonitor.getPositionsForUser(strategy)).length;

      const strategyInfo: IStrategyInfo = {
        avgApr,
        strategy,
        countPositionsBeforeWithdraw,
        countPositionsAfterWithdraw
      }
      dest.push(strategyInfo);
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

      await makeFullWithdraw(IRebalancingV2Strategy__factory.connect(strategy, operator), {
        entryToPool: ENTRY_TO_POOL_DISABLED,
        aggregator: MaticAddresses.TETU_LIQUIDATOR, //  MaticAddresses.AGG_ONEINCH_V5,
        planEntryDataGetter: async () => defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]),
        saveStates: saver,
        maxAmountToSwap: "30000",
        isCompleted: async (completed: boolean) => {
          return completed;
        }
      });

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
      await rebalancingV2Strategy.rebalanceNoSwaps(false);

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
      console.log("Pool adapter user, platform adapter", config.user, platformAdapter, config, status);
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

    // freeze current version of AAVE3 and AAVE2 pool adapters
    const aave3PlatformAdapterAddress = await getAaveThreePlatformAdapter(signer);
    console.log("aave3PlatformAdapterAddress old", aave3PlatformAdapterAddress);
    const aaveTwoPlatformAdapterAddress = await getAaveTwoPlatformAdapter(signer);
    console.log("aaveTwoPlatformAdapterAddress old", aaveTwoPlatformAdapterAddress);
    await getPlatformsAdapterInfo("initial", borrowManagerAsGov, debtMonitor);

    // withdraw all from old-strategy
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