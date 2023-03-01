import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter, Misc
} from "../../../../scripts/utils/Misc";
import {BalancerIntTestUtils, IPutInitialAmountsBalancesResults, IState} from "./utils/BalancerIntTestUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {
  BalancerComposableStableStrategy, BalancerComposableStableStrategy__factory, ControllerV2__factory,
  IERC20__factory, ISplitter,
  ISplitter__factory,
  IStrategyV2,
  ITetuLiquidator,
  TetuVaultV2
} from "../../../../typechain";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {ICoreContractsWrapper} from "../../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../../ToolsContractsWrapper";
import {BigNumber} from "ethers";
import {VaultUtils} from "../../../VaultUtils";
import {parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../../scripts/utils/GasLimitUtils";
import {
  GAS_DEPOSIT_SIGNER, GAS_EMERGENCY_EXIT,
  GAS_FIRST_HARDWORK, GAS_HARDWORK_WITH_REWARDS,
  GAS_WITHDRAW_ALL_TO_SPLITTER
} from "../../../baseUT/GasLimits";
import {areAlmostEqual} from "../../../baseUT/utils/MathUtils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
chai.use(chaiAsPromised);

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
    console.log("signer", signer.address);
    console.log("user", user.address);

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
    const DEPOSIT_FEE = 2_00; // 100_000
    const BUFFER = 1_00; // 100_000
    const WITHDRAW_FEE = 5_00; // 100_000
    const DENOMINATOR = 100_000;

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let core: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: BalancerComposableStableStrategy;
    let asset: string;
    let splitter: ISplitter;
    let stateBeforeDeposit: IState;
    let initialBalances: IPutInitialAmountsBalancesResults;
    let forwarder: string;

    /**
     * DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
     */
    async function enterToVault() : Promise<IState> {
      await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);
      await VaultUtils.deposit(user, vault, initialBalances.balanceUser);
      await UniversalTestUtils.removeExcessTokens(asset, user, tools.liquidator.address);
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);
      return BalancerIntTestUtils.getState(signer, user, strategy, vault);
    }

    before(async function () {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const data = await UniversalTestUtils.makeStrategyDeployer(
        signer,
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

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy as unknown as BalancerComposableStableStrategy;
      splitter = ISplitter__factory.connect(await vault.splitter(), signer);
      forwarder = await ControllerV2__factory.connect(await vault.controller(), signer).forwarder();
      console.log("vault", vault.address);
      console.log("strategy", strategy.address);
      console.log("splitter", splitter.address);
      console.log("forwarder", forwarder);

      await UniversalTestUtils.setCompoundRatio(strategy as unknown as IStrategyV2, user, COMPOUND_RATIO);
      await BalancerIntTestUtils.setThresholds(
        strategy as unknown as IStrategyV2,
        user,
        {reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT}
      );

      initialBalances = await BalancerIntTestUtils.putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      stateBeforeDeposit = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
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

    describe("Single actions", () => {
      describe("State after depositing 50_000 by signer", () => {
        it("should have expected values", async () => {
          // some insurance is immediately used to recover entry-loss during the depositing
          const recoveredLoss = await UniversalTestUtils.extractLossCovered(
            await (await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner)).wait(),
            vault.address
          ) || BigNumber.from(0);
          const stateAfterDeposit = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

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
            stateAfterDeposit.vault.totalAssets.eq(
              parseUnits((DEPOSIT_AMOUNT / 2).toString(), 6)
                .mul(DENOMINATOR - DEPOSIT_FEE)
                .div(DENOMINATOR)
            ),

            // insurance and buffer
            stateAfterDeposit.insurance.usdc,
            stateAfterDeposit.vault.usdc,

            // base amounts
            stateAfterDeposit.baseAmounts.usdc.eq(stateAfterDeposit.strategy.usdc),
            stateAfterDeposit.baseAmounts.usdt.eq(stateAfterDeposit.strategy.usdt),
            stateAfterDeposit.baseAmounts.dai.eq(stateAfterDeposit.strategy.dai),
            stateAfterDeposit.baseAmounts.bal.eq(0),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            0,
            parseUnits(DEPOSIT_AMOUNT.toString(), 6),

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
            true,

            // insurance and buffer
            stateBeforeDeposit.signer.usdc
              .mul(DEPOSIT_FEE)
              .div(100_000)
              .sub(recoveredLoss),
            stateBeforeDeposit.signer.usdc
              .mul(100_000 - DEPOSIT_FEE)
              .div(100_000)
              .mul(BUFFER)
              .div(100_000)
              .add(recoveredLoss),

            // base amounts
            true, true, true, true
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
        it("should not exceed gas limits @skip-on-coverage", async () => {
          const cr = await (await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner)).wait();
          controlGasLimitsEx(cr.gasUsed, GAS_DEPOSIT_SIGNER, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe("State after depositing 50_000 by signer and 100_000 by user", () => {
        it("should have expected values", async () => {
          // some insurance is immediately used to recover entry-loss during the depositing
          const recoveredLossSigner = await UniversalTestUtils.extractLossCovered(
            await (await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner)).wait(),
            vault.address
          ) || BigNumber.from(0);

          const recoveredLossUser = await UniversalTestUtils.extractLossCovered(
            await (await VaultUtils.deposit(user, vault, initialBalances.balanceUser)).wait(),
            vault.address
          ) || BigNumber.from(0);

          const stateAfterDepositUser = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const ret = [
            stateAfterDepositUser.signer.usdc,
            stateAfterDepositUser.user.usdc,

            // strategy
            stateAfterDepositUser.strategy.usdc.gt(0),
            stateAfterDepositUser.strategy.usdc,

            // gauge
            stateAfterDepositUser.gauge.strategyBalance.gt(0),

            // splitter
            stateAfterDepositUser.splitter.totalAssets,

            // vault
            stateAfterDepositUser.vault.userShares.add(stateAfterDepositUser.vault.signerShares),
            stateAfterDepositUser.vault.userUsdc.add(stateAfterDepositUser.vault.signerUsdc),
            stateAfterDepositUser.vault.totalAssets,
            stateAfterDepositUser.vault.totalAssets.eq(
              parseUnits((DEPOSIT_AMOUNT * 1.5).toString(), 6)
                .mul(DENOMINATOR - DEPOSIT_FEE)
                .div(DENOMINATOR)
            ),

            // insurance and buffer
            stateAfterDepositUser.insurance.usdc,
            stateAfterDepositUser.vault.usdc,

            // base amounts
            stateAfterDepositUser.baseAmounts.usdc.eq(stateAfterDepositUser.strategy.usdc),
            stateAfterDepositUser.baseAmounts.usdt.eq(stateAfterDepositUser.strategy.usdt),
            stateAfterDepositUser.baseAmounts.dai.eq(stateAfterDepositUser.strategy.dai),
            stateAfterDepositUser.baseAmounts.bal.eq(0),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            0,
            0,

            // strategy
            true,
            stateAfterDepositUser.strategy.totalAssets.sub(stateAfterDepositUser.strategy.investedAssets),

            // gauge
            true,

            // splitter
            stateAfterDepositUser.strategy.totalAssets,

            // vault
            stateAfterDepositUser.vault.totalSupply,
            stateAfterDepositUser.vault.totalSupply,
            stateAfterDepositUser.vault.totalSupply,
            true,

            // insurance and buffer
            stateBeforeDeposit.signer.usdc
              .mul(DEPOSIT_FEE)
              .div(DENOMINATOR)
              .sub(recoveredLossSigner)
              .add(
                stateBeforeDeposit.user.usdc
                  .mul(DEPOSIT_FEE)
                  .div(DENOMINATOR)
                  .sub(recoveredLossUser)
              ),
            stateBeforeDeposit.signer.usdc
              .mul(DENOMINATOR - DEPOSIT_FEE)
              .div(DENOMINATOR)
              .mul(BUFFER)
              .div(DENOMINATOR)

              // first recovered amount recoveredLossSigner is invested together with user's deposit
              // so it's not kept on vault's balance anymore
              // .add(recoveredLossSigner)
              .add(
                stateBeforeDeposit.user.usdc
                  .mul(DENOMINATOR - DEPOSIT_FEE)
                  .div(DENOMINATOR)
                  .mul(BUFFER)
                  .div(DENOMINATOR)
                  .add(recoveredLossUser)
              ),

            // base amounts
            true, true, true, true
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });

      describe("Hardwork after initial deposit, no rewards", () => {
        it("should return expected values", async () => {
          const stateAfterDeposit = await enterToVault();

          // initial deposit doesn't invest all amount to pool
          // a first hardwork make additional investment
          await strategy.connect(await Misc.impersonate(vault.address)).doHardWork();
          const stateAfterHardwork = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const ret = [
            // strategy
            stateAfterDeposit.strategy.usdc.gt(stateAfterHardwork.strategy.usdc),
            stateAfterDeposit.strategy.usdt.gt(stateAfterHardwork.strategy.usdt) || stateAfterHardwork.strategy.usdt.eq(0),
            stateAfterDeposit.strategy.dai.gt(stateAfterHardwork.strategy.dai) || stateAfterHardwork.strategy.dai.eq(0),
            stateAfterHardwork.strategy.investedAssets.gt(stateBeforeDeposit.strategy.investedAssets),

            // gauge
            stateAfterHardwork.gauge.strategyBalance.gt(stateBeforeDeposit.gauge.strategyBalance),

            // splitter: total assets amount is a bit decreased
            stateAfterDeposit.splitter.totalAssets.gt(stateAfterHardwork.splitter.totalAssets),
            areAlmostEqual(stateAfterDeposit.splitter.totalAssets, stateAfterHardwork.splitter.totalAssets, 3),

            // base amounts
            stateAfterDeposit.baseAmounts.usdc.eq(stateAfterDeposit.strategy.usdc),
            stateAfterDeposit.baseAmounts.usdt.eq(stateAfterDeposit.strategy.usdt),
            stateAfterDeposit.baseAmounts.dai.eq(stateAfterDeposit.strategy.dai),
            stateAfterDeposit.baseAmounts.bal.eq(0),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            // strategy
            true, true, true, true,

            // gauge
            true,

            // splitter
            true, true,

            // base amounts
            true, true, true, true
          ].map(x => BalanceUtils.toString(x)).join("\n");

          console.log("stateBeforeDeposit", stateBeforeDeposit);
          console.log("stateAfterDeposit", stateAfterDeposit);
          console.log("stateAfterHardwork", stateAfterHardwork);

          expect(ret).eq(expected);
        });
        it("should not exceed gas limits @skip-on-coverage", async () => {
          const gasUsed = await strategy.connect(await Misc.impersonate(vault.address)).estimateGas.doHardWork();
          controlGasLimitsEx(gasUsed, GAS_FIRST_HARDWORK, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe("withdrawAllToSplitter", () => {
        it("should return expected values", async () => {
          const stateAfterDeposit = await enterToVault();
          await strategy.connect(
            await Misc.impersonate(splitter.address)
          ).withdrawAllToSplitter();
          const stateAfterWithdraw = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const ret = [
            // gauge
            stateAfterWithdraw.gauge.strategyBalance.eq(0),

            // strategy
            stateAfterWithdraw.strategy.usdc.eq(0),
            stateAfterWithdraw.strategy.usdt.eq(0),
            stateAfterWithdraw.strategy.dai.eq(0),

            // we cannot withdraw the whole amount from the balancer, small amount will leave there
            stateAfterWithdraw.strategy.bptPool.gt(0),
            stateAfterWithdraw.strategy.totalAssets.gt(0),
            stateAfterWithdraw.strategy.investedAssets.gt(0),

            // splitter
            areAlmostEqual(stateAfterWithdraw.splitter.usdc, stateAfterWithdraw.splitter.totalAssets, 6),

            // vault
            stateAfterWithdraw.vault.totalSupply.eq(stateAfterDeposit.vault.totalSupply),
            // balancer pool gives us a small profit
            // block 39612612: 149700000000 => 149772478557
            stateAfterWithdraw.vault.totalAssets.gte(stateAfterDeposit.vault.totalAssets),
            stateAfterWithdraw.vault.sharePrice.gt(stateAfterDeposit.vault.sharePrice),

            // base amounts
            stateAfterDeposit.baseAmounts.usdc.eq(stateAfterDeposit.strategy.usdc),
            stateAfterDeposit.baseAmounts.usdt.eq(stateAfterDeposit.strategy.usdt),
            stateAfterDeposit.baseAmounts.dai.eq(stateAfterDeposit.strategy.dai),
            stateAfterDeposit.baseAmounts.bal.eq(0),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            // gauge
            true,

            // strategy
            true, true, true,

            // we cannot withdraw the whole amount from the balancer, small amount will leave there
            true, true, true,

            // splitter
            true,

            // vault
            true, true, true,

            // base amounts
            true, true, true, true
          ].map(x => BalanceUtils.toString(x)).join("\n");

          console.log("stateBeforeDeposit", stateBeforeDeposit);
          console.log("stateAfterDeposit", stateAfterDeposit);
          console.log("stateAfterWithdraw", stateAfterWithdraw);

          expect(ret).eq(expected);
        });
        it("should not exceed gas limits @skip-on-coverage", async () => {
          const gasUsed = await strategy.connect(
            await Misc.impersonate(splitter.address)
          ).estimateGas.withdrawAllToSplitter();
          controlGasLimitsEx(gasUsed, GAS_WITHDRAW_ALL_TO_SPLITTER, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe("withdrawToSplitter", () => {
        it("should return expected values", async () => {
          const stateAfterDeposit = await enterToVault();

          const amountToWithdraw = parseUnits(DEPOSIT_AMOUNT.toString(), 6).div(2);
          await strategy.connect(
            await Misc.impersonate(splitter.address)
          ).withdrawToSplitter(amountToWithdraw);
          const stateAfterWithdraw = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const ret = [
            // splitter
            stateAfterWithdraw.splitter.usdc.eq(amountToWithdraw),

            // strategy
            stateAfterWithdraw.strategy.bptPool.gt(0),

            // base amounts
            stateAfterDeposit.baseAmounts.usdc.eq(stateAfterDeposit.strategy.usdc),
            stateAfterDeposit.baseAmounts.usdt.eq(stateAfterDeposit.strategy.usdt),
            stateAfterDeposit.baseAmounts.dai.eq(stateAfterDeposit.strategy.dai),
            stateAfterDeposit.baseAmounts.bal.eq(0),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            // splitter
            true,

            // strategy
            true,

            // base amounts
            true, true, true, true,
          ].map(x => BalanceUtils.toString(x)).join("\n");

          console.log("stateBeforeDeposit", stateBeforeDeposit);
          console.log("stateAfterDeposit", stateAfterDeposit);
          console.log("stateAfterWithdraw", stateAfterWithdraw);

          expect(ret).eq(expected);
        });
      });

      describe("Emergency exit", () => {
        it("should return expected values", async () => {
          const stateAfterDeposit = await enterToVault();

          const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(
            strategy.address,
            await UniversalTestUtils.getAnOperator(strategy.address, signer)
          );
          await strategyAsOperator.emergencyExit();

          const stateAfterExit = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const ret = [
            // gauge
            stateAfterExit.gauge.strategyBalance.eq(0),

            // strategy
            stateAfterExit.strategy.usdc.eq(0),
            stateAfterExit.strategy.usdt.eq(0),
            stateAfterExit.strategy.dai.eq(0),

            // we cannot withdraw the whole amount from the balancer, small amount will leave there
            stateAfterExit.strategy.bptPool.gt(0),
            stateAfterExit.strategy.totalAssets.gt(0),
            stateAfterExit.strategy.investedAssets.gt(0),

            // splitter
            areAlmostEqual(stateAfterExit.splitter.usdc, stateAfterExit.splitter.totalAssets, 6),

            // vault
            stateAfterExit.vault.totalSupply.eq(stateAfterDeposit.vault.totalSupply),
            // balancer pool gives us a small profit
            // block 39612612: 149700000000 => 149772478557
            stateAfterExit.vault.totalAssets.gte(stateAfterDeposit.vault.totalAssets),
            stateAfterExit.vault.sharePrice.gt(stateAfterDeposit.vault.sharePrice),

            // base amounts
            stateAfterDeposit.baseAmounts.usdc.eq(stateAfterDeposit.strategy.usdc),
            stateAfterDeposit.baseAmounts.usdt.eq(stateAfterDeposit.strategy.usdt),
            stateAfterDeposit.baseAmounts.dai.eq(stateAfterDeposit.strategy.dai),
            stateAfterDeposit.baseAmounts.bal.eq(0),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            // gauge
            true,

            // strategy
            true, true, true,

            // we cannot withdraw the whole amount from the balancer, small amount will leave there
            true, true, true,

            // splitter
            true,

            // vault
            true, true, true,

            // base amounts
            true, true, true, true,
          ].map(x => BalanceUtils.toString(x)).join("\n");

          console.log("stateBeforeDeposit", stateBeforeDeposit);
          console.log("stateAfterDeposit", stateAfterDeposit);
          console.log("stateAfterWithdraw", stateAfterExit);

          expect(ret).eq(expected);
        });
        it("should not exceed gas limits @skip-on-coverage", async () => {
          const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(
            strategy.address,
            await UniversalTestUtils.getAnOperator(strategy.address, signer)
          );
          const gasUsed = await strategyAsOperator.estimateGas.emergencyExit();
          controlGasLimitsEx(gasUsed, GAS_EMERGENCY_EXIT, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe("Hardwork with rewards", () => {
        it("should return expected values", async () => {
          const stateAfterDeposit = await enterToVault();

          // forbid liquidation of received BAL-rewards
          await BalancerIntTestUtils.setThresholds(
            strategy as unknown as IStrategyV2,
            user,
            {
              rewardLiquidationThresholds: [
                {
                  asset: MaticAddresses.BAL_TOKEN,
                  threshold: parseUnits("1000", 18)
                }, {
                  asset: MaticAddresses.USDC_TOKEN,
                  threshold: parseUnits("1000", 6)
                }
              ]
            }
          )

          // wait long time, some rewards should appear
          console.log("start to advance blocks");
          await TimeUtils.advanceNBlocks(20_000);
          console.log("end to advance blocks");

          // try to check forward income .. (unsuccessfully, todo)
          const tetuBefore = await IERC20__factory.connect(MaticAddresses.TETU_TOKEN, signer).balanceOf(forwarder);

          const tx = await strategy.connect(await Misc.impersonate(vault.address)).doHardWork();
          const distributed = await UniversalTestUtils.extractDistributed(await tx.wait(), forwarder);
          const stateAfterHardwork = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const tetuAfter = await IERC20__factory.connect(MaticAddresses.TETU_TOKEN, signer).balanceOf(forwarder);

          const ret = [
            // strategy
            stateAfterDeposit.strategy.usdc.gt(stateAfterHardwork.strategy.usdc),
            stateAfterDeposit.strategy.usdt.gt(stateAfterHardwork.strategy.usdt) || stateAfterHardwork.strategy.usdt.eq(0),
            stateAfterDeposit.strategy.dai.gt(stateAfterHardwork.strategy.dai) || stateAfterHardwork.strategy.dai.eq(0),
            stateAfterHardwork.strategy.investedAssets.gt(stateBeforeDeposit.strategy.investedAssets),

            // strategy - bal: some rewards were received, claimed but not compounded because of the high thresholds
            stateAfterHardwork.strategy.bal.gt(0),

            // gauge
            stateAfterHardwork.gauge.strategyBalance.gt(stateBeforeDeposit.gauge.strategyBalance),

            // splitter: total assets amount is a bit decreased
            stateAfterDeposit.splitter.totalAssets.gt(stateAfterHardwork.splitter.totalAssets),
            areAlmostEqual(stateAfterDeposit.splitter.totalAssets, stateAfterHardwork.splitter.totalAssets, 3),

            // base amounts
            stateAfterDeposit.baseAmounts.usdc.eq(stateAfterDeposit.strategy.usdc),
            stateAfterDeposit.baseAmounts.usdt.eq(stateAfterDeposit.strategy.usdt),
            stateAfterDeposit.baseAmounts.dai.eq(stateAfterDeposit.strategy.dai),
            stateAfterDeposit.baseAmounts.bal.eq(stateAfterDeposit.strategy.bal),
          ].map(x => BalanceUtils.toString(x)).join("\n");
          const expected = [
            // strategy
            true, true, true, true,

            // strategy - bal: some rewards were received and claimed
            true,

            // gauge
            true,

            // splitter
            true, true,

            // base amounts
            true, true, true, true
          ].map(x => BalanceUtils.toString(x)).join("\n");

          console.log("stateBeforeDeposit", stateBeforeDeposit);
          console.log("stateAfterDeposit", stateAfterDeposit);
          console.log("stateAfterHardwork", stateAfterHardwork);
          console.log("distributed", distributed);
          console.log("tetuBefore", tetuBefore);
          console.log("tetuAfter", tetuAfter);

          expect(ret).eq(expected);
        });
        it("should not exceed gas limits @skip-on-coverage", async () => {
          await TimeUtils.advanceNBlocks(20_000);
          const gasUsed = await strategy.connect(await Misc.impersonate(vault.address)).estimateGas.doHardWork();
          controlGasLimitsEx(gasUsed, GAS_HARDWORK_WITH_REWARDS, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe.skip("Withdraw maxWithdraw()", () => {
        it("should return expected values", async () => {
          const stateBefore = await enterToVault();
          console.log("stateBefore", stateBefore);

          const amountToWithdraw = await vault.maxWithdraw(user.address);
          // const amountToWithdraw = (await vault.maxWithdraw(user.address)).sub(parseUnits("1", 6));
          console.log("amountToWithdraw", amountToWithdraw);

          console.log("maxWithdraw()", await vault.maxWithdraw(user.address));
          console.log("balanceOf", await vault.balanceOf(user.address));
          console.log("convertToAssets(balanceOf(owner))", await vault.convertToAssets(await vault.balanceOf(user.address)));
          console.log("withdrawFee", await vault.withdrawFee());
          console.log("maxWithdrawAssets", await vault.maxWithdrawAssets());

          const assets = await vault.convertToAssets(await vault.balanceOf(user.address));
          const shares = await vault.previewWithdraw(assets);
          console.log("assets", assets);
          console.log("previewWithdraw.shares", shares);

          await vault.connect(user).withdraw(amountToWithdraw, user.address, user.address);

          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          const ret = stateAfter.vault.sharePrice.sub(stateBefore.vault.sharePrice);
          console.log("Share price before", stateBefore.vault.sharePrice.toString());
          console.log("Share price after", stateAfter.vault.sharePrice.toString());

          expect(ret.eq(0)).eq(true);
        });
      });
    });

    describe("Deposit, hardwork, withdraw @skip-on-coverage", () =>{
      describe("deposit, several hardworks, withdraw", () => {
        it("should be profitable", async () => {
          const countLoops = 2;
          const stepInBlocks = 20_000;
          const stateAfterDeposit = await enterToVault();
          console.log("stateAfterDeposit", stateAfterDeposit);

          for (let i = 0; i < countLoops; ++i) {
            await TimeUtils.advanceNBlocks(stepInBlocks);
            await strategy.connect(await Misc.impersonate(vault.address)).doHardWork();
            const state = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
            console.log(`state after hardwork ${i}`, state);
          }
          await TimeUtils.advanceNBlocks(stepInBlocks);

          await vault.connect(user).withdrawAll();
          await vault.connect(signer).withdrawAll();

          const stateFinal = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
          console.log("stateFinal", stateFinal);

          const initialTotalAmount = parseUnits(DEPOSIT_AMOUNT.toString(), 6).mul(3).div(2);
          const resultTotalAmount = BalancerIntTestUtils.getTotalUsdAmount(stateFinal);

          console.log("resultTotalAmount", resultTotalAmount);
          console.log("initialTotalAmount", initialTotalAmount);
          BalancerIntTestUtils.outputProfitEnterFinal(stateBeforeDeposit, stateFinal);
          expect(resultTotalAmount).gt(initialTotalAmount);
        });
      });
      describe("loopEndActions from DoHardWorkLoopBase", () => {
        it("should be profitable", async () => {
          const countLoops = 20;
          const stepInBlocks = 5_000;
          const stateAfterDeposit = await enterToVault();
          console.log("stateAfterDeposit", stateAfterDeposit);

          let isUserDeposited = true;
          for (let i = 0; i < countLoops; ++i) {
            if (isUserDeposited && i % 2 === 0) {
              isUserDeposited = false;
              if (i % 4 === 0) {
                console.log("!!! withdrawAll");
                await vault.connect(user).withdrawAll();
              } else {
                const userVaultBalance = await vault.balanceOf(user.address);
                const userAssetBalance = await vault.connect(user).convertToAssets(userVaultBalance);
                const toWithdraw = BigNumber.from(userAssetBalance).mul(95).div(100);
                console.log("!!! withdraw", toWithdraw);
                await vault.connect(user).withdraw(toWithdraw, user.address, user.address);
              }

            } else if (!isUserDeposited && i % 2 !== 0) {
              isUserDeposited = true;
              const userAssetBalance = await TokenUtils.balanceOf(asset, user.address);
              const amountToDeposit = BigNumber.from(userAssetBalance).div(3);

              console.log("!!! Deposit", amountToDeposit);
              await IERC20__factory.connect(asset, user).approve(vault.address, amountToDeposit);
              await vault.connect(user).deposit(amountToDeposit, user.address);

              console.log("!!! Deposit", amountToDeposit);
              await IERC20__factory.connect(asset, user).approve(vault.address, amountToDeposit);
              await vault.connect(user).deposit(amountToDeposit, user.address);
            }

            const state = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
            console.log(`state after hardwork ${i}`, state);
          }
          await TimeUtils.advanceNBlocks(stepInBlocks);

          await vault.connect(user).withdrawAll();
          await vault.connect(signer).withdrawAll();

          const stateFinal = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
          console.log("stateFinal", stateFinal);

          const initialTotalAmount = parseUnits(DEPOSIT_AMOUNT.toString(), 6).mul(3).div(2);
          const resultTotalAmount = BalancerIntTestUtils.getTotalUsdAmount(stateFinal);

          console.log("resultTotalAmount", resultTotalAmount);
          console.log("initialTotalAmount", initialTotalAmount);
          BalancerIntTestUtils.outputProfitEnterFinal(stateBeforeDeposit, stateFinal);
          expect(resultTotalAmount).gt(initialTotalAmount);
        });
      });
    });
  });

//endregion Integration tests
});