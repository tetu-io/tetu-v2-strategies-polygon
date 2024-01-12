import hre, {ethers} from "hardhat";
import {BigNumber, BytesLike, Contract} from "ethers";
import { EnvSetup } from '../../../scripts/utils/EnvSetup';
import {formatUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

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

export type AggregatorType = "OneInch" | "OpenOcean" | "TetuLiquidator" | "TetuLiquidatorAsAggregator";

export const AGGREGATOR_ONE_INCH = "OneInch";
export const AGGREGATOR_OPEN_OCEAN = "OpenOcean";
export const AGGREGATOR_TETU_LIQUIDATOR = "TetuLiquidator";
export const AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR = "TetuLiquidatorAsAggregator";

const openOceanChains = new Map<number, string>([
  [1, 'eth'],
  [137, 'polygon'],
  [56, 'bsc'],
  [42161, 'arbitrum'],
  [10, 'optimism'],
  [8453, 'base'],
  [1101, 'polygon_zkevm']
]);

export type IOpenOceanResponse = {
  data: {
    to?: string,
    data?: string,
    outAmount?: string
  }
}

const argv = EnvSetup.getEnv();

export class AggregatorUtils {

  static async buildSwapData(
    signer: SignerWithAddress,
    chainId: number,
    aggregatorType: AggregatorType,
    tokenIn: string,
    tokenOut: string,
    amountToSwap: BigNumber,
    from: string
  ): Promise<BytesLike>{
    switch (aggregatorType) {
      case AGGREGATOR_ONE_INCH:
        console.log("Swap data: AGGREGATOR_ONE_INCH");
        return AggregatorUtils.buildSwapTransactionDataForOneInch(
          chainId,
          tokenIn,
          tokenOut,
          amountToSwap,
          from,
        );
      case AGGREGATOR_OPEN_OCEAN:
        console.log("Swap data: AGGREGATOR_OPEN_OCEAN");
        return AggregatorUtils.buildSwapTransactionDataForOpenOcean(
          signer,
          chainId,
          tokenIn,
          tokenOut,
          amountToSwap,
          from,
        );
      case AGGREGATOR_TETU_LIQUIDATOR:
        console.log("Swap data: 0x");
        return "0x";
      case AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR:
        console.log("Swap data: AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR");
        return AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
          tokenIn,
          tokenOut,
          amount: amountToSwap,
          slippage: BigNumber.from(5_000)
        });
      default:
        throw Error(`buildSwapData: unsupported aggregator ${aggregatorType}`);
    }
  }

  /**
   * Build tx.data for the call of ITetuLiquidator.liquidate()
   * For simplicity we use liquidate, but it's possible to prepare liquidateWithRoute call
   *
   * We can use this function to set up swap through MockAggregator because it has liquidate() with exactly same set of params
   * @param p
   */
  static buildTxForSwapUsingLiquidatorAsAggregator(p: ILiquidatorInputData): BytesLike {
    const abi = [
      "function liquidate(address tokenIn, address tokenOut, uint amount, uint slippage)"
    ];
    const iface = new ethers.utils.Interface(abi);
    return iface.encodeFunctionData('liquidate', [p.tokenIn, p.tokenOut, p.amount, p.slippage]);
  }

  /** see https://docs.openocean.finance/dev/aggregator-api-and-sdk/aggregator-api */
  static async buildSwapTransactionDataForOpenOcean(
    signer: SignerWithAddress,
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amount: BigNumber,
    from: string
  ) : Promise<BytesLike> {
    const chainName = openOceanChains.get(chainId) ?? 'unknown chain';
    const params = {
      chain: chainName,
      inTokenAddress: tokenIn,
      outTokenAddress: tokenOut,
      amount: +formatUnits(amount, await IERC20Metadata__factory.connect(tokenIn, signer).decimals()),
      account: from,
      slippage: '0.5',
      gasPrice: 30,
    };

    const url = `https://open-api.openocean.finance/v3/${chainName}/swap_quote?${(new URLSearchParams(JSON.parse(JSON.stringify(params)))).toString()}`;
    console.log('OpenOcean API request', url);
    const r = await fetch(url, {});
    if (r && r.status === 200) {
      const json = await r.json();
      // console.log("JSON", json);
      const quote: IOpenOceanResponse = json as unknown as IOpenOceanResponse;
      if (quote && quote.data && quote.data.to && quote.data.data && quote.data.outAmount) {
        return quote.data.data;
      } else {
        throw Error(`open ocean can not fetch url=${url}, qoute=${quote}`);
      }
    } else {
      throw Error(`open ocean error url=${url}, status=${r.status}`);
    }
  }

  static async buildSwapTransactionDataForOneInch(chainId: number, tokenIn: string, tokenOut: string, amount: BigNumber, from: string) : Promise<BytesLike> {
    return this.buildSwapTransactionDataOneInchV50(chainId, tokenIn, tokenOut, amount, from);
  }

//region OneInch v50
  static apiRequestUrl(chainId: number, methodName: string, queryParams: string) {
    // const apiBaseUrl = 'https://api.1inch.io/v5.0/' + chainId;
    // const apiBaseUrl = 'https://api.1inch.dev/swap/v5.2/' + chainId;
    const apiBaseUrl = `https://api.1inch.dev/swap/v5.0/${chainId}`;

    const r = (new URLSearchParams(JSON.parse(queryParams))).toString();
    return apiBaseUrl + methodName + '?' + r;
  }
  static async buildTxForSwap(chainId: number, params: string, tries: number = 2) {
    const url = this.apiRequestUrl(chainId,'/swap', params);
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

  static async buildSwapTransactionDataOneInchV50(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amount: BigNumber,
    from: string
  ) : Promise<BytesLike> {
    const params = {
      fromTokenAddress: tokenIn,
      toTokenAddress: tokenOut,
      amount: amount.toString(),
      fromAddress: from,
      slippage: 1,
      disableEstimate: true,
      allowPartialFill: false,
    };
    console.log("params", params);

    const swapTransaction = await AggregatorUtils.buildTxForSwap(chainId, JSON.stringify(params));
    console.log('Transaction for swap: ', swapTransaction);

    return swapTransaction.data;
  }
//endregion OneInch v50

//region OneInch v52
  static apiRequestUrlV52(chainId: number, methodName: string, queryParams: string) {
    const apiBaseUrl = 'https://api.1inch.dev/swap/v5.2/' + chainId;

    const r = (new URLSearchParams(JSON.parse(queryParams))).toString();
    return apiBaseUrl + methodName + '?' + r;
  }
  static async buildTxForSwapV52(chainId: number, params: string, tries: number = 2) {
    const url = this.apiRequestUrlV52(chainId,'/swap', params);
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

  static async buildSwapTransactionDataOneInchV52(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amount: BigNumber,
    from: string
  ) : Promise<BytesLike> {
    // https://portal.1inch.dev/documentation/swap/quick-start
    // v5.2 uses different set swap params then v5.0

    const params = {
      src: tokenIn,
      dst: tokenOut,
      amount: amount.toString(),
      from,
      slippage: 1,
      disableEstimate: true,
      allowPartialFill: false,
      // protocols: 'POLYGON_CURVE', // 'POLYGON_BALANCER_V2',
    };

    const swapTransaction = await AggregatorUtils.buildTxForSwap(chainId, JSON.stringify(params));
    console.log('Transaction for swap: ', swapTransaction);

    return swapTransaction.data;
  }
//endregion OneInch v52
}
