import { IStrategyV2__factory, StrategySplitterV2__factory } from '../../typechain';
import { ethers } from 'hardhat';
import { RunHelper } from './RunHelper';
import { sendMessageToTelegram } from '../telegram/tg-sender';

// make HW a bit early for avoid excess spendings on gelato
const HW_DELAY = 60 * 60 * 11;
const LAST_ERRORS = new Map<string, number>();

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

      const lastError = LAST_ERRORS.get(strategyAdr.toLowerCase()) ?? 0;

      if (sinceLastHw > HW_DELAY && (lastError + 60 * 60 * 8) < now) {

        const iStrategy = IStrategyV2__factory.connect(strategyAdr, provider);
        const isReadyToHardWork = await iStrategy.isReadyToHardWork();

        if (isReadyToHardWork) {
          const strategyName = await iStrategy.strategySpecificName();
          console.log('>>> DO HARD WORK FOR STRATEGY', strategyName);

          try {
            await RunHelper.runAndWait2(splitter.populateTransaction.doHardWorkForStrategy(strategyAdr, true));
          } catch (e) {
            LAST_ERRORS.set(strategyAdr.toLowerCase(), now);
            throw e;
          }
        }

      }

    }
  } catch (e) {
    console.error('HARD WORK ERROR', e);
    await sendMessageToTelegram(`HARD WORK ERROR`, (e as string).toString());
  }
}
