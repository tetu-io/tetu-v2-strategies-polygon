import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  ConverterStrategyBaseContracts,
  IConverterStrategyBaseContractsParams
} from "../../base-ut/utils/ConverterStrategyBaseContracts";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {BigNumber} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  IConverterController__factory,
  IERC20Metadata__factory, IPoolAdapter__factory,
  ITetuConverter__factory
} from "../../../../typechain";
import {depositToVault} from "../../../baseUT/universalTestUtils/StrategyTestUtils";
import {expect} from "chai";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {
  BorrowRepayDataTypeUtils,
  IPoolAdapterStatus,
  IPoolAdapterStatusNum
} from "../../../baseUT/converter/BorrowRepayDataTypeUtils";
import {MaticHolders} from "../../../../scripts/addresses/MaticHolders";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";

/**
 * Tests of ConverterStrategyBase on the base of real strategies
 */
describe("ConverterStrategyBaseInt", () => {
  const DEFAULT_LIQUIDATION_THRESHOLD = 100_000;
  let snapshotBefore: string;
  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let core: CoreAddresses;

//region Before, after
  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);
    core = Addresses.getCore() as CoreAddresses;

    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion Before, after

//region Fixtures
  async function prepareUniv3ConverterStrategyUsdcUsdt(p?: IConverterStrategyBaseContractsParams): Promise<ConverterStrategyBaseContracts> {
    return ConverterStrategyBaseContracts.buildUniv3(
      signer,
      signer2,
      core,
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.UNISWAPV3_USDC_USDT_100,
      gov,
      p
    );
  }
  async function prepareBalancerConverterStrategyUsdcTUsd(p?: IConverterStrategyBaseContractsParams): Promise<ConverterStrategyBaseContracts> {
    return ConverterStrategyBaseContracts.buildBalancer(
      signer,
      signer2,
      core,
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.BALANCER_POOL_T_USD,
      gov,
      p
    );
  }
//endregion Fixtures

//region Unit tests
  describe("_emergencyExitFromPool", () => {
    interface IMakeDepositAndEmergencyExitResults {
      beforeExit: IStateNum;
      afterExit: IStateNum;
    }

    describe("univ3", () => {
      /**
       * todo Uncomment after fixing SCB-670
       * SCB-670 is fixed in build 10 of TetuConveter
       * This test doesn't pass because too small USDC amount cannot be liquidated and the borrow cannot be closed.
       */
      describe.skip("Deposit $0.01", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeNoDepositEmergencyExit(): Promise<IMakeDepositAndEmergencyExitResults> {
          // const app = await DeployTetuConverterApp.deployApp(signer, "0x527a819db1eb0e34426297b03bae11F2f8B3A19E");
          const cc = await prepareUniv3ConverterStrategyUsdcUsdt(
            // {converter: app.core.tetuConverter}
          );
          // for (const item of app.platformAdapters) {
          //   if (item.lendingPlatformTitle !== "AAVE v3") {
          //     await ConverterUtils.disablePlatformAdapter(signer, item.platformAdapterAddress, app.core.tetuConverter);
          //     console.log("Disable", item.lendingPlatformTitle);
          //   }
          // }
          // await StrategyTestUtils.setThresholds(
          //   cc.strategy,
          //   signer,
          //   {
          //     rewardLiquidationThresholds: [
          //       {asset: MaticAddresses.USDT_TOKEN, threshold: parseUnits("0.01", 6)}
          //     ]
          //   }
          // );
          await cc.vault.setDoHardWorkOnInvest(false);

          await TokenUtils.getToken(cc.asset, signer2.address, BigNumber.from(10000));
          await cc.vault.connect(signer2).deposit(10000, signer2.address);

          const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();
          const depositAmount1 = parseUnits('100000', decimals);
          await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);
          const beforeExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");
          console.log("beforeExit", beforeExit);

          await cc.strategy.connect(signer).emergencyExit();
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("afterExit", afterExit);

          return {beforeExit, afterExit}
        }

        it("should set investedAssets to 0", async () => {
          const r = await loadFixture(makeNoDepositEmergencyExit);
          await expect(r.afterExit.strategy.investedAssets).eq(0);
        });
      });
      describe("Deposit $0.01 + 100000", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeDepositAndEmergencyExit(): Promise<IMakeDepositAndEmergencyExitResults> {
          const cc = await prepareUniv3ConverterStrategyUsdcUsdt();
          await cc.vault.setDoHardWorkOnInvest(false);

          await TokenUtils.getToken(cc.asset, signer2.address, BigNumber.from(10000));
          await cc.vault.connect(signer2).deposit(10000, signer2.address);

          const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();
          const depositAmount1 = parseUnits('100000', decimals);
          await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

          const asset = IERC20Metadata__factory.connect(cc.asset, signer);
          await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
          const beforeExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("emergencyExit");
          await cc.strategy.connect(signer).emergencyExit({gasLimit: 19_000_000});
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          // console.log("beforeExit", beforeExit);
          // console.log("afterExit", afterExit);
          StateUtilsNum.saveListStatesToCSVColumns(
            './tmp/_emergencyExitFromPool_univ3_001.csv',
            [beforeExit, afterExit],
            { mainAssetSymbol: "USDC"},
            true
          );

          return {beforeExit, afterExit};
        }

        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.liquidity).gt(0);
          await expect(r.afterExit.strategy.liquidity).eq(0);
        });
      });
    });

    describe("balancer", () => {
      /**
       * todo Uncomment after fixing SCB-670
       */
      describe.skip("Deposit $0.01", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeNoDepositEmergencyExit(): Promise<IMakeDepositAndEmergencyExitResults> {
          const cc = await prepareBalancerConverterStrategyUsdcTUsd();
          await cc.vault.setDoHardWorkOnInvest(false);

          await TokenUtils.getToken(cc.asset, signer2.address, BigNumber.from(10000));
          await cc.vault.connect(signer2).deposit(10000, signer2.address);

          const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();
          const depositAmount1 = parseUnits('100000', decimals);
          await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);
          const beforeExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");
          console.log("beforeExit", beforeExit);

          await cc.strategy.connect(signer).emergencyExit();
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("afterExit", afterExit);

          return {beforeExit, afterExit}
        }

        it("should set investedAssets to 0", async () => {
          const r = await loadFixture(makeNoDepositEmergencyExit);
          await expect(r.afterExit.strategy.investedAssets).eq(0);
        });
      });
      describe("Deposit $0.1 + 100000", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeDepositAndEmergencyExit(): Promise<IMakeDepositAndEmergencyExitResults> {
          const cc = await prepareBalancerConverterStrategyUsdcTUsd();
          await cc.vault.setDoHardWorkOnInvest(false);

          const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();

          const depositAmount0 = parseUnits('100', decimals);
          await TokenUtils.getToken(cc.asset, signer2.address, depositAmount0);
          await cc.vault.connect(signer2).deposit(depositAmount0, signer2.address);

          const depositAmount1 = parseUnits('100000', decimals);
          await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

          const asset = IERC20Metadata__factory.connect(cc.asset, signer);
          await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
          const beforeExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("emergencyExit");
          await cc.strategy.connect(signer).emergencyExit();
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("afterDeposit", beforeExit);
          console.log("afterExit", afterExit);

          return {beforeExit, afterExit};
        }

        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.gauge.strategyBalance).gt(0);
          await expect(r.afterExit.gauge.strategyBalance).eq(0);
        });
      });
    });
  });

  describe("_withdrawAllFromPool", () => {
    interface IMakeWithdrawAllFromPoolResults {
      beforeExit: IStateNum;
      afterExit: IStateNum;
    }

    describe("univ3", () => {
      describe("Deposit $0.1 + 100000", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeDepositAndWithdrawAll(): Promise<IMakeWithdrawAllFromPoolResults> {
          const cc = await prepareUniv3ConverterStrategyUsdcUsdt();
          await cc.vault.setDoHardWorkOnInvest(false);

          await TokenUtils.getToken(cc.asset, signer2.address, BigNumber.from(10000));
          await cc.vault.connect(signer2).deposit(10000, signer2.address);

          const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();
          const depositAmount1 = parseUnits('100000', decimals);
          await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

          const asset = IERC20Metadata__factory.connect(cc.asset, signer);
          await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
          const beforeExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("emergencyExit");
          await cc.strategy.connect(await Misc.impersonate(cc.splitter.address)).withdrawAllToSplitter();
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("afterDeposit", beforeExit);
          console.log("afterExit", afterExit);

          return {beforeExit, afterExit};
        }

        it("should set investedAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(r.beforeExit.strategy.investedAssets).gt(0);
          await expect(r.afterExit.strategy.investedAssets).lt(DEFAULT_LIQUIDATION_THRESHOLD);
        });
        it("should set totalAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(r.beforeExit.strategy.totalAssets).gt(0);
          await expect(r.afterExit.strategy.totalAssets).lt(DEFAULT_LIQUIDATION_THRESHOLD);
        });
        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(r.beforeExit.strategy.liquidity).gt(0);
          await expect(r.afterExit.strategy.liquidity).eq(0);
        });
        it("should close all debts", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(
            r.beforeExit.converterDirect.platformAdapters.filter(x => x.length !== 0).length
          ).eq(1);
          await expect(
            r.afterExit.converterDirect.platformAdapters.filter(x => x.length !== 0).length
          ).eq(0);
        });
      });
    });

    describe("balancer", () => {
      describe("Deposit $0.1 + 100000", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeDepositAndWithdrawAll(): Promise<IMakeWithdrawAllFromPoolResults> {
          const cc = await prepareBalancerConverterStrategyUsdcTUsd();
          await cc.vault.setDoHardWorkOnInvest(false);

          const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();

          const depositAmount0 = parseUnits('100', decimals);
          await TokenUtils.getToken(cc.asset, signer2.address, depositAmount0);
          await cc.vault.connect(signer2).deposit(depositAmount0, signer2.address);

          const depositAmount1 = parseUnits('100000', decimals);
          await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

          const asset = IERC20Metadata__factory.connect(cc.asset, signer);
          await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
          const beforeExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("withdrawAllToSplitter");
          await cc.strategy.connect(await Misc.impersonate(cc.splitter.address)).withdrawAllToSplitter();
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("afterDeposit", beforeExit);
          console.log("afterExit", afterExit);

          return {beforeExit, afterExit};
        }

        it("should set investedAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(r.beforeExit.strategy.investedAssets).gt(0);
          await expect(r.afterExit.strategy.investedAssets).lt(DEFAULT_LIQUIDATION_THRESHOLD);
        });
        it("should set totalAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(r.beforeExit.strategy.totalAssets).gt(0);
          await expect(r.afterExit.strategy.totalAssets).lt(DEFAULT_LIQUIDATION_THRESHOLD);
        });
        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(r.beforeExit.gauge.strategyBalance).gt(0);
          await expect(r.afterExit.gauge.strategyBalance).eq(0);
        });
        it("should close all debts", async () => {
          const r = await loadFixture(makeDepositAndWithdrawAll);
          await expect(
            r.beforeExit.converterDirect.platformAdapters.filter(x => x.length !== 0).length
          ).gt(0);
          await expect(
            r.afterExit.converterDirect.platformAdapters.filter(x => x.length !== 0).length
          ).eq(0);
        });
      });
    });
  });

  describe("repayTheBorrow", () => {
    interface IMakeRepayTheBorrowResults {
      afterDeposit: IStateNum;
      afterRepay: IStateNum;
      afterExit: IStateNum;
    }
    interface IMakeRepayTheBorrowParams {
      amountToDeposit: string;
      amountToWithdraw: string;
    }

    async function makeRepayTheBorrow(p: IMakeRepayTheBorrowParams): Promise<IMakeRepayTheBorrowResults> {
      const cc = await prepareUniv3ConverterStrategyUsdcUsdt();
      await cc.vault.setDoHardWorkOnInvest(false);

      // possibility to view debug messages of converter
      await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

      // make deposits
      await TokenUtils.getToken(cc.asset, signer2.address, BigNumber.from(10000));
      await cc.vault.connect(signer2).deposit(10000, signer2.address);

      const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();
      const depositAmount1 = parseUnits(p.amountToDeposit, decimals);
      await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

      const asset = IERC20Metadata__factory.connect(cc.asset, signer);
      await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
      const afterDeposit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterDeposit");

      // repay the borrow in the tetu converter
      const converterAsStrategy = ITetuConverter__factory.connect(
        await cc.strategy.converter(),
        await Misc.impersonate(cc.strategy.address)
      );
      const converterAsGov = converterAsStrategy.connect(
        await Misc.impersonate(
          await IConverterController__factory.connect(await converterAsStrategy.controller(), signer).governance()
        )
      );
      const openedPositions = await converterAsStrategy.getPositions(
        cc.strategy.address,
        MaticAddresses.USDC_TOKEN,
        MaticAddresses.USDT_TOKEN
      );
      for (const poolAdapter of openedPositions) {
        await converterAsGov.repayTheBorrow(poolAdapter, true);
      }
      const afterRepay = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterRepay");

      // withdraw the amount
      await cc.strategy.connect(await Misc.impersonate(cc.splitter.address)).withdrawToSplitter(
        parseUnits(p.amountToWithdraw, decimals)
      );
      const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterExit");

      console.log("afterDeposit", afterDeposit);
      console.log("afterRepay", afterRepay);
      console.log("afterExit", afterExit);

      return {afterDeposit, afterRepay, afterExit};
    }

    describe("Deposit 10000, repay all borrows, withdraw 9000", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeRepayTheBorrowTest(): Promise<IMakeRepayTheBorrowResults> {
        return makeRepayTheBorrow({
          amountToDeposit: "10000",
          amountToWithdraw: "9000"
        })
      }

      it("should close all debts before withdraw", async () => {
        const r = await loadFixture(makeRepayTheBorrowTest);
        await expect(
          r.afterDeposit.converterDirect.platformAdapters.filter(x => x.length !== 0).length
        ).gt(0);
        await expect(
          r.afterRepay.converterDirect.platformAdapters.filter(x => x.length !== 0).length
        ).eq(0);
      });
      it("should withdraw required amount to splitter", async () => {
        const r = await loadFixture(makeRepayTheBorrowTest);
        await expect(r.afterExit.splitter.assetBalance - r.afterDeposit.splitter.assetBalance).gte(1000);
      });
    });
  });

  describe("withdraw", () => {
    describe("Check postWithdrawActionsEmpty-branch of _withdrawUniversal", () => {
      interface IMakeWithdrawResults {
        amountToWithdraw: number;
        afterDeposit: IStateNum;
        afterWithdraw: IStateNum;
      }
      interface IMakeWithdrawParams {
        amountToDeposit: string;
      }

      /**
       * Deposit $100_000
       * Some amount of asset are left unused on the strategy balance (USDC, USDT, DAI).
       * Let's try to withdraw an amount with total cost equal to left (USDT + DAI).
       * Required amount is already on balance, so it's not necessary to get liquidity from the pool.
       * So postWithdrawActionsEmpty-branch will be called
       */
      async function makeWithdraw(p: IMakeWithdrawParams): Promise<IMakeWithdrawResults> {
        const cc = await prepareBalancerConverterStrategyUsdcTUsd();
        await cc.vault.setDoHardWorkOnInvest(false);

        const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();

        const depositAmount0 = parseUnits('100', decimals);
        await TokenUtils.getToken(cc.asset, signer2.address, depositAmount0);
        await cc.vault.connect(signer2).deposit(depositAmount0, signer2.address);

        const depositAmount1 = parseUnits(p.amountToDeposit, decimals);
        await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

        const asset = IERC20Metadata__factory.connect(cc.asset, signer);
        await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
        const afterDeposit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterDeposit");
        console.log("afterDeposit", afterDeposit);

        // some amounts of USDC, USDT and DAI are left unused on the strategy balance
        // let's try to withdraw amount of USDT + amount of DAI, we can do it without withdrawing liquidity from the pool

        // assume that afterDeposit.strategy.borrowAssetsNames are following USDT, DAI
        const indexUsdt1 = 0;
        const indexDai1 = 1;
        // assume that afterDeposit.converter.borrowAssetsAddresses are following: USDT, USDC, DAI
        const indexUsdt2 = 0;
        const indexDai2 = 2;
        const amountToWithdrawSecondaryAssets= Math.round(
          afterDeposit.strategy.borrowAssetsBalances[indexUsdt1] * afterDeposit.converterDirect.borrowAssetsPrices[indexUsdt2]
           + afterDeposit.strategy.borrowAssetsBalances[indexDai1] * afterDeposit.converterDirect.borrowAssetsPrices[indexDai2]
        );
        const amountToWithdraw = amountToWithdrawSecondaryAssets / 2 + afterDeposit.strategy.assetBalance;
        console.log("amountToWithdraw", amountToWithdraw);

        // withdraw the amount
        await cc.strategy.connect(await Misc.impersonate(cc.splitter.address)).withdrawToSplitter(
          parseUnits(amountToWithdraw.toString(), decimals)
        );
        const afterWithdraw = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterWithdraw");

        console.log("afterWithdraw", afterWithdraw);

        return {
          afterDeposit,
          afterWithdraw,
          amountToWithdraw
        };
      }

      describe("Deposit 10000, withdraw 9000", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeWithdrawTest(): Promise<IMakeWithdrawResults> {
          return makeWithdraw({amountToDeposit: "10000"});
        }

        it("should withdraw required amount to splitter", async () => {
          const r = await loadFixture(makeWithdrawTest);
          await expect(r.afterWithdraw.splitter.assetBalance - r.afterDeposit.splitter.assetBalance).gte(r.amountToWithdraw);
        });
        it("should not reduce gauge balance", async () => {
          const r = await loadFixture(makeWithdrawTest);
          await expect(r.afterWithdraw.gauge.strategyBalance).gte(r.afterDeposit.gauge.strategyBalance);
        });
      });
    });
  });

  describe("deposit", () => {
    describe("reinvestThresholdPercent", () => {
      interface IMakeDepositResults {
        afterDeposit0: IStateNum;
        afterDeposit1: IStateNum;
      }
      interface IMakeDepositParams {
        amountToDeposit0: string;
        amountToDeposit1: string;
        reinvestThresholdPercent: number;
      }

      async function makeTwoDeposits(p: IMakeDepositParams): Promise<IMakeDepositResults> {
        const cc = await prepareBalancerConverterStrategyUsdcTUsd();
        await cc.vault.setDoHardWorkOnInvest(false);
        const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();

        const operator = await UniversalTestUtils.getAnOperator(cc.strategy.address, signer);
        await cc.strategy.connect(operator).setReinvestThresholdPercent(p.reinvestThresholdPercent);

        const depositAmount0 = parseUnits(p.amountToDeposit0, decimals);
        await TokenUtils.getToken(cc.asset, signer2.address, depositAmount0);
        await cc.vault.connect(signer2).deposit(depositAmount0, signer2.address);
        const afterDeposit0 = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterDeposit0");
        console.log("afterDeposit0", afterDeposit0);

        const depositAmount1 = parseUnits(p.amountToDeposit1, decimals);
        await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

        const asset = IERC20Metadata__factory.connect(cc.asset, signer);
        await depositToVault(cc.vault, signer, depositAmount1, decimals, asset, cc.insurance);
        const afterDeposit1 = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "afterDeposit1");
        console.log("afterDeposit1", afterDeposit1);

        return {afterDeposit0, afterDeposit1};
      }

      describe("Deposit amount < threshold", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeWithdrawTest(): Promise<IMakeDepositResults> {
          return makeTwoDeposits({
            amountToDeposit0: "1000",
            amountToDeposit1: "100",
            reinvestThresholdPercent: 100_000 // 100%
          });
        }

        it("second deposit shouldn't change invested amount", async () => {
          const r = await loadFixture(makeWithdrawTest);
          await expect(r.afterDeposit0.strategy.investedAssets).approximately(r.afterDeposit1.strategy.investedAssets, 1);
        });
      });
      describe("Deposit amount > threshold", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeWithdrawTest(): Promise<IMakeDepositResults> {
          return makeTwoDeposits({
            amountToDeposit0: "1000",
            amountToDeposit1: "2000",
            reinvestThresholdPercent: 100_000 // 100%
          });
        }

        it("second deposit should increase invested amount", async () => {
          const r = await loadFixture(makeWithdrawTest);
          await expect(r.afterDeposit0.strategy.investedAssets).lt(r.afterDeposit1.strategy.investedAssets);
        });
      });
    });
  });

  describe("_repayDebt study error 35 @skip-on-coverage", () => {
    interface IRepayDebtParams {
      collateralAsset: string;
      collateralAssetHolder: string;
      borrowAsset: string;
      borrowAssetHolder: string;
      amountIn: string;
      initialBorrowBalance?: string; // default 0
      countBlocksToWait?: number; // default 100
    }

    interface IRepayDebtResults {
      borrowedAmount: number;
      expectedAmount: number;
      repaidAmount: number;
      amountSendToRepay: number;
      statusBeforeRepay: IPoolAdapterStatusNum;
      statusAfterRepay: IPoolAdapterStatusNum;
    }

    async function repayDebt(p: IRepayDebtParams): Promise<IRepayDebtResults> {
      const facade = await MockHelper.createConverterStrategyBaseLibFacade(signer);
      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const decimalsCollateral = await collateralAsset.decimals();
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
      const decimalsBorrow = await borrowAsset.decimals();

      const tetuConverter = await ITetuConverter__factory.connect(MaticAddresses.TETU_CONVERTER, signer);
      await ConverterUtils.whitelist([facade.address]);

      await ConverterUtils.disableAaveV2(signer);
      // await ConverterUtils.disableDForce(signer);

      const amountIn = parseUnits(p.amountIn, decimalsCollateral);

      // prepare collateral
      await BalanceUtils.getAmountFromHolder(p.collateralAsset, p.collateralAssetHolder, facade.address, amountIn);
      if (p.initialBorrowBalance) {
        await BalanceUtils.getAmountFromHolder(p.borrowAsset, p.borrowAssetHolder, facade.address, parseUnits(p.initialBorrowBalance, decimalsBorrow));
      }

      // make borrow
      await collateralAsset.connect(await Misc.impersonate(facade.address)).approve(MaticAddresses.TETU_CONVERTER, amountIn);
      await facade.openPosition(MaticAddresses.TETU_CONVERTER, "0x", p.collateralAsset, p.borrowAsset, amountIn,0);

      // wait until the amount of debt increases
      await TimeUtils.advanceNBlocks(p.countBlocksToWait ?? 100);

      const positions = await tetuConverter.getPositions(facade.address, p.collateralAsset, p.borrowAsset);
      const statusBefore: IPoolAdapterStatus = await IPoolAdapter__factory.connect(positions[0], signer).getStatus();

      // try to repay the debt using amount available on the balance
      const ret = await facade.callStatic._repayDebt(
        MaticAddresses.TETU_CONVERTER,
        p.collateralAsset,
        p.borrowAsset,
        await borrowAsset.balanceOf(facade.address)
      );
      const borrowedAmount = await borrowAsset.balanceOf(facade.address);
      await borrowAsset.connect(await Misc.impersonate(facade.address)).approve(MaticAddresses.TETU_CONVERTER, borrowedAmount);
      await facade._repayDebt(MaticAddresses.TETU_CONVERTER, p.collateralAsset, p.borrowAsset, borrowedAmount);

      const statusAfter: IPoolAdapterStatus = await IPoolAdapter__factory.connect(positions[0], signer).getStatus();

      return {
        borrowedAmount: +formatUnits(borrowedAmount, decimalsBorrow),
        expectedAmount: +formatUnits(ret.expectedAmountOut, decimalsBorrow),
        repaidAmount: +formatUnits(ret.repaidAmountOut, decimalsBorrow),
        amountSendToRepay: +formatUnits(ret.amountSendToRepay, decimalsBorrow),
        statusBeforeRepay: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusBefore, decimalsCollateral, decimalsBorrow),
        statusAfterRepay: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfter, decimalsCollateral, decimalsBorrow),
      }
    }

    describe("search error 35 conditions - repay amount is a little less than amount to repay", () => {
      let snapshotRoot: string;
      // Block 46320827. Problem amounts: 100.087, 100.093, 100.102, 100.113, 100.121, 100.129,...
      before(async function () {
        snapshotRoot = await TimeUtils.snapshot();
        await InjectUtils.injectTetuConverter(signer);
        // await InjectUtils.redeployAave3PoolAdapters(signer);
      });
      after(async function () {
        await TimeUtils.rollback(snapshotRoot);
      });

      for (let i = 0; i < 100; ++i) {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        const amount = 100.08 + i / 1000;
        describe(amount.toString(), () => {
          async function repayDebtTest(): Promise<IRepayDebtResults> {
            return repayDebt({
              collateralAsset: MaticAddresses.USDC_TOKEN,
              borrowAsset: MaticAddresses.USDT_TOKEN,
              amountIn: amount.toString(),
              collateralAssetHolder: MaticHolders.HOLDER_USDC,
              borrowAssetHolder: MaticHolders.HOLDER_USDT,
              countBlocksToWait: 10,
              initialBorrowBalance: "0.000003"
            });
          }

          it("should repay debt successfully", async () => {
            const ret = await loadFixture(repayDebtTest);
            console.log("ret", ret);
            // expect(ret.statusAfterRepay.amountToPay !== 0).eq(true);
            expect(ret.statusAfterRepay.healthFactor18).gt(1.0);
          });
        });
      }
    });
  });

  describe("Study sendTokensToForwarder: send real tokens to real forwarders @skip-on-coverage", () => {
    let snapshot: string;
    before(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISendTokensToForwarderResults {
      balanceBefore: number[];
      balanceAfter: number[];
    }

    interface ISendTokensToForwarderParams {
      tokens: string[];
      holders: string[];
      amounts: string[];
    }

    async function makeSendTokensToForwarderTest(p: ISendTokensToForwarderParams): Promise<ISendTokensToForwarderResults> {
      const cc = await prepareBalancerConverterStrategyUsdcTUsd();
      // const vault = ethers.Wallet.createRandom().address;
      const facade = await MockHelper.createConverterStrategyBaseLibFacade(signer);
      // const controller = await MockHelper.createMockController(signer);
      // await controller.setForwarder(core.forwarder);
      // const splitter = await MockHelper.createMockSplitter(signer);
      // await splitter.setVault(vault);

      const decimals: number[] = [];
      for (let i = 0; i < p.tokens.length; ++i) {
        decimals.push(await IERC20Metadata__factory.connect(p.tokens[i], signer).decimals());
        await BalanceUtils.getAmountFromHolder(
          p.tokens[i],
          p.holders[i],
          facade.address,
          parseUnits(p.amounts[i], decimals[i])
        )
      }

      const balanceBefore = await Promise.all(p.tokens.map(
        async (x, index) => IERC20Metadata__factory.connect(x, signer).balanceOf(facade.address)
      ));


      await facade.sendTokensToForwarder(
        await cc.vault.controller(),
        cc.splitter.address,
        p.tokens,
        p.amounts.map((amount, index) => parseUnits(amount, decimals[index])),
        p.tokens.map((x, index) => parseUnits("0.0001", decimals[index]))
      );

      return {
        balanceBefore: await Promise.all(balanceBefore.map(async (x, index) => +formatUnits(x, decimals[index]))),
        balanceAfter: await Promise.all(p.tokens.map(
          async (x, index) => +formatUnits(
            await IERC20Metadata__factory.connect(x, signer).balanceOf(facade.address),
            decimals[index]
          )
        ))
      }
    }

    it("forwarder should receive expected tokens", async () => {
      const r = await makeSendTokensToForwarderTest({
        tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN],
        holders: [MaticHolders.HOLDER_USDC, MaticHolders.HOLDER_USDT],
        amounts: ["0.000001", "0.000002"],
      });
      expect(r.balanceBefore.join()).eq([0.000001, 0.000002].join());
      expect(r.balanceAfter.join()).eq([0, 0].join());
    });
  });
//endregion Unit tests
});
