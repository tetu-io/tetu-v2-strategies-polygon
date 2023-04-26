import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {ConverterStrategyBaseContracts} from "./utils/ConverterStrategyBaseContracts";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory} from "../../../typechain";
import {depositToVault} from "../../StrategyTestUtils";
import {expect} from "chai";
import {IStateNum, StateUtilsNum} from "../../baseUT/utils/StateUtilsNum";

/**
 * Tests of ConverterStrategyBase on the base of real strategies
 */
describe("ConverterStrategyBaseInt", () => {
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
  async function prepareUniv3ConverterStrategyUsdcUsdt(): Promise<ConverterStrategyBaseContracts> {
    return ConverterStrategyBaseContracts.buildUniv3(
      signer,
      signer2,
      core,
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.UNISWAPV3_USDC_USDT_100,
      gov
    );
  }
  async function prepareBalancerConverterStrategyUsdcTUsd(): Promise<ConverterStrategyBaseContracts> {
    return ConverterStrategyBaseContracts.buildBalancer(
      signer,
      signer2,
      core,
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.BALANCER_POOL_T_USD,
      gov
    );
  }
//endregion Fixtures

//region Unit tests
  describe("_emergencyExitFromPool", () => {
    interface IMakeDepositAndEmergencyExit {
      beforeExit: IStateNum;
      afterExit: IStateNum;
    }

    describe("univ3", () => {
      /**
       * todo Uncomment after fixing SCB-670
       */
      describe.skip("Deposit $0.1", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeNoDepositEmergencyExit(): Promise<IMakeDepositAndEmergencyExit> {
          const cc = await loadFixture(prepareUniv3ConverterStrategyUsdcUsdt);
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

        async function makeDepositAndEmergencyExit(): Promise<IMakeDepositAndEmergencyExit> {
          const cc = await loadFixture(prepareUniv3ConverterStrategyUsdcUsdt);
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
            r.beforeExit.converter.platformAdapters.filter(x => x.length !== 0).length
          ).eq(1);
          await expect(
            r.afterExit.converter.platformAdapters.filter(x => x.length !== 0).length
          ).eq(0);
        });
      });
    });

    describe("balancer", () => {
      /**
       * todo Uncomment after fixing SCB-670
       */
      describe.skip("Deposit $0.1", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeNoDepositEmergencyExit(): Promise<IMakeDepositAndEmergencyExit> {
          const cc = await loadFixture(prepareBalancerConverterStrategyUsdcTUsd);
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

        async function makeDepositAndEmergencyExit(): Promise<IMakeDepositAndEmergencyExit> {
          const cc = await loadFixture(prepareBalancerConverterStrategyUsdcTUsd);
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
          await expect(r.afterExit.strategy.investedAssets).eq(0);
        });
        it("should set totalAssets to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.strategy.totalAssets).gt(0);
          await expect(r.afterExit.strategy.totalAssets).eq(0);
        });
        it("should set liquidity to 0", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(r.beforeExit.gauge.strategyBalance).gt(0);
          await expect(r.afterExit.gauge.strategyBalance).eq(0);
        });
        it("should close all debts", async () => {
          const r = await loadFixture(makeDepositAndEmergencyExit);
          await expect(
            r.beforeExit.converter.platformAdapters.filter(x => x.length !== 0).length
          ).eq(1);
          await expect(
            r.afterExit.converter.platformAdapters.filter(x => x.length !== 0).length
          ).eq(0);
        });
      });
    });
  });
//endregion Unit tests
});