import {
  ControllerV2__factory,
  ForwarderV3__factory,
  IERC20__factory,
  IERC20Metadata,
  StrategyBaseV2,
  StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2,
  TetuVaultV2__factory,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3ConverterStrategyLogicLib__factory, VaultFactory__factory,
} from '../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, ContractReceipt } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import { LossCoveredEventObject } from '../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/TetuVaultV2';
import {
  HardWorkEventObject,
  InvestedEventObject,
  LossEventObject,
} from '../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/StrategySplitterV2';
import {
  InvestAllEventObject,
  WithdrawToSplitterEventObject,
} from '../typechain/@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2';
import {
  OnDepositorEnterEventObject,
  OnDepositorExitEventObject,
} from '../typechain/contracts/strategies/uniswap/UniswapV3ConverterStrategy';
import {
  UniV3FeesClaimedEventObject,
} from '../typechain/contracts/strategies/uniswap/UniswapV3ConverterStrategyLogicLib';
import chai from 'chai';
import { Misc } from '../scripts/utils/Misc';
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {DeployerUtils} from "../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../scripts/utils/DeployerUtilsLocal";

export async function doHardWorkForStrategy(
  splitter: StrategySplitterV2,
  strategy: StrategyBaseV2,
  signer: SignerWithAddress,
  decimals: number,
) {
  // const asset = await strategy.asset();
  const controller = await splitter.controller();
  const platformVoter = await ControllerV2__factory.connect(controller, splitter.provider).platformVoter();
  const investFund = await ControllerV2__factory.connect(controller, splitter.provider).investFund();
  const voter = await ControllerV2__factory.connect(controller, splitter.provider).voter();
  const forwarder = await ControllerV2__factory.connect(controller, splitter.provider).forwarder();
  const bribe = await ForwarderV3__factory.connect(forwarder, splitter.provider).bribe();
  const tetu = await ForwarderV3__factory.connect(forwarder, splitter.provider).tetu();
  const investFundTetuBalance = await IERC20__factory.connect(tetu, splitter.provider).balanceOf(investFund);
  const voterTetuBalance = await IERC20__factory.connect(tetu, splitter.provider).balanceOf(voter);
  const bribeTetuBalance = await IERC20__factory.connect(tetu, splitter.provider).balanceOf(bribe);
  const aprBefore = await splitter.strategiesAPR(strategy.address);
  const strategyTVLBefore = await strategy.totalAssets();

  await ForwarderV3__factory.connect(forwarder, await Misc.impersonate(platformVoter)).setInvestFundRatio(10_000);
  await ForwarderV3__factory.connect(forwarder, await Misc.impersonate(platformVoter)).setGaugesRatio(50_000);
  await ForwarderV3__factory.connect(forwarder, splitter.signer).setTetuThreshold(0);

  console.log('### DO HARD WORK CALL ###');
  const tx = await splitter.connect(signer).doHardWorkForStrategy(strategy.address, true, { gasLimit: 10_000_000 });
  const receipt = await tx.wait();
  await handleReceiptDoHardWork(receipt, decimals);

  const aprAfter = await splitter.strategiesAPR(strategy.address);

  if (!aprBefore.eq(aprAfter)) {
    const compoundRatio = await strategy.compoundRatio();
    if (!compoundRatio.isZero()) {
      const strategyTVLAfter = await strategy.totalAssets();

      expect(strategyTVLAfter).above(strategyTVLBefore, 'Strategy TVL should increase after hardwork');
    }

    if (!compoundRatio.eq(100_000)) {
      const investFundTetuBalanceAfter = await IERC20__factory.connect(tetu, splitter.provider).balanceOf(investFund);
      const voterTetuBalanceAfter = await IERC20__factory.connect(tetu, splitter.provider).balanceOf(voter);
      const bribeTetuBalanceAfter = await IERC20__factory.connect(tetu, splitter.provider).balanceOf(bribe);

      console.log('investFundTetuBalance diff', formatUnits(investFundTetuBalanceAfter.sub(investFundTetuBalance)));
      console.log('voterTetuBalance diff', formatUnits(voterTetuBalanceAfter.sub(voterTetuBalance)));
      console.log('bribeTetuBalance diff', formatUnits(bribeTetuBalanceAfter.sub(bribeTetuBalance)));

      expect(investFundTetuBalanceAfter).above(investFundTetuBalance);
      expect(voterTetuBalanceAfter).above(voterTetuBalance);
      expect(bribeTetuBalanceAfter).above(bribeTetuBalance);
    }
  }
}

const { expect } = chai;

export async function rebalanceUniv3Strategy(
  strategy: UniswapV3ConverterStrategy,
  signer: SignerWithAddress,
  decimals: number,
) {
  console.log('### REBALANCE CALL ###');
  const stateBefore = await strategy.getState();

  const tx = await strategy.connect(signer).rebalance({ gasLimit: 10_000_000 });
  const receipt = await tx.wait();
  await handleReceiptRebalance(receipt, decimals);

  const stateAfter = await strategy.getState();

  await printStateDifference(decimals, stateBefore, stateAfter);

  // todo check that balance on the strategy is empty after rebalance call
}

