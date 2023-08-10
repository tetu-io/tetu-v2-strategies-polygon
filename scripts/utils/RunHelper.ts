import { ethers } from 'hardhat';
import { ContractTransaction } from 'ethers';
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { Misc } from './Misc';
import {TransactionResponse} from "@ethersproject/abstract-provider/src.ts";
import {SpeedUp} from "./SpeedUp";
import {StaticJsonRpcProvider} from "@ethersproject/providers/src.ts/url-json-rpc-provider";

const log: Logger<undefined> = new Logger(logSettings);


export class RunHelper {

  public static async waitBlocks(provider: ethers.providers.Provider, blocks: number) {
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

  public static async waitAndSpeedUp(provider: StaticJsonRpcProvider, hash: string, speedUp = true, addNonce = 0): Promise<string> {
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
      if (count > 180 && speedUp) {
        const newHash = await SpeedUp.speedUp(hash, provider, addNonce);
        if (!newHash || newHash === 'error') {
          throw Error("Wrong speedup! " + hash);
        }
        return this.waitAndSpeedUp(provider, newHash, true, addNonce + 1);
      }
    }
    return hash;
  }

  public static async runAndWaitAndSpeedUp(rpcUrl: string, privateKey: string, provider: StaticJsonRpcProvider, callback: () => Promise<ContractTransaction|TransactionResponse>, stopOnError = true, wait = true) {
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
        console.log('error', e)
      }
    }
  }

  public static async runAndWait(callback: () => Promise<ContractTransaction|TransactionResponse>, stopOnError = true, wait = true) {
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
    return receipt;
  }

}
