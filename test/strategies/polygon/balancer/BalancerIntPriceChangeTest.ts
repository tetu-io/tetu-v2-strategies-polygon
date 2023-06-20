import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { UniversalTestUtils } from '../../../baseUT/utils/UniversalTestUtils';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import {getConverterAddress, getDForcePlatformAdapter, Misc} from '../../../../scripts/utils/Misc';
import {
  BalancerBoostedStrategy, BalancerBoostedStrategy__factory,
  ControllerV2__factory,
  IERC20__factory, IERC20Metadata__factory,
  ISplitter,
  ISplitter__factory,
  IStrategyV2,
  ITetuLiquidator,
  TetuVaultV2,
} from '../../../../typechain';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { ICoreContractsWrapper } from '../../../CoreContractsWrapper';
import { IToolsContractsWrapper } from '../../../ToolsContractsWrapper';
import {BigNumber, Signer} from 'ethers';
import { VaultUtils } from '../../../VaultUtils';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import { BalanceUtils } from '../../../baseUT/utils/BalanceUtils';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { MaticHolders } from '../../../../scripts/addresses/MaticHolders';
import { BalancerBoostedTetuUsdUtils } from './utils/BalancerBoostedTetuUsdUtils';
import { LiquidatorUtils } from './utils/LiquidatorUtils';
import { PriceOracleManagerUtils } from '../../../baseUT/converter/PriceOracleManagerUtils';
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {IPutInitialAmountsBalancesResults, StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {Provider} from "@ethersproject/providers";
import {IPriceOracleManager} from "../../../baseUT/converter/PriceOracleManager";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {IStateNum, IStateParams, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {FixPriceChangesEvents} from "../../../baseUT/utils/fixPriceChangesEvents";

chai.use(chaiAsPromised);

/**
 * Price of borrowed asset is significantly changed.
 * Disable all lending platforms except AAVE3,
 * Set mocked price-source to AAVE3's price oracle for DAI, USDC and USDT to be able to control the prices.
 *
 * Integration time-consuming tests, so @skip-on-coverage
 */
describe('BalancerIntPriceChangeTest @skip-on-coverage', function() {
  //region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;
  const pool: string = MaticAddresses.BALANCER_POOL_T_USD;
  const PERCENT_CHANGE_PRICES = 2; // 2%

  const deployInfo: DeployInfo = new DeployInfo();

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let core: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;
  let priceOracleManager: IPriceOracleManager;

  let stateParams: IStateParams;

  //endregion Constants and variables

  //region before, after
  before(async function() {
    signer = await DeployerUtilsLocal.impersonate(); // governance by default
    user = (await ethers.getSigners())[1];

    snapshotBefore = await TimeUtils.snapshot();

    const deployCoreContracts = true;
    await StrategyTestUtils.deployCoreAndInit(deployInfo, deployCoreContracts);

    core = Addresses.getCore();
    tetuConverterAddress = getConverterAddress();

    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await StrategyTestUtils.deployAndSetCustomSplitter(signer, core);
    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));

    await LiquidatorUtils.addBlueChipsPools(signer, core.controller, deployInfo.tools?.liquidator);
    stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MAIN_ASSET, signer).symbol()
    }
    priceOracleManager = await PriceOracleManagerUtils.build(signer, tetuConverterAddress);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
  //endregion before, after

  //region Integration tests
  describe('Single strategy with fees', () => {
    const COMPOUND_RATIO = 50_000;
    const REINVEST_THRESHOLD_PERCENT = 1_000;
    const DEPOSIT_AMOUNT = 100_000;
    const DEPOSIT_FEE = 0; // 100_000
    const BUFFER = 1_00; // 100_000
    const WITHDRAW_FEE = 0; // 100_000
    const DENOMINATOR = 100_000;
    const TARGET = MaticAddresses.USDC_TOKEN;

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let ccw: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: BalancerBoostedStrategy;
    let asset: string;
    let splitter: ISplitter;
    let stateBeforeDeposit: IStateNum;
    let initialBalances: IPutInitialAmountsBalancesResults;
    let forwarder: string;

    /**
     * DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
     */
    async function enterToVault(): Promise<IStateNum> {
      await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);
      await VaultUtils.deposit(user, vault, initialBalances.balanceUser);
      await UniversalTestUtils.removeExcessTokens(asset, user, tools.liquidator.address);
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);
      return StateUtilsNum.getState(signer, user, strategy, vault);
    }

    interface IChangePricesResults {
      investedAssets0: BigNumber;
      investedAssetsAfterOracles: BigNumber;
      investedAssetsAfterBalancer: BigNumber;
      investedAssetsAfterLiquidatorUsdt: BigNumber;
      investedAssetsAfterLiquidatorAll: BigNumber;
    }

    async function decreaseInvestedAssets(percent: number, skipOracleChanges?: boolean): Promise<IChangePricesResults> {
      const strategyAsOperator = strategy.connect(
        await UniversalTestUtils.getAnOperator(strategy.address, signer)
      );
      const investedAssets0 = await strategyAsOperator.callStatic.calcInvestedAssets();

      if (!skipOracleChanges) {
        // change prices ~4% in price oracles
        await priceOracleManager.decPrice(MaticAddresses.DAI_TOKEN, 4);
        await priceOracleManager.incPrice(MaticAddresses.USDT_TOKEN, 4);
      }
      const investedAssetsAfterOracles = await strategyAsOperator.callStatic.calcInvestedAssets();
      // change prices ~4% in balancer
      await BalancerBoostedTetuUsdUtils.swapDaiToUsdt(signer, percent);
      const investedAssetsAfterBalancer = await strategyAsOperator.callStatic.calcInvestedAssets();
      // change prices ~4% in liquidator
      // increase USDT price
      await LiquidatorUtils.swapToUsdc(
        signer,
        tools.liquidator.address,
        MaticAddresses.USDT_TOKEN,
        MaticHolders.HOLDER_USDT,
        parseUnits('10000', 6),
        percent,
      );
      const investedAssetsAfterLiquidatorUsdt = await strategyAsOperator.callStatic.calcInvestedAssets();

      // reduce DAI price
      await LiquidatorUtils.swapUsdcTo(
        signer,
        tools.liquidator.address,
        MaticAddresses.DAI_TOKEN, // dai (!)
        MaticHolders.HOLDER_USDC, // usdC (!)
        parseUnits('10000', 6),
        percent,
      );
      const investedAssetsAfterLiquidatorAll = await strategyAsOperator.callStatic.calcInvestedAssets();
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);
      return {
        investedAssets0,
        investedAssetsAfterOracles,
        investedAssetsAfterBalancer,
        investedAssetsAfterLiquidatorUsdt,
        investedAssetsAfterLiquidatorAll,
      };
    }
    async function increaseInvestedAssets(percent: number, skipOracleChanges?: boolean): Promise<IChangePricesResults> {
      const strategyAsOperator = strategy.connect(
        await UniversalTestUtils.getAnOperator(strategy.address, signer)
      );
      const investedAssets0 = await strategyAsOperator.callStatic.calcInvestedAssets();

      if (!skipOracleChanges) {
        await priceOracleManager.incPrice(MaticAddresses.USDT_TOKEN, percent);
        await priceOracleManager.incPrice(MaticAddresses.DAI_TOKEN, percent);
      }
      const investedAssetsAfterOracles = await strategyAsOperator.callStatic.calcInvestedAssets();
      // change prices ~4% in balancer
      await BalancerBoostedTetuUsdUtils.swapDaiToUsdt(signer, percent);
      const investedAssetsAfterBalancer = await strategyAsOperator.callStatic.calcInvestedAssets();
      // remove USDT from the pool, increase USDT price
      await LiquidatorUtils.swapUsdcTo(
        signer,
        tools.liquidator.address,
        MaticAddresses.USDT_TOKEN,
        MaticHolders.HOLDER_USDC,
        parseUnits('1000000', 6),
        percent,
      );
      const investedAssetsAfterLiquidatorUsdt = await strategyAsOperator.callStatic.calcInvestedAssets();
      // remove DAI from the pool, increase DAI price
      await LiquidatorUtils.swapUsdcTo(
        signer,
        tools.liquidator.address,
        MaticAddresses.DAI_TOKEN,
        MaticHolders.HOLDER_USDC,
        parseUnits('1000000', 6),
        percent,
      );
      const investedAssetsAfterLiquidatorAll = await strategyAsOperator.callStatic.calcInvestedAssets();

      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);
      return {
        investedAssets0,
        investedAssetsAfterOracles,
        investedAssetsAfterBalancer,
        investedAssetsAfterLiquidatorUsdt,
        investedAssetsAfterLiquidatorAll,
      };
    }

    before(async function() {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      ccw = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const data = await UniversalTestUtils.makeStrategyDeployer(
        signer,
        core,
        TARGET,
        tetuConverterAddress,
        'BalancerBoostedStrategy',
        async(strategyProxy: string, signerOrProvider: Signer | Provider, splitterAddress: string) => {
          const strategyContract = BalancerBoostedStrategy__factory.connect(strategyProxy, signer);
          await strategyContract.init(core.controller, splitterAddress, tetuConverterAddress, pool, MaticAddresses.BALANCER_GAUGE_V2_T_USD);
          return strategyContract as unknown as IStrategyV2;
        },
        {
          depositFee: DEPOSIT_FEE,
          buffer: BUFFER,
          withdrawFee: WITHDRAW_FEE,
        },
      );

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy as unknown as BalancerBoostedStrategy;
      await ConverterUtils.addToWhitelist(signer, tetuConverterAddress, strategy.address);
      splitter = ISplitter__factory.connect(await vault.splitter(), signer);
      forwarder = await ControllerV2__factory.connect(await vault.controller(), signer).forwarder();
      console.log('vault', vault.address);
      console.log('strategy', strategy.address);
      console.log('splitter', splitter.address);
      console.log('forwarder', forwarder);

      await UniversalTestUtils.setCompoundRatio(strategy as unknown as IStrategyV2, user, COMPOUND_RATIO);
      await StrategyTestUtils.setThresholds(
        strategy as unknown as IStrategyV2,
        user,
        { reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT },
      );

      initialBalances = await StrategyTestUtils.putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      // add some amount to insurance
      await BalanceUtils.getAmountFromHolder(
        MaticAddresses.USDC_TOKEN,
        MaticHolders.HOLDER_USDC,
        await vault.insurance(),
        parseUnits("1000", 6)
      );

      stateBeforeDeposit = await StateUtilsNum.getState(signer, user, strategy, vault);
    });

    after(async function() {
      await TimeUtils.rollback(localSnapshotBefore);
    });

    beforeEach(async function() {
      localSnapshot = await TimeUtils.snapshot();
    });

    afterEach(async function() {
      await TimeUtils.rollback(localSnapshot);
    });

    /**
     * We change both DAI and USDT
     * because after deposit we have either DAI or USDT not-zero amount on strategy balance
     * (but not both)
     */
    describe('DAI and USDT price are reduced a bit', () => {
      it('should change prices in AAVE3 and TC oracles', async() => {
        // prices before
        const daiPriceAave3 = await priceOracleManager.priceOracleAave3.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceAave3 = await priceOracleManager.priceOracleAave3.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const daiPriceTC = await priceOracleManager.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceTC = await priceOracleManager.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN);

        // reduce prices
        const daiPrice = await priceOracleManager.sourceInfo(MaticAddresses.DAI_TOKEN).priceOriginal;
        const daiNewPrice = daiPrice.mul(90).div(100);
        await priceOracleManager.setPrice(MaticAddresses.DAI_TOKEN, daiNewPrice);
        const daiPrice18 = daiPrice.mul(parseUnits('1', 10)); // see PriceOracle impl in TC
        const daiNewPrice18 = daiNewPrice.mul(parseUnits('1', 10)); // see PriceOracle impl in TC

        const usdtPrice = await priceOracleManager.sourceInfo(MaticAddresses.USDT_TOKEN).priceOriginal;
        const usdtNewPrice = usdtPrice.mul(90).div(100);
        await priceOracleManager.setPrice(MaticAddresses.USDT_TOKEN, usdtNewPrice);
        const usdtPrice18 = usdtPrice.mul(parseUnits('1', 10)); // see PriceOracle impl in TC
        const usdtNewPrice18 = usdtNewPrice.mul(parseUnits('1', 10)); // see PriceOracle impl in TC

        // prices after
        const daiPriceAave31 = await priceOracleManager.priceOracleAave3.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceAave31 = await priceOracleManager.priceOracleAave3.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const daiPriceTC1 = await priceOracleManager.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceTC1 = await priceOracleManager.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN);

        // compare
        const ret = [
          daiPriceAave3, daiPriceTC, usdtPriceAave3, usdtPriceTC,
          daiPriceAave31, daiPriceTC1, usdtPriceAave31, usdtPriceTC1,
        ].map(x => BalanceUtils.toString(x)).join('\n');
        const expected = [
          daiPrice, daiPrice18, usdtPrice, usdtPrice18,
          daiNewPrice, daiNewPrice18, usdtNewPrice, usdtNewPrice18,
        ].map(x => BalanceUtils.toString(x)).join('\n');

        expect(ret).eq(expected);
      });
      it('swapDaiToUsdt should change prices in Balancer Boosted Tetu USD', async() => {
        const r = await BalancerBoostedTetuUsdUtils.swapDaiToUsdt(
          signer,
          PERCENT_CHANGE_PRICES,
          2,
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
      it('swapUsdcToDai should change prices in Balancer Boosted Tetu USD', async() => {
        const r = await BalancerBoostedTetuUsdUtils.swapUsdcToDai(
          signer,
          PERCENT_CHANGE_PRICES,
          2,
        );
        const ret = [
          r.priceRatioSourceAsset18.gt(Misc.ONE18),
          r.pricesRatioTargetAsset18.gt(Misc.ONE18),
        ].join();
        const expected = [
          false,
          true,
        ].join();

        expect(ret).eq(expected);
      });
      it('swapUsdcToUsdt should change prices in Balancer Boosted Tetu USD', async() => {
        const r = await BalancerBoostedTetuUsdUtils.swapUsdcToUsdt(
          signer,
          PERCENT_CHANGE_PRICES,
          2,
        );
        const ret = [
          r.priceRatioSourceAsset18.gt(Misc.ONE18),
          r.pricesRatioTargetAsset18.gt(Misc.ONE18),
        ].join();
        const expected = [
          false,
          true,
        ].join();

        expect(ret).eq(expected);
      });
      describe('Deposit, reduce price, check state', () => {
        it('should return expected values', async() => {
          await enterToVault();

          // let's put additional amounts on strategy balance to enable swap in calcInvestedAssets
          await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_DAI))
            .transfer(strategy.address, parseUnits('10000', 18));
          await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDT))
            .transfer(strategy.address, parseUnits('10000', 6));

          // change prices
          const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault);
          const r = await decreaseInvestedAssets(PERCENT_CHANGE_PRICES);
          const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault);

          // check states
          console.log('stateBefore', stateBefore);
          console.log('stateAfter', stateAfter);

          console.log('investedAssetsBefore', r.investedAssets0);
          console.log('investedAssetsAfter1 (price oracles)', r.investedAssetsAfterOracles);
          console.log('investedAssetsAfter2 (balancer)', r.investedAssetsAfterBalancer);
          console.log('investedAssetsAfter3 (liquidator, usdt only)', r.investedAssetsAfterLiquidatorUsdt);
          console.log('investedAssetsAfter4 (liquidator)', r.investedAssetsAfterLiquidatorAll);

          const ret = [
            r.investedAssetsAfterOracles.eq(r.investedAssets0),
            r.investedAssetsAfterBalancer.eq(r.investedAssetsAfterOracles),
            r.investedAssetsAfterLiquidatorAll.eq(r.investedAssetsAfterOracles),
          ].join();

          const expected = [false, false, false].join();
          expect(ret).eq(expected);
        });
      });
    });

    describe('Change invested-assets-amount by price changing', () => {
      describe('Deposit', () => {
        describe("invested-assets-amount was reduced", () => {
          it('should not change sharePrice, small deposit', async () => {
            const stateInitial = await enterToVault();

            // let's allow strategy to invest all available amount
            for (let i = 0; i < 3; ++i) {
              await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
              const state = await StateUtilsNum.getState(signer, user, strategy, vault);
              console.log(`state ${i}`, state);
            }
            const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

            // prices were changed, but calcInvestedAssets were not called
            await decreaseInvestedAssets(PERCENT_CHANGE_PRICES);

            // await strategy.updateInvestedAssets();

            // let's deposit $1 - calcInvestedAssets will be called
            await IERC20__factory.connect(
              MaticAddresses.USDC_TOKEN,
              await Misc.impersonate(MaticHolders.HOLDER_USDC),
            ).transfer(user.address, parseUnits('1', 6));

            const tx = await VaultUtils.deposit(user, vault, parseUnits('1', 6));
            const cr = await tx.wait();
            const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

            const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

            console.log('State before', stateBefore);
            console.log('State after', stateAfter);

            console.log('Share price before', stateBefore.vault.sharePrice.toString());
            console.log('Share price after', stateAfter.vault.sharePrice.toString());

            await StateUtilsNum.saveListStatesToCSVColumns(
              './tmp/pc_deposit_small.csv',
              [stateBefore, stateAfter],
              stateParams
            );

            const deltaInsurance = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;
            const deltaInvestedAssets = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;

            expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1e-5);
            expect(stateAfter.fixPriceChanges?.assetAfter).lt(stateAfter.fixPriceChanges?.assetBefore, "Ensure invested assets amount was reduced by price changing");
            expect(deltaInsurance).lt(0);
            expect(deltaInsurance).eq(deltaInvestedAssets);
            expect(
              stateBefore.user.assetBalance
              + stateBefore.strategy.investedAssets
              + stateBefore.strategy.assetBalance
              + stateBefore.vault.assetBalance
              + 1 // deposited amount
            ).approximately(
              stateAfter.user.assetBalance
              + stateAfter.strategy.investedAssets
              + stateAfter.strategy.assetBalance
              + stateAfter.vault.assetBalance,
              1e-5
            );
          });
          it('should not change sharePrice, huge deposit', async () => {
            await enterToVault();

            // let's allow strategy to invest all available amount
            for (let i = 0; i < 3; ++i) {
              await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
              const state = await StateUtilsNum.getState(signer, user, strategy, vault);
              console.log(`state ${i}`, state);
            }
            const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

            // prices were changed, but calcInvestedAssets were not called
            await decreaseInvestedAssets(PERCENT_CHANGE_PRICES);

            // let's deposit $1 - calcInvestedAssets will be called
            await IERC20__factory.connect(
              MaticAddresses.USDC_TOKEN,
              await Misc.impersonate(MaticHolders.HOLDER_USDC),
            ).transfer(user.address, parseUnits('50000', 6));

            const tx = await VaultUtils.deposit(user, vault, parseUnits('50000', 6));
            const cr = await tx.wait();
            const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

            const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

            console.log('State before', stateBefore);
            console.log('State after', stateAfter);

            console.log('Share price before', stateBefore.vault.sharePrice.toString());
            console.log('Share price after', stateAfter.vault.sharePrice.toString());

            await StateUtilsNum.saveListStatesToCSVColumns(
              './tmp/pc_deposit_huge.csv',
              [stateBefore, stateAfter],
              stateParams
            );

            const deltaInsurance = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;
            const deltaInvestedAssets = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;

            expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1e-5);
            expect(stateAfter.fixPriceChanges?.assetAfter).lt(stateAfter.fixPriceChanges?.assetBefore, "Ensure invested assets amount was increased by price changing");
            expect(deltaInsurance).lt(0);
            expect(deltaInsurance).eq(deltaInvestedAssets);
            expect(
              stateBefore.user.assetBalance
              + stateBefore.strategy.investedAssets
              + stateBefore.strategy.assetBalance
              + stateBefore.vault.assetBalance
              + 50000 // deposited amount
            ).approximately(
              stateAfter.user.assetBalance
              + stateAfter.strategy.investedAssets
              + stateAfter.strategy.assetBalance
              + stateAfter.vault.assetBalance,
              1e-3
            );
          });
        });
        describe("invested-assets-amount was increased", () => {
          it('should not change sharePrice, small deposit', async () => {
            const stateInitial = await enterToVault();

            // let's allow strategy to invest all available amount
            for (let i = 0; i < 3; ++i) {
              await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
              const state = await StateUtilsNum.getState(signer, user, strategy, vault);
              console.log(`state ${i}`, state);
            }
            const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

            // prices were changed, but calcInvestedAssets were not called
            await increaseInvestedAssets(PERCENT_CHANGE_PRICES);

            // await strategy.updateInvestedAssets();

            // let's deposit $1 - calcInvestedAssets will be called
            await IERC20__factory.connect(
              MaticAddresses.USDC_TOKEN,
              await Misc.impersonate(MaticHolders.HOLDER_USDC),
            ).transfer(user.address, parseUnits('1', 6));

            const tx = await VaultUtils.deposit(user, vault, parseUnits('1', 6));
            const cr = await tx.wait();
            const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

            const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

            console.log('State before', stateBefore);
            console.log('State after', stateAfter);

            console.log('Share price before', stateBefore.vault.sharePrice.toString());
            console.log('Share price after', stateAfter.vault.sharePrice.toString());

            await StateUtilsNum.saveListStatesToCSVColumns(
              './tmp/pc_deposit_small_inc.csv',
              [stateBefore, stateAfter],
              stateParams
            );

            const deltaInsurance = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;
            const deltaInvestedAssets = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;

            expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1e-5);
            expect(stateAfter.fixPriceChanges?.assetAfter).gt(stateAfter.fixPriceChanges?.assetBefore, "Ensure invested assets amount was increased by price changing");
            expect(deltaInsurance).gt(0);
            expect(deltaInsurance).eq(deltaInvestedAssets);
            expect(
              stateBefore.user.assetBalance
              + stateBefore.strategy.investedAssets
              + stateBefore.strategy.assetBalance
              + stateBefore.vault.assetBalance
              + 1 // deposited amount
            ).approximately(
              stateAfter.user.assetBalance
              + stateAfter.strategy.investedAssets
              + stateAfter.strategy.assetBalance
              + stateAfter.vault.assetBalance,
              1e-5
            );
          });
          it('should not change sharePrice, huge deposit', async () => {
            await enterToVault();

            // let's allow strategy to invest all available amount
            for (let i = 0; i < 3; ++i) {
              await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
              const state = await StateUtilsNum.getState(signer, user, strategy, vault);
              console.log(`state ${i}`, state);
            }
            const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

            // prices were changed, but calcInvestedAssets were not called
            await increaseInvestedAssets(PERCENT_CHANGE_PRICES);

            // await strategy.updateInvestedAssets();

            // let's deposit $1 - calcInvestedAssets will be called
            await IERC20__factory.connect(
              MaticAddresses.USDC_TOKEN,
              await Misc.impersonate(MaticHolders.HOLDER_USDC),
            ).transfer(user.address, parseUnits('50000', 6));

            const tx = await VaultUtils.deposit(user, vault, parseUnits('50000', 6));
            const cr = await tx.wait();
            const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

            const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

            console.log('State before', stateBefore);
            console.log('State after', stateAfter);

            console.log('Share price before', stateBefore.vault.sharePrice.toString());
            console.log('Share price after', stateAfter.vault.sharePrice.toString());

            await StateUtilsNum.saveListStatesToCSVColumns(
              './tmp/pc_deposit_huge_inc.csv',
              [stateBefore, stateAfter],
              stateParams
            );

            const deltaInsurance = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;
            const deltaInvestedAssets = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;

            expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1e-5);
            expect(stateAfter.fixPriceChanges?.assetAfter).gt(stateAfter.fixPriceChanges?.assetBefore, "Ensure invested assets amount was increased by price changing");
            expect(deltaInsurance).gt(0);
            expect(deltaInsurance).eq(deltaInvestedAssets);
            expect(
              stateBefore.user.assetBalance
              + stateBefore.strategy.investedAssets
              + stateBefore.strategy.assetBalance
              + stateBefore.vault.assetBalance
              + 50000 // deposited amount
            ).approximately(
              stateAfter.user.assetBalance
              + stateAfter.strategy.investedAssets
              + stateAfter.strategy.assetBalance
              + stateAfter.vault.assetBalance,
              1e-2
            );
          });
        });
      });
      describe('Withdraw almost most allowed amount', () => {
        it('should reduce sharePrice', async() => {
          const stateInitial = await enterToVault();
          console.log('stateInitial', stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtilsNum.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

          // prices were changed, invested assets amount is reduced, but calcInvestedAssets is not called
          await decreaseInvestedAssets(PERCENT_CHANGE_PRICES);

          // we need to force vault to withdraw some amount from the strategy
          // so let's ask to withdraw ALMOST all amount from vault's balance
          // calcInvestedAssets will be called after the withdrawal
          const assets = await vault.convertToAssets(await vault.balanceOf(user.address));
          // todo const amountToWithdraw = (await vault.maxWithdraw(user.address)).sub(parseUnits("1", 6));
          const amountToWithdraw = assets.mul(DENOMINATOR - WITHDRAW_FEE).div(DENOMINATOR).sub(parseUnits('1', 6));
          console.log('amountToWithdraw', amountToWithdraw);

          const tx = await vault.connect(user).withdraw(amountToWithdraw, user.address, user.address);
          const cr = await tx.wait();
          const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

          const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

          console.log('stateBefore', stateBefore);
          console.log('stateAfter', stateAfter);
          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtilsNum.saveListStatesToCSVColumns(
            './tmp/pc_withdraw.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1);
          // const ret = [
          //   stateAfter.vault.sharePrice.lt(stateBefore.vault.sharePrice),
          //   stateAfter.insurance.assetBalance.gt(stateBefore.insurance.assetBalance),
          // ].join();
          // const expected = [true, true].join();
          // expect(ret).eq(expected);
        });
      });
      describe('WithdrawAll', () => {
        it('should not change sharePrice when invested-assets-amount was reduced', async() => {
          const stateInitial = await enterToVault();
          console.log('stateInitial', stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtilsNum.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

          // prices were changed, invested assets amount is reduced, but calcInvestedAssets is not called
          await decreaseInvestedAssets(PERCENT_CHANGE_PRICES);

          const tx = await vault.connect(user).withdrawAll();
          const cr = await tx.wait();
          const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

          const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

          console.log('stateBefore', stateBefore);
          console.log('stateAfter', stateAfter);
          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtilsNum.saveListStatesToCSVColumns(
            './tmp/pc_withdraw_all_dec.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          const deltaInsurance = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;
          const deltaInvestedAssets = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;

          expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1e-5);
          expect(stateAfter.fixPriceChanges?.assetAfter).lt(stateAfter.fixPriceChanges?.assetBefore, "Ensure invested assets amount was reduced by price changing");
          expect(deltaInsurance).lt(0);
          expect(deltaInsurance).eq(deltaInvestedAssets);
          expect(
            stateBefore.user.assetBalance
            + stateBefore.strategy.investedAssets
            + stateBefore.strategy.assetBalance
            + stateBefore.vault.assetBalance
          ).approximately(
            stateAfter.user.assetBalance
            + stateAfter.strategy.investedAssets
            + stateAfter.strategy.assetBalance
            + stateAfter.vault.assetBalance,
            1e-5
          );
        });
        it('should not change sharePrice when invested-assets-amount was increased', async() => {
          const stateInitial = await enterToVault();
          console.log('stateInitial', stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtilsNum.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtilsNum.getState(signer, user, strategy, vault, 'before');

          // prices were changed, invested assets amount is increased, but calcInvestedAssets is not called
          await increaseInvestedAssets(PERCENT_CHANGE_PRICES);

          const tx = await vault.connect(user).withdrawAll();
          const cr = await tx.wait();
          const events = await FixPriceChangesEvents.handleReceiptWithdrawDepositHardwork(cr, 6);

          const stateAfter = await StateUtilsNum.getState(signer, user, strategy, vault, 'after', events);

          console.log('stateBefore', stateBefore);
          console.log('stateAfter', stateAfter);
          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtilsNum.saveListStatesToCSVColumns(
            './tmp/pc_withdraw_all_inc.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          const deltaInsurance = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;
          const deltaInvestedAssets = stateAfter.insurance.assetBalance - stateBefore.insurance.assetBalance;

          expect(stateAfter.vault.sharePrice).approximately(stateBefore.vault.sharePrice, 1e-5);
          expect(stateAfter.fixPriceChanges?.assetAfter).gt(stateAfter.fixPriceChanges?.assetBefore, "Ensure invested assets amount was increased by price changing");
          expect(deltaInsurance).gt(0);
          expect(deltaInsurance).eq(deltaInvestedAssets);
          expect(
            stateBefore.user.assetBalance
            + stateBefore.strategy.investedAssets
            + stateBefore.strategy.assetBalance
            + stateBefore.vault.assetBalance
          ).approximately(
            stateAfter.user.assetBalance
            + stateAfter.strategy.investedAssets
            + stateAfter.strategy.assetBalance
            + stateAfter.vault.assetBalance,
            1e-5
          );
        });
      });
    });
  });

  //endregion Integration tests
});
