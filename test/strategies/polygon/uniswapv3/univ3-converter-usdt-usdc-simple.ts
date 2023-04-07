import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { ethers } from 'hardhat';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  ControllerV2__factory,
  IController__factory,
  IERC20__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IStrategyV2,
  StrategyBaseV2__factory,
  StrategySplitterV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
} from '../../../../typechain';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { Misc } from '../../../../scripts/utils/Misc';
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { UniswapV3StrategyUtils } from '../../../UniswapV3StrategyUtils';
import {
  depositToVault,
  doHardWorkForStrategy,
  rebalanceUniv3Strategy,
  redeemFromVault,
} from '../../../StrategyTestUtils';
import { IPriceOracles, PriceOracleUtils } from '../balancer/utils/PriceOracleUtils';
import { VaultUtils } from '../../../VaultUtils';
import { BigNumber } from 'ethers';


const { expect } = chai;

describe('univ3-converter-usdt-usdc-simple', function() {

  let snapshotBefore: string;
  let snapshot: string;

  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  let core: CoreAddresses;
  let strategy: UniswapV3ConverterStrategy;
  let vault: TetuVaultV2;
  let insurance: string;
  let splitter: StrategySplitterV2;
  let pool: string;
  let asset: string;
  let assetCtr: IERC20Metadata;
  let decimals: number;
  let priceOracles: IPriceOracles;


  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);

    core = Addresses.getCore() as CoreAddresses;
    pool = MaticAddresses.UNISWAPV3_USDC_USDT_100;
    asset = MaticAddresses.USDC_TOKEN;
    assetCtr = IERC20Metadata__factory.connect(asset, signer);
    decimals = await IERC20Metadata__factory.connect(asset, gov).decimals();

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset,
      'TetuV2_UniswapV3_USDC-USDT-0.01%',
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          MaticAddresses.TETU_CONVERTER,
          pool,
          0,
          0,
        );

        return _strategy as unknown as IStrategyV2;
      },
      IController__factory.connect(core.controller, gov),
      gov,
      0,
      300,
      300,
      false,
    );

    vault = data.vault;
    strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    splitter = data.splitter;
    insurance = await vault.insurance();

    // setup converter
    await ConverterUtils.whitelist([strategy.address]);
    priceOracles = await PriceOracleUtils.setupMockedPriceOracleSources(signer, await strategy.converter());

    // ---

    await IERC20__factory.connect(asset, signer).approve(vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(asset, signer2).approve(vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);

    await vault.setWithdrawRequestBlocks(0);
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

  it('strategy specific name', async function() {
    expect(await strategy.strategySpecificName()).eq('UniV3 USDC/USDT-100');
  });

  it('deposit and full exit should not change share price', async function() {
    await vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(asset, signer2.address, BigNumber.from(10000));
    await vault.connect(signer2).deposit(10000, signer2.address);

    const cycles = 3;
    const depositAmount1 = parseUnits('100000', decimals);
    await TokenUtils.getToken(asset, signer.address, depositAmount1.mul(cycles));

    const balanceBefore = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);

    for (let i = 0; i < cycles; i++) {
      console.log('------------------ CYCLE', i, '------------------');

      const sharePriceBefore = await vault.sharePrice();

      ///////////////////////////
      // DEPOSIT
      ///////////////////////////


      await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);

      await VaultUtils.printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );

      expect(await strategy.investedAssets()).above(0);

      const sharePriceAfterDeposit = await vault.sharePrice();
      expect(sharePriceAfterDeposit).eq(sharePriceBefore);

      ///////////////////////////
      // WITHDRAW
      ///////////////////////////

      await redeemFromVault(vault, signer, 50, decimals, assetCtr, insurance);
      await VaultUtils.printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );

      const sharePriceAfterWithdraw = await vault.sharePrice();
      expect(sharePriceAfterWithdraw).approximately(sharePriceAfterDeposit, 100);

      await redeemFromVault(vault, signer, 99, decimals, assetCtr, insurance);
      await VaultUtils.printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );

      const sharePriceAfterWithdraw2 = await vault.sharePrice();
      expect(sharePriceAfterWithdraw2).approximately(sharePriceAfterDeposit, 100);

      await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
      await VaultUtils.printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );

      const sharePriceAfterWithdraw3 = await vault.sharePrice();
      expect(sharePriceAfterWithdraw3).approximately(sharePriceAfterDeposit, 1000);
    }

    const balanceAfter = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);
    console.log('balanceBefore', balanceBefore);
    console.log('balanceAfter', balanceAfter);
    expect(balanceAfter).approximately(balanceBefore - (+formatUnits(depositAmount1, 6) * 0.006 * cycles), cycles);

  });

  it('deposit and exit with hard works should work properly', async function() {
    await strategy.setFuseThreshold(parseUnits('1'));

    const depositAmount1 = parseUnits('1000', decimals);
    await TokenUtils.getToken(asset, signer.address, depositAmount1);
    const swapAmount = parseUnits('500000', decimals);

    const sharePriceBefore = await vault.sharePrice();

    for (let i = 0; i < 3; i++) {
      console.log('------------------ CYCLE', i, '------------------');

      ///////////////////////////
      // DEPOSIT
      ///////////////////////////


      await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);
      await VaultUtils.printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );

      const totalAssets = await vault.totalAssets();
      const totalSupply = await vault.totalSupply();
      const splitterTotalAssets = await splitter.totalAssets();
      const vaultBalance = +formatUnits(await assetCtr.balanceOf(vault.address), decimals);
      const splitterBalance = +formatUnits(await assetCtr.balanceOf(splitter.address), decimals);
      const strategyBalance = +formatUnits(await assetCtr.balanceOf(strategy.address), decimals);
      const strategyInvestedAssets = await strategy.investedAssets();
      const strategyTotalAssets = await strategy.totalAssets();

      console.log('totalAssets', formatUnits(totalAssets, decimals));
      console.log('totalSupply', formatUnits(totalSupply, decimals));
      console.log('splitterTotalAssets', formatUnits(splitterTotalAssets, decimals));
      console.log('vaultBalance', vaultBalance);
      console.log('splitterBalance', splitterBalance);
      console.log('strategyBalance', strategyBalance);
      console.log('strategyInvestedAssets', formatUnits(strategyInvestedAssets, decimals));
      console.log('strategyTotalAssets', formatUnits(strategyTotalAssets, decimals));

      expect(strategyInvestedAssets).above(0);

      await TimeUtils.advanceNBlocks(300);


      await UniswapV3StrategyUtils.movePriceUp(
        signer,
        strategy.address,
        MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        swapAmount,
      );

      await rebalanceUniv3Strategy(strategy, signer, decimals);

      await UniswapV3StrategyUtils.movePriceDown(
        signer,
        strategy.address,
        MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        swapAmount,
      );

      if (i % 2 === 0) {
        await PriceOracleUtils.incPriceUsdt(priceOracles, 1);
      } else {
        await PriceOracleUtils.incPriceUsdt(priceOracles, -1);
      }

      await TimeUtils.advanceNBlocks(300);

      await rebalanceUniv3Strategy(strategy, signer, decimals);

      await UniswapV3StrategyUtils.makeVolume(
        signer,
        strategy.address,
        MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        swapAmount,
      );

      await doHardWorkForStrategy(splitter, strategy, signer, decimals);

      ///////////////////////////
      // WITHDRAW
      ///////////////////////////

      await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
      await VaultUtils.printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );
    }

    const sharePriceAfter = await vault.sharePrice();
    // zero compound
    expect(sharePriceAfter).eq(sharePriceBefore);

  });

});

