import axios, {AxiosResponse} from "axios";
import Web3 from 'web3';
import {ethers} from "ethers";
import Transaction from '@ethereumjs/tx'
import {Misc} from "./Misc";
import Common from "ethereumjs-common";

const MATIC_CHAIN = Common.forCustomChain(
  'mainnet', {
    name: 'matic',
    networkId: 137,
    chainId: 137
  },
  'petersburg'
);

const LOCALHOST_CHAIN = Common.forCustomChain(
  'mainnet', {
    name: 'localhost',
    networkId: 31337,
    chainId: 31337
  },
  'petersburg'
);

export class SpeedUp {
  public static async getChainConfig(provider: ethers.providers.Provider) {
    const net = await provider.getNetwork();
    switch (net.chainId) {
      case 137:
        return MATIC_CHAIN;
      case 31337:
        return LOCALHOST_CHAIN;
      default:
        throw new Error('Unknown net ' + net.chainId)
    }
  }
  public static async getDefaultNetworkGas(provider: ethers.providers.Provider) {
    const net = await provider.getNetwork();
    switch (net.chainId) {
      case 137:
        return 30_000_000_000;
      case 250:
        return 300_000_000_000;
      case 56:
        return 5_000_000_000;
      default:
        throw new Error('Unknown net ' + net.chainId)
    }
  }

  public static async getCurrentGas(provider: ethers.providers.Provider) {
    try {
      return Math.max(+(await provider.getGasPrice()).toString(), await this.getDefaultNetworkGas(provider));
    } catch (e) {
      console.error('Error get gas price', e);
      return this.getDefaultNetworkGas(provider);
    }

  }

  public static async speedUp(rpcUrl, privateKey, txHash: string, provider: ethers.providers.Provider, addNonce = 0): Promise<string> {
    console.log('SPEEDUP', txHash)

    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl, {
      keepAlive: true,
      timeout: 120000, // ms
    }));

    let response: AxiosResponse;
    try {
      response = await axios.post(rpcUrl,
        `{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["${txHash}"],"id":1}`,
        {
          headers: {
            'Content-Type': 'application/json',
          }
        },
      );
    } catch (e) {
      console.error('error request', e);
      return 'error';
    }
    const result = response.data.result;
    // console.log('response', txHash, result);
    if (!result) {
      console.error('tx for speedup receipt is empty!', response)
      return 'error';
    }

    const nonce = Web3.utils.hexToNumber(result.nonce); // + addNonce probably will require for some cases but now we are dropping all if have error
    console.log('nonce', nonce);

    const gasPrice = await this.getCurrentGas(provider);
    const gasPriceAdjusted = +(gasPrice * 2).toFixed(0);

    console.log('current gas', gasPrice, gasPriceAdjusted, Web3.utils.numberToHex(gasPriceAdjusted));

    const chain = await this.getChainConfig(provider);
    const limit = 15_000_000
    const tx = new Transaction(
      {
        nonce: Web3.utils.numberToHex(nonce),
        from: result.from,
        to: result.to,
        data: result.input,
        gasPrice: gasPriceAdjusted,
        gasLimit: Web3.utils.numberToHex(limit),
      },
      {common: chain});


    tx.sign(Buffer.from(privateKey, 'hex'));

    const txRaw = '0x' + tx.serialize().toString('hex');

    let newHash = '';

    try {
      await web3.eth.sendSignedTransaction(txRaw, (err, res) => {
        console.log('SpeedUp tx result', err, res);
        newHash = res;
      });
    } catch (e) {
      console.log('speedup tx error', e);
      await SpeedUp.dropPending()
    }

    console.log('start waiting speedup result');
    while (newHash === '') {
      console.log('wait speedup result')
      await Misc.delay(10000);
    }
    console.log('speed up result hash', newHash);
    return newHash;
  }

  public static async dropPending() {

    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl, {
      keepAlive: true,
      timeout: 120000, // ms
    }));
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    console.log('Drop all pending txs', signer.address)

    while (true) {
      const nonce = await web3.eth.getTransactionCount(signer.address)
      console.log('nonce', nonce.toString());
      const nonce1 = await web3.eth.getTransactionCount(signer.address, 'pending')
      console.log('pending nonce', nonce1.toString());
      if (nonce1 === nonce) {
        console.log('NO PENDING');
        return;
      }
      try {
        const gasPrice = await this.getCurrentGas(provider);
        const gasPriceAdjusted = +(gasPrice * 3).toFixed(0);

        const chain = await this.getChainConfig(provider);
        const limit = 15_000_000
        console.log('current gas', gasPrice, gasPriceAdjusted);
        const tx = new Transaction(
          {
            nonce: web3.utils.numberToHex(nonce),
            from: signer.address,
            to: signer.address,
            // data: result.input,
            gasPrice: web3.utils.numberToHex(gasPriceAdjusted),
            gasLimit: web3.utils.numberToHex(limit),
          },
          {common: chain});


        tx.sign(Buffer.from(privateKey, 'hex'));

        const txRaw = '0x' + tx.serialize().toString('hex');

        await web3.eth.sendSignedTransaction(txRaw, (err, res) => {
          console.log('result', err, res);
        });
      } catch (e) {
        console.log('error drop pedning loop', e);
      }
    }
  }

}
