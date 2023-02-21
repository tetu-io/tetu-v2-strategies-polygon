import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {IState, UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter, Misc
} from "../../../../scripts/utils/Misc";
import {BalancerIntTestUtils} from "./utils/BalancerIntTestUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {
  IERC20__factory,
  ISplitter,
  ISplitter__factory,
  IStrategyV2,
  ITetuLiquidator,
  TetuVaultV2
} from "../../../../typechain";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {ICoreContractsWrapper} from "../../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../../ToolsContractsWrapper";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {BigNumber} from "ethers";
import {VaultUtils} from "../../../VaultUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
chai.use(chaiAsPromised);

//region Utils
interface IPutInitialAmountsoBalancesResults {
  balanceUser: BigNumber;
  balanceSigner: BigNumber;
}

/**
 *  put DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
 */
async function putInitialAmountsToBalances(
  asset: string,
  user: SignerWithAddress,
  signer: SignerWithAddress,
  liquidator: ITetuLiquidator,
  amount: number
) : Promise<IPutInitialAmountsoBalancesResults>{
  const userBalance = await StrategyTestUtils.getUnderlying(user, asset, amount, liquidator, [signer.address]);

  // put half of signer's balance to liquidator
  const signerBalance = userBalance;
  await IERC20__factory.connect(asset, signer).transfer(liquidator.address, signerBalance.div(2));
  return {
    balanceSigner: await IERC20__factory.connect(asset, signer).balanceOf(signer.address),
    balanceUser: await IERC20__factory.connect(asset, signer).balanceOf(user.address),
  }
}

//endregion Utils

