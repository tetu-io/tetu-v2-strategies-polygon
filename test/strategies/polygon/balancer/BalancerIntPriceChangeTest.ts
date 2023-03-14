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
  Misc
} from "../../../../scripts/utils/Misc";
import {BalancerIntTestUtils, IPutInitialAmountsBalancesResults, IState} from "./utils/BalancerIntTestUtils";
import {
  BalancerComposableStableStrategy,
  ControllerV2__factory,
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
import {BigNumber} from "ethers";
import {VaultUtils} from "../../../VaultUtils";
import {parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {MaticHolders} from "../../../../scripts/addresses/MaticHolders";
import {BalancerDaiUsdcUsdtPoolUtils} from "./utils/BalancerDaiUsdcUsdtPoolUtils";
import {LiquidatorUtils} from "./utils/LiquidatorUtils";
import {IPriceOracles, PriceOracleUtils} from "./utils/PriceOracleUtils";
chai.use(chaiAsPromised);

/**
 * Price of borrowed asset is significantly changed.
 * Disable all lending platforms except AAVE3,
 * Set mocked price-source to AAVE3's price oracle for DAI, USDC and USDT to be able to control the prices.
 */
describe('BalancerIntPriceChangeTest', function() {
//region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;
  const PERCENT_CHANGE_PRICES = 2; // 2%

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let addresses: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;

  let priceOracles: IPriceOracles;

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

    priceOracles = await PriceOracleUtils.setupMockedPriceOracleSources(signer, tetuConverterAddress);
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

    interface IChangePricesResults {
      investedAssets0: BigNumber;
      investedAssetsAfterOracles: BigNumber;
      investedAssetsAfterBalancer: BigNumber;
      investedAssetsAfterLiquidatorUsdt: BigNumber;
      investedAssetsAfterLiquidatorAll: BigNumber;
    }

    async function changePrices(
      percent: number,
      skipOracleChanges?: boolean
    ) : Promise<IChangePricesResults> {
      const investedAssets0 = await strategy.callStatic.calcInvestedAssets();

      if (! skipOracleChanges) {
        // change prices ~4% in price oracles
        await PriceOracleUtils.decPriceDai(priceOracles, 4);
        await PriceOracleUtils.incPriceUsdt(priceOracles, 4);
      }
      const investedAssetsAfterOracles = await strategy.callStatic.calcInvestedAssets();

      // change prices ~4% in balancer
      await BalancerDaiUsdcUsdtPoolUtils.swapDaiToUsdt(signer, percent);
      const investedAssetsAfterBalancer = await strategy.callStatic.calcInvestedAssets();

      // change prices ~4% in liquidator
      // add usdt to the pool, reduce USDT price
      await LiquidatorUtils.swapToUsdc(
        signer,
        tools.liquidator.address,
        MaticAddresses.USDT_TOKEN,
        MaticHolders.HOLDER_USDT,
        parseUnits("10000", 6),
        percent
      );
      const investedAssetsAfterLiquidatorUsdt = await strategy.callStatic.calcInvestedAssets();

      // remove DAI from the pool, increase DAI price
      await LiquidatorUtils.swapUsdcTo(
        signer,
        tools.liquidator.address,
        MaticAddresses.DAI_TOKEN, // dai (!)
        MaticHolders.HOLDER_USDC, // usdC (!)
        parseUnits("10000", 6),
        percent
      );
      const investedAssetsAfterLiquidatorAll = await strategy.callStatic.calcInvestedAssets();
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);

      return {
        investedAssets0,
        investedAssetsAfterOracles,
        investedAssetsAfterBalancer,
        investedAssetsAfterLiquidatorUsdt,
        investedAssetsAfterLiquidatorAll
      }
    }

    before(async function () {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const data = await UniversalTestUtils.makeBalancerComposableStableStrategyDeployer(
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

    /**
     * We change both DAI and USDT
     * because after deposit we have either DAI or USDT not-zero amount on strategy balance
     * (but not both)
     */
    describe("DAI and USDT price are reduced a bit", () => {
      it("should change prices in AAVE3 and TC oracles", async () => {
        // prices before
        const daiPriceAave3 = await priceOracles.priceOracleAave3.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceAave3 = await priceOracles.priceOracleAave3.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const daiPriceTC = await priceOracles.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceTC = await priceOracles.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN);

        // reduce prices
        const daiPrice = await priceOracles.daiPriceSource.price();
        const daiNewPrice = daiPrice.mul(90).div(100);
        await priceOracles.daiPriceSource.setPrice(daiNewPrice);
        const daiPrice18 = daiPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC
        const daiNewPrice18 = daiNewPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC

        const usdtPrice = await priceOracles.usdtPriceSource.price();
        const usdtNewPrice = usdtPrice.mul(90).div(100);
        await priceOracles.usdtPriceSource.setPrice(usdtNewPrice);
        const usdtPrice18 = usdtPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC
        const usdtNewPrice18 = usdtNewPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC

        // prices after
        const daiPriceAave31 = await priceOracles.priceOracleAave3.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceAave31 = await priceOracles.priceOracleAave3.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const daiPriceTC1 = await priceOracles.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceTC1 = await priceOracles.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN);

        // compare
        const ret = [
          daiPriceAave3, daiPriceTC, usdtPriceAave3, usdtPriceTC,
          daiPriceAave31, daiPriceTC1, usdtPriceAave31, usdtPriceTC1
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          daiPrice, daiPrice18, usdtPrice, usdtPrice18,
          daiNewPrice, daiNewPrice18, usdtNewPrice, usdtNewPrice18
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
      });
      it("should change prices in Balancer pool", async () => {
        const r = await BalancerDaiUsdcUsdtPoolUtils.swapDaiToUsdt(
          signer,
          PERCENT_CHANGE_PRICES,
          2
        );
        const ret = [
          r.priceRatioSourceAsset18.gt(Misc.ONE18),
          r.pricesRatioTargetAsset18.gt(Misc.ONE18),
          // r.pricesRatioTargetAsset18.mul(r.priceRatioSourceAsset18).mul(100).div(Misc.ONE18).div(Misc.ONE18)
        ].join();
        const expected = [
          false,
          true,
          // 100 // 100.678 ~ 100
        ].join();

        expect(ret).eq(expected);
      });
      describe("Deposit, reduce price, check state", () => {
        it("should return expected values", async () => {
          await enterToVault();

          // let's put additional amounts on strategy balance to enable swap in calcInvestedAssets
          await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_DAI))
            .transfer(strategy.address, parseUnits("10000", 18));
          await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDT))
            .transfer(strategy.address, parseUnits("10000", 6));

          // change prices
          const stateBefore = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
          const r = await changePrices(PERCENT_CHANGE_PRICES);
          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          // check states
          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);

          console.log("investedAssetsBefore", r.investedAssets0);
          console.log("investedAssetsAfter1 (price oracles)", r.investedAssetsAfterOracles);
          console.log("investedAssetsAfter2 (balancer)", r.investedAssetsAfterBalancer);
          console.log("investedAssetsAfter3 (liquidator, usdt only)", r.investedAssetsAfterLiquidatorUsdt);
          console.log("investedAssetsAfter4 (liquidator)", r.investedAssetsAfterLiquidatorAll);

          const ret = [
            r.investedAssetsAfterOracles.eq(r.investedAssets0),
            r.investedAssetsAfterBalancer.eq(r.investedAssetsAfterOracles),
            r.investedAssetsAfterLiquidatorAll.eq(r.investedAssetsAfterOracles)
          ].join();

          const expected = [false, false, false].join();
          expect(ret).eq(expected);
        });
      });
    });

    describe("Reduce share price after price changing", () => {
      describe("Deposit", () => {
        it("should reduce sharePrice, small deposit", async () => {
          const stateInitial = await enterToVault();

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state)
          }
          const stateBefore = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "before");

          // prices were changed, but calcInvestedAssets were not called
          await changePrices(PERCENT_CHANGE_PRICES);

          // await strategy.updateInvestedAssets();

          // let's deposit $1 - calcInvestedAssets will be called
          await IERC20__factory.connect(
            MaticAddresses.USDC_TOKEN,
            await Misc.impersonate(MaticHolders.HOLDER_USDC)
          ).transfer(user.address, parseUnits("1", 6));
          await VaultUtils.deposit(user, vault, parseUnits("1", 6));

          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "after");

          console.log("State before", stateBefore);
          console.log("State after", stateAfter);

          console.log("Share price before", stateBefore.vault.sharePrice.toString());
          console.log("Share price after", stateAfter.vault.sharePrice.toString());

          await BalancerIntTestUtils.saveListStatesToCSVColumns(
            "./tmp/pc_deposit_small.csv",
            [stateBefore, stateAfter]
          );

          const ret = [
            stateAfter.vault.sharePrice.lt(stateBefore.vault.sharePrice),
            stateAfter.insurance.usdc.gt(stateBefore.insurance.usdc)
          ].join();
          const expected = [true, true].join();
          expect(ret).eq(expected);
        });
        it("should reduce sharePrice, huge deposit", async () => {
          await enterToVault();

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state)
          }
          const stateBefore = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "before");

          // prices were changed, but calcInvestedAssets were not called
          await changePrices(PERCENT_CHANGE_PRICES);

          // await strategy.updateInvestedAssets();

          // let's deposit $1 - calcInvestedAssets will be called
          await IERC20__factory.connect(
            MaticAddresses.USDC_TOKEN,
            await Misc.impersonate(MaticHolders.HOLDER_USDC)
          ).transfer(user.address, parseUnits("50000", 6));
          await VaultUtils.deposit(user, vault, parseUnits("50000", 6));

          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "after");

          console.log("State before", stateBefore);
          console.log("State after", stateAfter);

          console.log("Share price before", stateBefore.vault.sharePrice.toString());
          console.log("Share price after", stateAfter.vault.sharePrice.toString());

          await BalancerIntTestUtils.saveListStatesToCSVColumns(
            "./tmp/pc_deposit_huge.csv",
            [stateBefore, stateAfter]
          );

          const ret = [
            stateAfter.vault.sharePrice.lt(stateBefore.vault.sharePrice),
            stateAfter.insurance.usdc.gt(stateBefore.insurance.usdc)
          ].join();
          const expected = [true, true].join();
          expect(ret).eq(expected);
        });
      });
      describe("Withdraw almost most allowed amount", () => {
        it("should reduce sharePrice", async () => {
          const stateInitial = await enterToVault();
          console.log("stateInitial", stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state)
          }
          const stateBefore = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "before");

          // prices were changed, invested assets amount is reduced, but calcInvestedAssets is not called
          await changePrices(PERCENT_CHANGE_PRICES);

          // we need to force vault to withdraw some amount from the strategy
          // so let's ask to withdraw ALMOST all amount from vault's balance
          // calcInvestedAssets will be called after the withdrawal
          const assets = await vault.convertToAssets(await vault.balanceOf(user.address));
          // todo const amountToWithdraw = (await vault.maxWithdraw(user.address)).sub(parseUnits("1", 6));
          const amountToWithdraw = assets.mul(DENOMINATOR-WITHDRAW_FEE).div(DENOMINATOR).sub(parseUnits("1", 6));
          console.log("amountToWithdraw", amountToWithdraw);
          await vault.connect(user).withdraw(amountToWithdraw, user.address, user.address);

          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "after");

          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);
          console.log("Share price before", stateBefore.vault.sharePrice.toString());
          console.log("Share price after", stateAfter.vault.sharePrice.toString());

          await BalancerIntTestUtils.saveListStatesToCSVColumns(
            "./tmp/pc_withdraw.csv",
            [stateBefore, stateAfter]
          );

          const ret = [
            stateAfter.vault.sharePrice.lt(stateBefore.vault.sharePrice),
            stateAfter.insurance.usdc.gt(stateBefore.insurance.usdc)
          ].join();
          const expected = [true, true].join();
          expect(ret).eq(expected);
        });
      });
      describe("WithdrawAll", () => {
        it("should reduce sharePrice", async () => {
          const stateInitial = await enterToVault();
          console.log("stateInitial", stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state)
          }
          const stateBefore = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "before");

          // prices were changed, invested assets amount is reduced, but calcInvestedAssets is not called
          await changePrices(PERCENT_CHANGE_PRICES);

          await vault.connect(user).withdrawAll();

          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault, "after");

          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);
          console.log("Share price before", stateBefore.vault.sharePrice.toString());
          console.log("Share price after", stateAfter.vault.sharePrice.toString());

          await BalancerIntTestUtils.saveListStatesToCSVColumns(
            "./tmp/pc_withdraw_all.csv",
            [stateBefore, stateAfter]
          );

          const ret = [
            stateAfter.vault.sharePrice.lt(stateBefore.vault.sharePrice),
            stateAfter.insurance.usdc.gt(stateBefore.insurance.usdc)
          ].join();
          const expected = [true, true].join();
          expect(ret).eq(expected);
        });
      });
//       describe("Hardwork", () => {
//         it("should return expected values", async () => {
// // todo
//         });
//       });
    });
  });

//endregion Integration tests
});
