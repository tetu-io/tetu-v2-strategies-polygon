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
    // Disable platforms at TetuConverter
    await ConverterUtils.disableDForce(signer);
    await ConverterUtils.disableAaveV2(signer);

    // ---
    await TokenUtils.getToken(asset, signer.address, parseUnits('10000', decimals));
    await TokenUtils.getToken(asset, signer2.address, parseUnits('10000', decimals));

    await IERC20__factory.connect(asset, signer).approve(vault.address, parseUnits('10000', decimals));
    await IERC20__factory.connect(asset, signer2).approve(vault.address, parseUnits('10000', decimals));

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);
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

    const depositAmount1 = parseUnits('1000', decimals);

    const sharePriceBefore = await vault.sharePrice();

    for (let i = 0; i < 3; i++) {
      console.log('------------------ CYCLE', i, '------------------');

      ///////////////////////////
      // DEPOSIT
      ///////////////////////////


      await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);


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
      expect(await strategy.baseAmounts(MaticAddresses.USDC_TOKEN)).eq(0);
      expect(await strategy.baseAmounts(MaticAddresses.USDT_TOKEN)).eq(0);

      const sharePriceAfterDeposit = await vault.sharePrice();
      expect(sharePriceAfterDeposit).eq(sharePriceBefore);

      ///////////////////////////
      // WITHDRAW
      ///////////////////////////

      await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);

      const sharePriceAfterWithdraw = await vault.sharePrice();
      expect(sharePriceAfterWithdraw).eq(sharePriceAfterDeposit);
    }

  });

  it('deposit and exit with hard works should work properly', async function() {
    await strategy.setFuseThreshold(parseUnits('0.00001'))

    const depositAmount1 = parseUnits('1000', decimals);
    const swapAmount = parseUnits('1000000', decimals);

    const sharePriceBefore = await vault.sharePrice();

    for (let i = 0; i < 1; i++) {
      console.log('------------------ CYCLE', i, '------------------');

      ///////////////////////////
      // DEPOSIT
      ///////////////////////////


      await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);


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
    }

    const sharePriceAfter = await vault.sharePrice();
    // zero compound
    expect(sharePriceAfter).eq(sharePriceBefore);

  });

});