describe('BalancerIntTest', function() {
//region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let addresses: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;

//endregion Constants and variables

//region before, after
  before(async function () {
    signer = await DeployerUtilsLocal.impersonate(); // governance by default
    user = (await ethers.getSigners())[1];

    snapshotBefore = await TimeUtils.snapshot();

    addresses = Addresses.getCore();
    tetuConverterAddress = getConverterAddress();

    await BalancerIntTestUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await BalancerIntTestUtils.deployAndSetCustomSplitter(signer, addresses);

    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());

    // Disable Hundred Finance (no liquidity)
    await ConverterUtils.disablePlatformAdapter(signer, getHundredFinancePlatformAdapter());
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Integration tests
  describe("Single strategy with fees", () => {
    const COMPOUND_RATIO = 50_000;
    const REINVEST_THRESHOLD_PERCENT = 1_000;
    const DEPOSIT_AMOUNT = 100_000;
    const DEPOSIT_FEE = 1_00; // 100_000
    const BUFFER = 1_00; // 100_000
    const WITHDRAW_FEE = 5_00; // 100_000

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let core: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: IStrategyV2;
    let asset: string;
    let splitter: ISplitter;

    let stateBeforeDeposit: IState;
    let stateAfterSignerDeposit: IState;
    let stateAfterDeposit: IState;

    before(async function () {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const strategyDeployer = await UniversalTestUtils.makeStrategyDeployer(
        addresses,
        MAIN_ASSET,
        tetuConverterAddress,
        "BalancerComposableStableStrategy",
        {
          depositFee: DEPOSIT_FEE,
          buffer: BUFFER,
          withdrawFee: WITHDRAW_FEE
        }
      );
      const data = await strategyDeployer(signer);

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy;
      splitter = ISplitter__factory.connect(await vault.splitter(), signer);

      await UniversalTestUtils.setCompoundRatio(strategy, user, COMPOUND_RATIO);
      await BalancerIntTestUtils.setThresholds(
        strategy,
        user,
        {reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT}
      );

      // DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
      const initialBalances = await putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      stateBeforeDeposit = await UniversalTestUtils.getState(signer, user, strategy, vault);

      // Enter to vault
      await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);

      stateAfterSignerDeposit = await UniversalTestUtils.getState(signer, user, strategy, vault);
      await VaultUtils.deposit(user, vault, initialBalances.balanceUser);
      await UniversalTestUtils.removeExcessTokens(asset, user, tools.liquidator.address);
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);

      stateAfterDeposit = await UniversalTestUtils.getState(signer, user, strategy, vault);
    });

    after(async function () {
      await TimeUtils.rollback(localSnapshotBefore);
    });

    beforeEach(async function () {
      localSnapshot = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(localSnapshot);
    });

    describe("State before deposit", () => {
      it("should have expected values", async () => {
        const ret = [
          stateBeforeDeposit.signer.usdc.eq(parseUnits(DEPOSIT_AMOUNT.toString(), 6).div(2)),
          stateBeforeDeposit.user.usdc.eq(parseUnits(DEPOSIT_AMOUNT.toString(), 6)),
          stateBeforeDeposit.gauge.strategyBalance.eq(0),

          await vault.depositFee(),
          await vault.buffer(),
          await vault.withdrawFee(),
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          true,
          true,
          true,

          DEPOSIT_FEE,
          BUFFER,
          WITHDRAW_FEE
        ].map(x => BalanceUtils.toString(x)).join("\n");
        expect(ret).eq(expected);
      });
    });

    describe("State after depositing 50_000 by signer", () => {
      it("should have expected values", async () => {
        console.log("stateAfterSignerDeposit", stateAfterSignerDeposit);
        const ret = [
          stateAfterDeposit.signer.usdc,
          stateAfterDeposit.user.usdc,

          // strategy
          stateAfterDeposit.strategy.usdc.gt(0),
          stateAfterDeposit.strategy.usdc,

          // gauge
          stateAfterDeposit.gauge.strategyBalance.gt(0),

          // splitter
          stateAfterDeposit.splitter.totalAssets,

          // vault
          stateAfterDeposit.vault.userShares.add(stateAfterDeposit.vault.signerShares),
          stateAfterDeposit.vault.userUsdc.add(stateAfterDeposit.vault.signerUsdc),
          stateAfterDeposit.vault.totalAssets,

          // insurance and buffer
          stateAfterDeposit.insurance.usdc,
          stateAfterDeposit.vault.usdc
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          0,
          0,

          // strategy
          true,
          stateAfterDeposit.strategy.totalAssets.sub(stateAfterDeposit.strategy.investedAssets),

          // gauge
          true,

          // splitter
          stateAfterDeposit.strategy.totalAssets,

          // vault
          stateAfterDeposit.vault.totalSupply,
          stateAfterDeposit.vault.totalSupply,
          stateAfterDeposit.vault.totalSupply,

          // insurance and buffer
          stateBeforeDeposit.user.usdc.add(stateBeforeDeposit.signer.usdc)
            .mul(DEPOSIT_FEE)
            .div(100_000),
          stateBeforeDeposit.user.usdc.add(stateBeforeDeposit.signer.usdc)
            .mul(100_000 - DEPOSIT_FEE)
            .div(100_000)
            .mul(BUFFER)
            .div(100_000)
        ].map(x => BalanceUtils.toString(x)).join("\n");
        exp

    describe("State after deposit", () => {
      it("should have expected values", async () => {
        console.log("stateAfterSignerDeposit", stateAfterSignerDeposit);
        const ret = [
          stateAfterDeposit.signer.usdc,
          stateAfterDeposit.user.usdc,

          // strategy
          stateAfterDeposit.strategy.usdc.gt(0),
          stateAfterDeposit.strategy.usdc,

          // gauge
          stateAfterDeposit.gauge.strategyBalance.gt(0),

          // splitter
          stateAfterDeposit.splitter.totalAssets,

          // vault
          stateAfterDeposit.vault.userShares.add(stateAfterDeposit.vault.signerShares),
          stateAfterDeposit.vault.userUsdc.add(stateAfterDeposit.vault.signerUsdc),
          stateAfterDeposit.vault.totalAssets,

          // insurance and buffer
          stateAfterDeposit.insurance.usdc,
          stateAfterDeposit.vault.usdc
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          0,
          0,

          // strategy
          true,
          stateAfterDeposit.strategy.totalAssets.sub(stateAfterDeposit.strategy.investedAssets),

          // gauge
          true,

          // splitter
          stateAfterDeposit.strategy.totalAssets,

          // vault
          stateAfterDeposit.vault.totalSupply,
          stateAfterDeposit.vault.totalSupply,
          stateAfterDeposit.vault.totalSupply,

          // insurance and buffer
          stateBeforeDeposit.user.usdc.add(stateBeforeDeposit.signer.usdc)
            .mul(DEPOSIT_FEE)
            .div(100_000),
          stateBeforeDeposit.user.usdc.add(stateBeforeDeposit.signer.usdc)
            .mul(100_000 - DEPOSIT_FEE)
            .div(100_000)
            .mul(BUFFER)
            .div(100_000)
        ].map(x => BalanceUtils.toString(x)).join("\n");
        expect(ret).eq(expected);
      });
    });

    describe("Withdraw all", () => {
      describe("Good paths", () => {
        describe("Withdraw immediately", () => {
          it("should return expected values", async () => {
            await strategy.connect(
              await Misc.impersonate(splitter.address)
            ).withdrawAllToSplitter();
            const stateAfterWithdraw = await UniversalTestUtils.getState(signer, user, strategy, vault);

            console.log("stateBeforeDeposit", stateBeforeDeposit);
            console.log("stateAfterDeposit", stateAfterDeposit);
            console.log("stateAfterWithdraw", stateAfterWithdraw);
          });
        });
      });
      describe("Bad paths", () => {

      });
      describe("Gas estimation @skip-on-coverage", () => {

      });
    });

    describe("Withdraw TODO", () => {
      describe("Good paths", () => {
        it("should return expected values", async () => {

        });
      });
      describe("Bad paths", () => {

      });
      describe("Gas estimation @skip-on-coverage", () => {

      });
    });

    describe("Emergency exit TODO", () => {
      describe("Good paths", () => {
        it("should return expected values", async () => {

        });
      });
      describe("Bad paths", () => {

      });
      describe("Gas estimation @skip-on-coverage", () => {

      });
    });
  });

//endregion Integration tests
});