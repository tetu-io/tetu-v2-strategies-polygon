import {IRebalancingV2Strategy__factory, IStrategyV2__factory, StrategySplitterV2__factory} from '../../typechain';
import { ethers } from 'hardhat';
import { RunHelper } from './RunHelper';
import { txParams2 } from '../../deploy_constants/deploy-helpers';
import { sendMessageToTelegram } from '../telegram/tg-sender';

// make HW a bit early for avoid excess spendings on gelato
const HW_DELAY = 60 * 60 * 11;

export async function splitterHardWork(splitterAdr: string) {
  try {
    const provider = ethers.provider;
    const signer = (await ethers.getSigners())[0];

    const splitter = StrategySplitterV2__factory.connect(splitterAdr, signer);


    const strategies = await splitter.allStrategies();

    for (const strategyAdr of strategies) {

      const paused = await splitter.pausedStrategies(strategyAdr);
      if (paused) {
        continue;
      }

      const lastHW = (await splitter.lastHardWorks(strategyAdr)).toNumber();
      const now = Math.floor(Date.now() / 1000);
      const sinceLastHw = now - lastHW;

      if (sinceLastHw > HW_DELAY) {

        const iStrategy = IStrategyV2__factory.connect(strategyAdr, provider)
        const iRebalancingStrategy = IRebalancingV2Strategy__factory.connect(strategyAdr, provider)
        const defaultState = await iRebalancingStrategy.getDefaultState()
        const isFuseTriggered =
          defaultState[2][1].toString() === '2'
          || defaultState[2][1].toString() === '3'
          || defaultState[2][2].toString() === '2'
          || defaultState[2][2].toString() === '3';
        const strategyName = await iStrategy.strategySpecificName();

        if (!isFuseTriggered) {
          console.log('>>> DO HARD WORK FOR STRATEGY', strategyName);
          const tp = await txParams2();
          await RunHelper.runAndWaitAndSpeedUp(
            provider,
            () => splitter.doHardWorkForStrategy(strategyAdr, true, { ...tp, gasLimit: 15_000_000 }),
            false,
            true,
          );
        }

      }

    }
  } catch (e) {
    console.error('HARD WORK ERROR', e);
    await sendMessageToTelegram(`HARD WORK ERROR ${e}`);
  }
}
