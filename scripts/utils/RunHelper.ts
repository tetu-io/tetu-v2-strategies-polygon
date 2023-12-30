import {BigNumber, ContractTransaction, PopulatedTransaction, providers} from 'ethers';
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { Misc } from './Misc';
import { TransactionResponse } from '@ethersproject/abstract-provider/src.ts';
import { SpeedUp } from './SpeedUp';
import { StaticJsonRpcProvider } from '@ethersproject/providers/src.ts/url-json-rpc-provider';
import { sendMessageToTelegram } from '../telegram/tg-sender';
import { ethers } from 'hardhat';
import {formatUnits} from "ethers/lib/utils";

const log: Logger<undefined> = new Logger(logSettings);


export class RunHelper {

  public static async waitBlocks(provider: providers.Provider, blocks: number) {
    const start = await provider.getBlockNumber();
    while (true) {
      if (Misc.isRealNetwork()) {
        console.log('wait 1sec');
        await Misc.delay(1000);
      }
      const bn = await provider.getBlockNumber();
      if (bn >= start + blocks) {
        break;
      }
    }
  }

  public static async waitAndSpeedUp(
    provider: StaticJsonRpcProvider,
    hash: string,
    speedUp: boolean = true,
  ): Promise<string> {
    console.log('wait And SpeedUp', hash);
    let receipt;
    let count = 0;
    while (true) {
      receipt = await provider.getTransactionReceipt(hash);
      if (!!receipt) {
        console.log('tx receipt.status', receipt.status);
        break;
      }
      console.log('not yet complete', count, hash);
      if (Misc.isRealNetwork()) {
        await Misc.delay(10_000);
      }
      count++;
      if (count > SpeedUp.waitCycles() && speedUp) {
        const newHash = await SpeedUp.speedUp(hash, provider);
        if (!newHash || newHash === 'error') {
          throw Error('Wrong speedup! ' + hash);
        }
        return this.waitAndSpeedUp(provider, newHash, true);
      }
    }

    // sometimes a node returns zero receipt even if just had normal
    if (Misc.isRealNetwork()) {
      await Misc.delay(5000);
    }

    return hash;
  }

  public static async runAndWaitAndSpeedUp(
    provider: StaticJsonRpcProvider,
    callback: () => Promise<ContractTransaction | TransactionResponse>,
    stopOnError: boolean = true,
    wait: boolean = true,
  ) {
    try {
      console.log('Start on-chain transaction');
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
        throw Error('Wrong hash! ' + hash);
      }
      const receipt = await provider.getTransactionReceipt(hash);
      console.log('transaction result', hash, receipt?.status);
      if (receipt?.status !== 1 && stopOnError) {
        throw Error('Wrong status!');
      } else {
        if (receipt?.status !== 1) {
          console.log('WRONG STATUS!', hash);
        }
      }
    } catch (e) {
      if (stopOnError) {
        throw e;
      } else {
        await sendMessageToTelegram(`Run and wait error`, (e as string).toString());
        log.error('Run and wait error: ', e);
      }
    }
  }

  public static async runAndWait(
    callback: () => Promise<ContractTransaction | TransactionResponse>,
    stopOnError: boolean = true,
    wait: boolean = true,
    silent: boolean = false,
  ) {
    if (!silent) {
      console.log('Start on-chain transaction');
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
      if (Misc.isRealNetwork()) {
        await Misc.delay(10000);
      }
    }
    if (!silent) {
      log.info('transaction result', tr.hash, receipt?.status);
      log.info('gas used', receipt.gasUsed.toString());
    }
    if (receipt?.status !== 1 && stopOnError) {
      throw Error('Wrong status!');
    }
    if (!silent) {
      Misc.printDuration('runAndWait completed', start);
    }
    return receipt;
  }

  public static async runAndWait2(txPopulated: Promise<PopulatedTransaction>, stopOnError = true, wait = true) {
    console.log('prepare run and wait2')
    const tx = await txPopulated;
    const signer = (await ethers.getSigners())[0];
    const gas = (await signer.estimateGas(tx)).toNumber()

    const params = await RunHelper.txParams();
    console.log('params', params)

    tx.gasLimit = BigNumber.from(gas).mul(15).div(10);

    if (params?.maxFeePerGas) tx.maxFeePerGas = BigNumber.from(params.maxFeePerGas);
    if (params?.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = BigNumber.from(params.maxPriorityFeePerGas);
    if (params?.gasPrice) tx.gasPrice = BigNumber.from(params.gasPrice);

    return RunHelper.runAndWait(() => signer.sendTransaction(tx), stopOnError, wait);
  }

  public static async txParams() {
    const provider = ethers.provider;
    const feeData = await provider.getFeeData();


    console.log('maxPriorityFeePerGas', formatUnits(feeData.maxPriorityFeePerGas?.toString() ?? '0', 9));
    console.log('maxFeePerGas', formatUnits(feeData.maxFeePerGas?.toString() ?? '0', 9));
    console.log('gas price:', formatUnits(feeData.gasPrice?.toString() ?? '0', 9));

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      const maxPriorityFeePerGas = Math.max(feeData.maxPriorityFeePerGas?.toNumber() ?? 1, feeData.lastBaseFeePerGas?.toNumber() ?? 1);
      const maxFeePerGas = (feeData.maxFeePerGas?.toNumber() ?? 1) * 2;
      return {
        maxPriorityFeePerGas: maxPriorityFeePerGas.toFixed(0),
        maxFeePerGas: maxFeePerGas.toFixed(0),
      };
    } else {
      return {
        gasPrice: ((feeData.gasPrice?.toNumber() ?? 1) * 1.2).toFixed(0),
      };
    }
  }
}
