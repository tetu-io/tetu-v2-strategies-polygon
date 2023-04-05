import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { ethers } from 'hardhat';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  IController__factory,
  IERC20__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IStrategyV2,
  StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2,
  TetuVaultV2__factory,
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
import { BigNumber, ContractReceipt } from 'ethers';
import { LossCoveredEventObject } from '../../../../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/TetuVaultV2';
import {
  InvestedEventObject,
  LossEventObject,
} from '../../../../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/StrategySplitterV2';
import {
  InvestAllEventObject,
} from '../../../../typechain/@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2';
import {
  OnDepositorEnterEventObject,
} from '../../../../typechain/contracts/strategies/uniswap/UniswapV3ConverterStrategy';


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

  it('deposit and full exit should not change share price', async function() {

    const depositAmount1 = parseUnits('1000', decimals);
    const withdrawAmount1 = depositAmount1.sub(depositAmount1.mul(300).div(100_000));

    const sharePriceBefore = await vault.sharePrice();

    for (let i = 0; i < 10; i++) {

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

});

async function depositToVault(
  vault: TetuVaultV2,
  signer: SignerWithAddress,
  amount: BigNumber,
  decimals: number,
  assetCtr: IERC20Metadata,
  insurance: string,
) {
  const insuranceBefore = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceBefore', insuranceBefore);

  const txDepost = await vault.connect(signer).deposit(amount, signer.address);
  const receiptDeposit = await txDepost.wait();
  console.log('DEPOSIT gas', receiptDeposit.gasUsed.toNumber());
  await handleReceiptDeposit(receiptDeposit, decimals);

  const insuranceAfter = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceAfter', insuranceAfter);
  expect(insuranceBefore - insuranceAfter).below(100);
}


async function redeemFromVault(
  vault: TetuVaultV2, signer: SignerWithAddress, percent: number,
  decimals: number,
  assetCtr: IERC20Metadata,
  insurance: string,
) {
  const insuranceBefore = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceBefore', insuranceBefore);

  const amount = (await vault.balanceOf(signer.address)).mul(percent).div(100);
  console.log('redeem amount', amount.toString());
  const txDepost = await vault.connect(signer).redeem(amount, signer.address, signer.address);
  const receipt = await txDepost.wait();
  console.log('REDEEM gas', receipt.gasUsed.toNumber());
  // await handleReceiptDeposit(receipt, decimals);

  const insuranceAfter = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceAfter', insuranceAfter);
  expect(insuranceBefore - insuranceAfter).below(100);
}

async function handleReceiptDeposit(receipt: ContractReceipt, decimals: number): Promise<void> {
  const vaultI = TetuVaultV2__factory.createInterface();
  const splitterI = StrategySplitterV2__factory.createInterface();
  const strategyI = UniswapV3ConverterStrategy__factory.createInterface();
  for (const event of (receipt.events ?? [])) {
    if (event.topics[0].toLowerCase() === vaultI.getEventTopic('LossCovered').toLowerCase()) {
      const log = (vaultI.decodeEventLog(
        vaultI.getEvent('LossCovered'),
        event.data,
        event.topics,
      ) as unknown) as LossCoveredEventObject;
      console.log('LossCovered', formatUnits(log.amount, decimals));
    }
    if (event.topics[0].toLowerCase() === splitterI.getEventTopic('Loss').toLowerCase()) {
      const log = (splitterI.decodeEventLog(
        splitterI.getEvent('Loss'),
        event.data,
        event.topics,
      ) as unknown) as LossEventObject;
      console.log('Loss', formatUnits(log.amount, decimals));
    }
    if (event.topics[0].toLowerCase() === splitterI.getEventTopic('Invested').toLowerCase()) {
      const log = (splitterI.decodeEventLog(
        splitterI.getEvent('Invested'),
        event.data,
        event.topics,
      ) as unknown) as InvestedEventObject;
      console.log('Invested', formatUnits(log.amount, decimals));
    }
    if (event.topics[0].toLowerCase() === strategyI.getEventTopic('InvestAll').toLowerCase()) {
      const log = (strategyI.decodeEventLog(
        strategyI.getEvent('InvestAll'),
        event.data,
        event.topics,
      ) as unknown) as InvestAllEventObject;
      console.log('InvestAll', formatUnits(log.balance, decimals));
    }
    if (event.topics[0].toLowerCase() === strategyI.getEventTopic('OnDepositorEnter').toLowerCase()) {
      const log = (strategyI.decodeEventLog(
        strategyI.getEvent('OnDepositorEnter'),
        event.data,
        event.topics,
      ) as unknown) as OnDepositorEnterEventObject;
      console.log('OnDepositorEnter', log.amounts, log.consumedAmounts);
    }
  }
}
