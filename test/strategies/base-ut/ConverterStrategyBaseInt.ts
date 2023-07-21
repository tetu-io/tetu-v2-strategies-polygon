import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  ConverterStrategyBaseContracts,
  IConverterStrategyBaseContractsParams
} from "./utils/ConverterStrategyBaseContracts";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {IConverterController__factory, IERC20Metadata__factory, ITetuConverter__factory} from "../../../typechain";
import {depositToVault} from "../../StrategyTestUtils";
import {expect} from "chai";
import {IStateNum, StateUtilsNum} from "../../baseUT/utils/StateUtilsNum";
import {UniversalTestUtils} from "../../baseUT/utils/UniversalTestUtils";

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
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);
    core = Addresses.getCore() as CoreAddresses;
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
          await cc.strategy.connect(signer).emergencyExit();
          const afterExit = await StateUtilsNum.getState(signer, signer2, cc.strategy, cc.vault, "");

          console.log("afterDeposit", beforeExit);
          console.log("afterExit", afterExit);

          return {beforeExit, afterExit};
        }

        it("should set investedAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.investedAssets).gt(0);
          await expect(r.afterExit.strategy.investedAssets).eq(0);
        });
        it("should set totalAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.totalAssets).gt(0);
          await expect(r.afterExit.strategy.totalAssets).eq(0);
        });
        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.liquidity).gt(0);
          await expect(r.afterExit.strategy.liquidity).eq(0);
        });
        it("should close all debts", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
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

        it("should set investedAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.investedAssets).gt(0);
          await expect(r.afterExit.strategy.investedAssets).lt(DEFAULT_LIQUIDATION_THRESHOLD);
        });
        it("should set totalAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.totalAssets).gt(0);
          await expect(r.afterExit.strategy.totalAssets).lt(DEFAULT_LIQUIDATION_THRESHOLD);
        });
        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.gauge.strategyBalance).gt(0);
          await expect(r.afterExit.gauge.strategyBalance).eq(0);
        });
        it("should close all debts", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
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

  // todo enable after SCB-718
  describe.skip("requirePayAmountBack", () => {
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

    describe("Deposit 10000, withdraw 9000", () => {
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
//endregion Unit tests
});