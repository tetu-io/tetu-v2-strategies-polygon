import hre, {ethers} from "hardhat";
import {BigNumber, BytesLike} from "ethers";
import {defaultAbiCoder} from "ethers/lib/utils";
import {ITetuLiquidator} from "../../../typechain";
import { config as dotEnvConfig } from 'dotenv';

/**
 *   function liquidate(
 *     address tokenIn,
 *     address tokenOut,
 *     uint amount,
 *     uint slippage
 *   ) external;
 */
export interface ILiquidatorInputData {
  tokenIn: string;
  tokenOut: string;
  amount: BigNumber;
  slippage: BigNumber;
}

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    oneInchApiKey: {
      type: 'string',
      default: ''
    },
  }).argv;

export class AggregatorUtils {

  static apiRequestUrl(methodName: string, queryParams: string) {
    const chainId = hre.network.config.chainId;
    // const apiBaseUrl = 'https://api.1inch.dev/swap/v5.2/' + chainId;
    const apiBaseUrl = 'https://api-tetu.1inch.io/v5.0/' + chainId;

    const r = (new URLSearchParams(JSON.parse(queryParams))).toString();
    return apiBaseUrl + methodName + '?' + r;
  }

  static async buildTxForSwap(params: string, tries: number = 2) {
    const url = this.apiRequestUrl('/swap', params);
    console.log('url', url);
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, {
          headers: {
            'Authorization': 'Bearer ' + argv.oneInchApiKey,
            'Content-Type': 'application/json'
          }
        })
        if (r && r.status === 200) {
          return (await r.json()).tx
        }
      } catch (e) {
        console.error('Err', e)
      }
    }
  }

  /**
   * Build tx.data for the call of ITetuLiquidator.liquidate()
   * For simplicity we use liquidate, but it's possible to prepare liquidateWithRoute call
   * @param p
   */
  static buildTxForSwapUsingLiquidatorAsAggregator(p: ILiquidatorInputData): BytesLike {
    const abi = [
      "function liquidate(address tokenIn, address tokenOut, uint amount, uint slippage)"
    ];
    const iface = new ethers.utils.Interface(abi);
    return iface.encodeFunctionData('liquidate', [p.tokenIn, p.tokenOut, p.amount, p.slippage]);
  }
}
