import axios, {AxiosResponse} from "axios";
import Web3 from 'web3';
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {sendMessageToTelegram} from "../telegram/tg-sender";
import {BigNumber, providers} from "ethers";
import {formatUnits} from "ethers/lib/utils";
import {Misc} from "./Misc";
// import {Transaction as EthereumTx} from '@ethereumjs/tx'

const log: Logger<undefined> = new Logger(logSettings);
// tslint:disable-next-line:no-var-requires
const EthereumTx = require('ethereumjs-tx').Transaction;

export class SpeedUp {
  public static increase() {
    return 1.5
  }

  public static waitCycles() {
    return 100
  }

  public static getRpcUrl() {
    return process.env.TETU_MATIC_RPC_URL || ''
  }

  public static async getBlockGasLimit(provider: providers.Provider) {
    const net = await provider.getNetwork();
    switch (net.chainId) {
      case 137:
        return 15_000_000;
      case 31337:
        return 15_000_000;
      case 250:
        return 9_000_000;
      default:
        throw new Error('Unknown net ' + net.chainId)
    }
  }

  public static async speedUp(txHash: string, provider: providers.Provider): Promise<string> {
    log.debug('SPEEDUP', txHash)

    const url = SpeedUp.getRpcUrl();

    const web3Provider = new Web3(new Web3.providers.HttpProvider(url, {
      timeout: 120000,
    }));

    let response: AxiosResponse;
    try {
      response = await axios.post(url,
        `{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["${txHash}"],"id":1}`,
        {
          headers: {
            'Content-Type': 'application/json',
          }
        },
      );
    } catch (e) {
      await sendMessageToTelegram(`speed up error req eth_getTransactionByHash`);
      console.error('error request', e);
      return 'error';
    }
    const result = response.data.result;
    log.debug('OLD TX', txHash, result);
    if (!result) {
      console.error('tx for speedup receipt is empty!', response)
      await sendMessageToTelegram(`tx for speedup receipt is empty!`);
      return 'error';
    }

    const nonce = Web3.utils.hexToNumber(result.nonce); // + addNonce probably will require for some cases but now we are dropping all if have error
    log.debug('nonce', nonce);

    const maxFeePerGasOrig = Web3.utils.hexToNumber(result.maxFeePerGas) as number
    const maxPriorityFeePerGasOrig = Web3.utils.hexToNumber(result.maxPriorityFeePerGas) as number
    log.debug('original maxFeePerGas', formatUnits(maxFeePerGasOrig, 9));
    log.debug('original maxPriorityFeePerGas', formatUnits(maxPriorityFeePerGasOrig, 9));

    const feeData = await provider.getFeeData();
    log.debug('current gasPrice', formatUnits(feeData.gasPrice ?? BigNumber.from(0), 9));
    log.debug('current maxPriorityFeePerGas', formatUnits(feeData.maxPriorityFeePerGas ?? BigNumber.from(0), 9));
    log.debug('current maxFeePerGas', formatUnits(feeData.maxFeePerGas ?? BigNumber.from(0), 9));
    log.debug('current lastBaseFeePerGas', formatUnits(feeData.lastBaseFeePerGas ?? BigNumber.from(0), 9));

    let maxFeePerGasAdj = Math.floor(maxFeePerGasOrig * SpeedUp.increase())
    let maxPriorityFeePerGasAdj = maxPriorityFeePerGasOrig

    if (maxFeePerGasAdj < (feeData.maxFeePerGas?.toNumber() ?? 0)) {
      maxFeePerGasAdj = Math.floor((feeData.maxFeePerGas?.toNumber() ?? 0) * SpeedUp.increase());
    }

    if (maxPriorityFeePerGasAdj < (feeData.lastBaseFeePerGas?.toNumber() ?? 0)) {
      maxPriorityFeePerGasAdj = Math.floor((feeData.lastBaseFeePerGas?.toNumber() ?? 0) * SpeedUp.increase());
    }

    log.debug('===> maxFeePerGasAdj', formatUnits(maxFeePerGasAdj, 9));
    log.debug('===> maxPriorityFeePerGasAdj', formatUnits(maxPriorityFeePerGasAdj, 9));

    const chain = await Misc.getChainConfig();
    const limit = await this.getBlockGasLimit(provider);
    const tx = new EthereumTx(
      {
        nonce: Web3.utils.numberToHex(nonce),
        from: result.from,
        to: result.to,
        data: result.input,
        maxFeePerGas: Web3.utils.numberToHex(maxFeePerGasAdj),
        maxPriorityFeePerGas: Web3.utils.numberToHex(maxPriorityFeePerGasAdj),
        gasLimit: Web3.utils.numberToHex(limit),
      },
      {common: chain});


    tx.sign(Buffer.from(process.env.TETU_PRIVATE_KEY || '', 'hex'));

    const txRaw = '0x' + tx.serialize().toString('hex');

    return SpeedUp.sendAndWait(txRaw, web3Provider);
  }

  public static async sendAndWait(txRaw: string, web3Provider: Web3) {
    let newHash = '';
    let finished = false;
    web3Provider.eth.sendSignedTransaction(txRaw,)
      .on('error', (err: unknown) => {
        log.debug('send raw error', err);
        newHash = 'error'
        finished = true;
      })
      .on('transactionHash', (hash) => newHash = hash)
      // tslint:disable-next-line:no-any
      .on('receipt', (res: any) => {
        log.debug('send raw receipt', res)
        if (res.status) {
          newHash = res.transactionHash
        } else {
          newHash = 'error'
        }
        finished = true;
      })


    log.debug('start waiting send raw result');
    while (!finished) {
      log.debug('wait send raw result', newHash)
      if (!finished) {
        await Misc.delay(10_000);
      }
    }
    log.debug('send raw result hash', newHash);
    return newHash;
  }
}
