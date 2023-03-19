import { ethers } from 'hardhat';
import { ContractTransaction } from 'ethers';
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { Misc } from './Misc';

const log: Logger<undefined> = new Logger(logSettings);


export class RunHelper {

  public static async runAndWait(callback: () => Promise<ContractTransaction>, stopOnError = true, wait = true) {
    console.log('Start on-chain transaction')
    const start = Date.now();
    const tr = await callback();
    if (!wait) {
      Misc.printDuration('runAndWait completed', start);
      return;
    }
    // const r0 = await tr.wait(WAIT_BLOCKS_BETWEEN_DEPLOY); // hardhat stucks on runAndWait()
    const r0 = await tr.wait(); // TODO why (and when) WAIT_BLOCKS_BETWEEN_DEPLOY needed?

    log.info('tx sent', tr.hash, 'gas used:', r0.gasUsed.toString());

    let receipt;
    while (true) {
      receipt = await ethers.provider.getTransactionReceipt(tr.hash);
      if (!!receipt) {
        break;
      }
      log.info('not yet complete', tr.hash);
      await Misc.delay(10000);
    }
    log.info('transaction result', tr.hash, receipt?.status);
    log.info('gas used', receipt.gasUsed.toString());
    if (receipt?.status !== 1 && stopOnError) {
      throw Error("Wrong status!");
    }
    Misc.printDuration('runAndWait completed', start);
  }

}