export async function printStateDifference(
  decimals: number,
  stateBefore: { tokenA: string; tokenB: string; pool: string; tickSpacing: number; lowerTick: number; upperTick: number; rebalanceTickRange: number; totalLiquidity: BigNumber; isFuseTriggered: boolean; fuseThreshold: BigNumber; rebalanceResults: BigNumber[] },
  stateAfter: { tokenA: string; tokenB: string; pool: string; tickSpacing: number; lowerTick: number; upperTick: number; rebalanceTickRange: number; totalLiquidity: BigNumber; isFuseTriggered: boolean; fuseThreshold: BigNumber; rebalanceResults: BigNumber[] },
) {
  const rebalanceEarned0Before = stateBefore.rebalanceResults[0];
  const rebalanceEarned1Before = stateBefore.rebalanceResults[1];
  const rebalanceLostBefore = stateBefore.rebalanceResults[2];

  const rebalanceEarned0After = stateAfter.rebalanceResults[0];
  const rebalanceEarned1After = stateAfter.rebalanceResults[1];
  const rebalanceLostAfter = stateAfter.rebalanceResults[2];

  console.log('rebalanceEarned0', formatUnits(rebalanceEarned0After.sub(rebalanceEarned0Before), decimals));
  console.log('rebalanceEarned1', formatUnits(rebalanceEarned1After.sub(rebalanceEarned1Before), decimals));
  console.log('rebalanceLost', formatUnits(rebalanceLostAfter.sub(rebalanceLostBefore), decimals));
}

export async function depositToVault(
  vault: TetuVaultV2,
  signer: SignerWithAddress,
  amount: BigNumber,
  decimals: number,
  assetCtr: IERC20Metadata,
  insurance: string,
) {
  expect(await assetCtr.balanceOf(signer.address)).greaterThanOrEqual(amount, 'not enough balance for deposit');
  console.log('### DEPOSIT CALL ###');

  const insuranceBefore = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceBefore', insuranceBefore);

  const sharesBefore = await vault.balanceOf(signer.address);
  let expectedShares = await vault.previewDeposit(amount);
  if ((await vault.totalSupply()).isZero()) {
    expectedShares = expectedShares.sub(1000);
  }

  const txDepost = await vault.connect(signer).deposit(amount, signer.address, { gasLimit: 10_000_000 });
  const receiptDeposit = await txDepost.wait();
  console.log('DEPOSIT gas', receiptDeposit.gasUsed.toNumber());
  await handleReceiptDeposit(receiptDeposit, decimals);

  const insuranceAfter = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceAfter', insuranceAfter);
  expect(insuranceBefore - insuranceAfter).below(100);
  expect(sharesBefore.add(expectedShares)).eq(await vault.balanceOf(signer.address));
}


export async function redeemFromVault(
  vault: TetuVaultV2, signer: SignerWithAddress, percent: number,
  decimals: number,
  assetCtr: IERC20Metadata,
  insurance: string,
) {
  console.log('### REDEEM CALL ###');
  const insuranceBefore = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceBefore', insuranceBefore);

  const assetsBefore = await assetCtr.balanceOf(signer.address);
  let expectedAssets;

  const amount = (await vault.balanceOf(signer.address)).mul(percent).div(100);
  console.log('redeem amount', amount.toString());
  let txDepost;
  if (percent === 100) {
    const toRedeem = (await vault.balanceOf(signer.address)).sub(1);
    expectedAssets = await vault.previewRedeem(toRedeem);
    txDepost = await vault.connect(signer).redeem(toRedeem, signer.address, signer.address, { gasLimit: 10_000_000 });
  } else {
    const toRedeem = amount.sub(1);
    expectedAssets = await vault.previewRedeem(toRedeem);
    txDepost = await vault.connect(signer).redeem(toRedeem, signer.address, signer.address, { gasLimit: 10_000_000 });
  }
  const receipt = await txDepost.wait();
  console.log('REDEEM gas', receipt.gasUsed.toNumber());
  await handleReceiptRedeem(receipt, decimals);

  const insuranceAfter = +formatUnits(await assetCtr.balanceOf(insurance), decimals);
  console.log('insuranceAfter', insuranceAfter);
  expect(insuranceBefore - insuranceAfter).below(100);
  expect(assetsBefore.add(expectedAssets)).eq(await assetCtr.balanceOf(signer.address));
}

export async function handleReceiptDeposit(receipt: ContractReceipt, decimals: number): Promise<void> {
  console.log('*** DEPOSIT LOGS ***');
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
  console.log('*************');
}

