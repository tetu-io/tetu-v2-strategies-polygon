import {ContractTransaction, providers} from 'ethers';
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { Misc } from './Misc';
import {TransactionResponse} from "@ethersproject/abstract-provider/src.ts";
import {SpeedUp} from "./SpeedUp";
import {StaticJsonRpcProvider} from "@ethersproject/providers/src.ts/url-json-rpc-provider";
import {sendMessageToTelegram} from "../telegram/tg-sender";
import {ethers} from "hardhat";

const log: Logger<undefined> = new Logger(logSettings);


export class RunHelper {

  public static async waitBlocks(provider: providers.Provider, blocks: number) {
    const start = await provider.getBlockNumber();
    while (true) {
      console.log('wait 1sec');
      await Misc.delay(1000);
      const bn = await provider.getBlockNumber();
      if (bn >= start + blocks) {
        break;
      }
    }
  }

  public static async waitAndSpeedUp(provider: StaticJsonRpcProvider, hash: string, speedUp = true): Promise<string> {
    console.log('waitAndSpeedUp', hash);
    let receipt;
    let count = 0;
    while (true) {
      receipt = await provider.getTransactionReceipt(hash);
      if (!!receipt) {
        break;
      }
      console.log('not yet complete', count, hash);
      await Misc.delay(1000);
      count++;
      if (count > SpeedUp.waitCycles() && speedUp) {
        const newHash = await SpeedUp.speedUp(hash, provider);
        if (!newHash || newHash === 'error') {
          throw Error("Wrong speedup! " + hash);
        }
        return this.waitAndSpeedUp(provider, newHash, true);
      }
    }
    return hash;
  }

  public static async runAndWaitAndSpeedUp(provider: StaticJsonRpcProvider, callback: () => Promise<ContractTransaction|TransactionResponse>, stopOnError = true, wait = true) {
    try {
      console.log('Start on-chain transaction')
      const start = Date.now();
      const tr = await callback();
      if (!wait) {
        Misc.printDuration('runAndWait completed', start);
        return;
      }

      // await this.waitBlocks(provider, 1);
      log.info('tx sent', tr.hash/*, 'gas used:', r0.gasUsed.toString()*/);

      const hash = await this.waitAndSpeedUp(provider, tr.hash);
      if (!hash || hash === 'error') {
        throw Error("Wrong hash! " + hash);
      }
      const receipt = await provider.getTransactionReceipt(hash);
      console.log('transaction result', hash, receipt?.status);
      if (receipt?.status !== 1 && stopOnError) {
        throw Error("Wrong status!");
      } else {
        if (receipt?.status !== 1) {
          console.log('WRONG STATUS!', hash)
        }
      }
    } catch (e) {
      if (stopOnError) {
        throw e;
      } else {
        await sendMessageToTelegram(`Run and wait error: ${e}`);
        log.error('Run and wait error: ', e)
      }
    }
  }

  public static async runAndWait(callback: () => Promise<ContractTransaction|TransactionResponse>, stopOnError = true, wait = true, silent: false) {
    if (!silent) {
      console.log('Start on-chain transaction')
    }

    const start = Date.now();
    const tr = await callback();
    if (!wait) {
      if (!silent) {
        Misc.printDuration('runAndWait completed', start);
      }
      return;
    }
    // const r0 = await tr.wait(WAIT_BLOCKS_BETWEEN_DEPLOY); // hardhat stucks on runAndWait()
    const r0 = await tr.wait(); // TODO why (and when) WAIT_BLOCKS_BETWEEN_DEPLOY needed?

    if (!silent) {
      log.info('tx sent', tr.hash, 'gas used:', r0.gasUsed.toString());
    }

    let receipt;
    while (true) {
      receipt = await ethers.provider.getTransactionReceipt(tr.hash);
      if (!!receipt) {
        break;
      }
      if (!silent) {
        log.info('not yet complete', tr.hash);
      }
      await Misc.delay(10000);
    }
    if (!silent) {
      log.info('transaction result', tr.hash, receipt?.status);
      log.info('gas used', receipt.gasUsed.toString());
    }
    if (receipt?.status !== 1 && stopOnError) {
      throw Error("Wrong status!");
    }
    if (!silent) {
      Misc.printDuration('runAndWait completed', start);
    }
    return receipt;
  }

}
