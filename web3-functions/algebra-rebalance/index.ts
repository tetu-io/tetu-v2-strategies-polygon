import { Web3Function, Web3FunctionContext } from '@gelatonetwork/web3-functions-sdk';
import { BigNumber, Contract } from 'ethers';
import ky from 'ky';
import { formatUnits } from 'ethers/lib/utils';

const STRATEGY_ABI = [
  'function needRebalance() external view returns (bool)',
  'function quoteRebalanceSwap() external returns (bool, uint)',
  'function rebalanceSwapByAgg(bool direction, uint amount, address agg, bytes memory swapData) external',
  'function getState() external view returns (address, address, address, int24, int24, int24, int24, uint128, bool, uint, address, uint[] memory)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint)',
];

interface IAggQuote {
  to: string,
  data: string,
  outAmount: string
}

async function quoteOneInch(
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
  const url = `https://api.1inch.io/v5.0/${chainId}/swap?${(new URLSearchParams(JSON.parse(JSON.stringify(params)))).toString()}`;
  const quote: { tx?: { to?: string, data?: string }, toTokenAmount?: string } = await ky
    .get(url, { timeout: 5_000, retry: 0 })
    .json();
  return quote && quote.tx && quote.tx.data && quote.tx.to && quote.toTokenAmount ? {
    to: quote.tx.to,
    data: quote.tx.data,
    outAmount: quote.toTokenAmount,
  } : undefined;
}

const openOceanChains = {
  '1': 'eth',
  '137': 'polygon',
  '56': 'bsc',
  '42161': 'arbitrum',
  '10': 'optimism',
};

async function quoteOpenOcean(
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
  const quote: { data: { to?: string, data?: string, outAmount?: string } } = await ky
    .get(url, { timeout: 5_000, retry: 0 })
    .json();
  return quote && quote.data && quote.data.to && quote.data.data && quote.data.outAmount ? {
    to: quote.data.to,
    data: quote.data.data,
    outAmount: quote.data.outAmount,
  } : undefined;
}

Web3Function.onRun(async(context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;
  const strategyAddress = userArgs.strategy as string;
  const agg = (userArgs.agg as string ?? '').trim();
  const oneInchProtocols = (userArgs.oneInchProtocols as string ?? '').trim();
  const provider = multiChainProvider.default();
  const chainId = (await provider.getNetwork()).chainId;
  const strategy = new Contract(strategyAddress, STRATEGY_ABI, provider);
  const isNeedRebalance = await strategy.needRebalance();

  if (!isNeedRebalance) {
    return {
      canExec: false,
      message: 'Not need rebalance',
    };
  }

  const state = await strategy.getState();
  const quote = await strategy.callStatic.quoteRebalanceSwap();

  if (agg === '1inch') {
    const aggQuote = await quoteOneInch(
      quote[0] ? state[0] : state[1],
      quote[0] ? state[1] : state[0],
      quote[1].toString(),
      strategyAddress,
      chainId,
      oneInchProtocols !== '' ? oneInchProtocols : undefined,
    );
    if (aggQuote) {
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData(
              'rebalanceSwapByAgg',
              [quote[0], quote[1], aggQuote.to, aggQuote.data],
            ),
          },
        ],
      };
    }
  } else if (agg === 'openocean') {
    const tokenIn = new Contract(quote[0] ? state[0] : state[1], ERC20_ABI, provider);
    const decimals = await tokenIn.decimals();
    const aggQuote = await quoteOpenOcean(
      quote[0] ? state[0] : state[1],
      quote[0] ? state[1] : state[0],
      formatUnits(quote[1], decimals),
      strategyAddress,
      chainId,
    );
    if (aggQuote) {
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData(
              'rebalanceSwapByAgg',
              [quote[0], quote[1], aggQuote.to, aggQuote.data],
            ),
          },
        ],
      };
    }
  } else {
    const tokenIn = new Contract(quote[0] ? state[0] : state[1], ERC20_ABI, provider);
    const decimals = await tokenIn.decimals();

    const aggQuotes = await Promise.allSettled([
      quoteOneInch(
        quote[0] ? state[0] : state[1],
        quote[0] ? state[1] : state[0],
        quote[1].toString(),
        strategyAddress,
        chainId,
        userArgs.oneInchProtocols as string || undefined,
      ),
      quoteOpenOcean(
        quote[0] ? state[0] : state[1],
        quote[0] ? state[1] : state[0],
        formatUnits(quote[1], decimals),
        strategyAddress,
        chainId,
      ),
    ]);

    // tslint:disable-next-line:ban-ts-ignore
    // @ts-ignore
    const sortedAggQuotes = aggQuotes.filter(p => p.status === 'fulfilled').sort((p1, p2) => BigNumber.from(p1.value.outAmount).lt(BigNumber.from(p2.value.outAmount)) ? 1 : -1);
    if (sortedAggQuotes.length > 0) {
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      const to = sortedAggQuotes[0].value.to;
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      const data = sortedAggQuotes[0].value.data;
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData('rebalanceSwapByAgg', [quote[0], quote[1], to, data]),
          },
        ],
      };
    }
  }

  return {
    canExec: false,
    message: 'Cant get agg swap quote.',
  };
});