export async function handleReceiptRedeem(receipt: ContractReceipt, decimals: number): Promise<void> {
  console.log('*** REDEEM LOGS ***');
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
    if (event.topics[0].toLowerCase() === strategyI.getEventTopic('WithdrawToSplitter').toLowerCase()) {
      const log = (strategyI.decodeEventLog(
        strategyI.getEvent('WithdrawToSplitter'),
        event.data,
        event.topics,
      ) as unknown) as WithdrawToSplitterEventObject;
      console.log(
        'WithdrawToSplitter',
        formatUnits(log.amount, decimals),
        formatUnits(log.sent, decimals),
        formatUnits(log.balance, decimals),
      );
    }
    if (event.topics[0].toLowerCase() === strategyI.getEventTopic('OnDepositorExit').toLowerCase()) {
      const log = (strategyI.decodeEventLog(
        strategyI.getEvent('OnDepositorExit'),
        event.data,
        event.topics,
      ) as unknown) as OnDepositorExitEventObject;
      console.log('OnDepositorExit', formatUnits(log.liquidityAmount, decimals), log.withdrawnAmounts);
    }
  }
  console.log('*************');
}

export async function handleReceiptRebalance(receipt: ContractReceipt, decimals: number) {
  console.log('*** REBALANCE LOGS ***');
  const univ3LogicLibI = UniswapV3ConverterStrategyLogicLib__factory.createInterface();
  for (const event of (receipt.events ?? [])) {
    if (event.topics[0].toLowerCase() === univ3LogicLibI.getEventTopic('FuseTriggered').toLowerCase()) {
      console.log('>>> !!!!!!!!!!!!!!!!!!!!!!!!! FuseTriggered !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    }
    if (event.topics[0].toLowerCase() === univ3LogicLibI.getEventTopic('Rebalanced').toLowerCase()) {
      console.log('/// Strategy rebalanced');
    }
  }
  console.log('*************');
}

export async function handleReceiptDoHardWork(receipt: ContractReceipt, decimals: number) {
  console.log('*** HARD WORK LOGS ***');
  const vaultI = TetuVaultV2__factory.createInterface();
  const splitterI = StrategySplitterV2__factory.createInterface();
  const strategyI = UniswapV3ConverterStrategy__factory.createInterface();
  const univ3LogicLibI = UniswapV3ConverterStrategyLogicLib__factory.createInterface();
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
    if (event.topics[0].toLowerCase() === splitterI.getEventTopic('HardWork').toLowerCase()) {
      const log = (splitterI.decodeEventLog(
        splitterI.getEvent('HardWork'),
        event.data,
        event.topics,
      ) as unknown) as HardWorkEventObject;
      console.log(` Strategy HARD WORK results:
      tvl: ${formatUnits(log.tvl, decimals)}
      earned: ${formatUnits(log.earned, decimals)}
      lost: ${formatUnits(log.lost, decimals)}
      apr: ${formatUnits(log.apr, 1)}%
      avgApr: ${formatUnits(log.avgApr, 1)}%
      `);
    }
    if (event.topics[0].toLowerCase() === univ3LogicLibI.getEventTopic('UniV3FeesClaimed').toLowerCase()) {
      const log = (univ3LogicLibI.decodeEventLog(
        univ3LogicLibI.getEvent('UniV3FeesClaimed'),
        event.data,
        event.topics,
      ) as unknown) as UniV3FeesClaimedEventObject;
      console.log(
        'UniV3FeesClaimed',
        formatUnits(log.fee0, decimals),
        formatUnits(log.fee1, decimals),
      );
    }
  }
  console.log('*************');
}

export async function printVaultState(
  vault: TetuVaultV2,
  splitter: StrategySplitterV2,
  strategy: StrategyBaseV2,
  assetCtr: IERC20Metadata,
  decimals: number,
) {
  const totalAssets = await vault.totalAssets();
  const totalSupply = await vault.totalSupply();
  const splitterTotalAssets = await splitter.totalAssets();
  const vaultBalance = +formatUnits(await assetCtr.balanceOf(vault.address), decimals);
  const splitterBalance = +formatUnits(await assetCtr.balanceOf(splitter.address), decimals);
  const strategyBalance = +formatUnits(await assetCtr.balanceOf(strategy.address), decimals);
  const strategyInvestedAssets = await strategy.investedAssets();
  const strategyTotalAssets = await strategy.totalAssets();

  console.log('---------- VAULT STATE ----------');
  console.log('sharePrice', formatUnits(await vault.sharePrice(), decimals));
  console.log('totalAssets', formatUnits(totalAssets, decimals));
  console.log('totalSupply', formatUnits(totalSupply, decimals));
  console.log('splitterTotalAssets', formatUnits(splitterTotalAssets, decimals));
  console.log('vaultBalance', vaultBalance);
  console.log('splitterBalance', splitterBalance);
  console.log('strategyBalance', strategyBalance);
  console.log('strategyInvestedAssets', formatUnits(strategyInvestedAssets, decimals));
  console.log('strategyTotalAssets', formatUnits(strategyTotalAssets, decimals));
  console.log('-----------------------------------');
}
