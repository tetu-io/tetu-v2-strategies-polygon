import ky from 'ky';

export const STRATEGY_ABI = [
  'function needRebalance() external view returns (bool)',
  'function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap)',
  'function withdrawByAggStep(address[2] calldata tokenToSwapAndAggregator, uint amountToSwap_, bytes memory swapData, bytes memory planEntryData, uint entryToPool)  external returns (bool completed)',
  'function getState() external view returns (address, address, address, address, int24, int24, int24, int24, uint128, bool, uint, uint[] memory)',
];

export const ERC20_ABI = [
  'function decimals() external view returns (uint)',
];

export const READER_ABI = [
  'function getLockedUnderlyingAmount(address strategy_) external view returns (uint estimatedUnderlyingAmount, uint totalAssets)',
]

export interface IAggQuote {
  to: string,
  data: string,
  outAmount: string
}

const openOceanChains = {
  '1': 'eth',
  '137': 'polygon',
  '56': 'bsc',
  '42161': 'arbitrum',
  '10': 'optimism',
};

export async function quoteOneInch(
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: string,
  fromAddress: string,
  chainId: number,
  protocols?: string,
): Promise<IAggQuote | undefined> {
  const params = {
    fromTokenAddress,
    toTokenAddress,
    amount,
    fromAddress,
    slippage: '0.5',
    disableEstimate: true,
    allowPartialFill: false,
    protocols,
  };
  const url = `https://api-tetu.1inch.io/v5.0/${chainId}/swap?${(new URLSearchParams(JSON.parse(JSON.stringify(params)))).toString()}`;
  console.log(url)
  try {
    const quote: { tx?: { to?: string, data?: string }, toTokenAmount?: string } = await ky
      .get(url, { timeout: 5_000, retry: 3 })
      .json();
    if (quote && quote.tx && quote.tx.data && quote.tx.to && quote.toTokenAmount) {
      return {
        to: quote.tx.to,
        data: quote.tx.data,
        outAmount: quote.toTokenAmount,
      };
    } else {
      console.error('1inch can not fetch', url, quote, '\n');
      return undefined;
    }
  } catch (e) {
    console.error('1inch error', url, e, '\n');
    return undefined;
  }
}

export async function quoteOpenOcean(
  inTokenAddress: string,
  outTokenAddress: string,
  amount: string,
  account: string,
  chainId: number,
): Promise<IAggQuote | undefined> {

  const params = {
    chain: openOceanChains[chainId.toString()],
    inTokenAddress,
    outTokenAddress,
    amount,
    account,
    slippage: '0.5',
    gasPrice: 30,
  };

  const url = `https://open-api.openocean.finance/v3/${openOceanChains[chainId.toString()]}/swap_quote?${(new URLSearchParams(
    JSON.parse(JSON.stringify(params)))).toString()}`;
  try {
    const quote: { data: { to?: string, data?: string, outAmount?: string } } = await ky
      .get(url, { timeout: 5_000, retry: 3 })
      .json();
    if (quote && quote.data && quote.data.to && quote.data.data && quote.data.outAmount) {
      return {
        to: quote.data.to,
        data: quote.data.data,
        outAmount: quote.data.outAmount,
      };
    } else {
      console.error('open ocean can not fetch', url, quote, '\n');
      return undefined;
    }
  } catch (e) {
    console.error('open ocean error', url, e, '\n');
    return undefined;
  }
}
