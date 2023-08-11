import {StaticJsonRpcProvider} from "@ethersproject/providers/src.ts/url-json-rpc-provider";
import {BigNumber, Contract} from "ethers";
import {defaultAbiCoder, formatUnits} from "ethers/lib/utils";

const MAX_UINT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

const STRATEGY_ABI = [
  'function needRebalance() external view returns (bool)',
  'function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap)',
  'function withdrawByAggStep(address tokenToSwap_, address aggregator_, uint amountToSwap_, bytes memory swapData, bytes memory planEntryData, uint entryToPool) external returns (bool completed)',
  'function getDefaultState() external view returns (address[] memory addr, int24[] memory tickData, uint[] memory nums, bool[] memory boolValues)',
]

const ERC20_ABI = [
  'function decimals() external view returns (uint)',
]

const READER_ABI = [
  'function getLockedUnderlyingAmount(address strategy_) external view returns (uint estimatedUnderlyingAmount, uint totalAssets)',
]

const CONFIG_ABI = [
  'function strategyConfig(address strategy_) external view returns (uint lockedPercentForDelayedRebalance, uint lockedPercentForForcedRebalance, uint rebalanceDebtDelay)',
]

interface IAggQuote {
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
}

async function quoteOneInch(
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: string,
  fromAddress: string,
  chainId: number,
  protocols?: string,
  fetchFunc: (url: string) => Promise<Unknown>
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
  }
  const url = `https://api-tetu.1inch.io/v5.0/${chainId}/swap?${(new URLSearchParams(JSON.parse(JSON.stringify(params)))).toString()}`
  console.log('1inch API request', url)
  try {
    const quote: { tx?: { to?: string, data?: string }, toTokenAmount?: string } = await fetchFunc(url)
    if (quote && quote.tx && quote.tx.data && quote.tx.to && quote.toTokenAmount) {
      return {
        to: quote.tx.to,
        data: quote.tx.data,
        outAmount: quote.toTokenAmount,
      }
    } else {
      console.error('1inch can not fetch', url, quote, '\n')
      return undefined
    }
  } catch (e) {
    console.error('1inch error', url, e, '\n')
    return undefined
  }
}

async function quoteOpenOcean(
  inTokenAddress: string,
  outTokenAddress: string,
  amount: string,
  account: string,
  chainId: number,
  fetchFunc: (url: string) => Promise<Unknown>
): Promise<IAggQuote | undefined> {

  const params = {
    chain: openOceanChains[chainId.toString()],
    inTokenAddress,
    outTokenAddress,
    amount,
    account,
    slippage: '0.5',
    gasPrice: 30,
  }

  const url = `https://open-api.openocean.finance/v3/${openOceanChains[chainId.toString()]}/swap_quote?${(new URLSearchParams(
    JSON.parse(JSON.stringify(params)))).toString()}`
  console.log('OpenOcean API request', url)
  try {
    const quote: { data: { to?: string, data?: string, outAmount?: string } } = await fetchFunc(url)
    if (quote && quote.data && quote.data.to && quote.data.data && quote.data.outAmount) {
      return {
        to: quote.data.to,
        data: quote.data.data,
        outAmount: quote.data.outAmount,
      }
    } else {
      console.error('open ocean can not fetch', url, quote, '\n')
      return undefined
    }
  } catch (e) {
    console.error('open ocean error', url, e, '\n')
    return undefined
  }
}

export async function runResolver(
  provider: StaticJsonRpcProvider,
  strategyAddress: string,
  readerAddress: string,
  configAddress: string,
  agg: string,
  oneInchProtocols: string,
  fetchFunc: (url: string) => Promise<Unknown>
) {
  const chainId = (await provider.getNetwork()).chainId
  const strategy = new Contract(strategyAddress, STRATEGY_ABI, provider)
  const reader = new Contract(readerAddress, READER_ABI, provider)
  const configContract = new Contract(configAddress, CONFIG_ABI, provider)
  const config = await configContract.strategyConfig(strategyAddress)
  // console.log('Rebalance debt config', config)
  const allowedLockedPercent = config[0]
  const isNeedRebalance = await strategy.needRebalance()
  const r = await reader.getLockedUnderlyingAmount(strategyAddress) as [BigNumber, BigNumber]
  if (r[1].eq(0)) {
    return {
      canExec: false,
      message: 'Strategy dont have assets.',
    }
  }

  const defaultState = await strategy.getDefaultState()
  const isFuseTriggered =
    defaultState[2][1].toString() === '2'
    || defaultState[2][1].toString() === '3'
    || defaultState[2][2].toString() === '2'
    || defaultState[2][2].toString() === '3'
  const isWithdrawDone = defaultState[2][3].toNumber() > 0
  // console.log('isFuseTriggered', isFuseTriggered)
  // console.log('isWithdrawDone', isWithdrawDone)

  const percent = r[0].mul(100).div(r[1]).toNumber()
  // console.log("Locked percent", percent)
  if (!isFuseTriggered && percent <= allowedLockedPercent) {
    return {
      canExec: false,
      message: `Not need to reduce debt. Current locked: ${percent}%. Max allowed locked: ${allowedLockedPercent}%`,
    }
  }

  if (isFuseTriggered && percent === 0 && isWithdrawDone) {
    return {
      canExec: false,
      message: `Not need to reduce debt. Fuse triggered. Withdraw done. Current locked: ${percent}%.`,
    }
  }

  if (isNeedRebalance) {
    return {
      canExec: false,
      message: 'Need rebalance. Cant reduce debt now.',
    }
  }

  if (!isFuseTriggered && percent < config[1].toNumber()) {
    const ts = (await provider.getBlock(await provider.getBlockNumber())).timestamp
    // console.log('Last block timestamp', ts)
    const lastRebalanceNoSwaps = defaultState[2][12].toNumber()
    const delay = config[2].toNumber()
    // console.log('Last rebalanceNoSwaps', lastRebalanceNoSwaps)
    // console.log('Delay', delay)
    if (ts - lastRebalanceNoSwaps < delay) {
      return {
        canExec: false,
        message: `Waiting for delay ${delay} after rebalanceNoSwaps.`,
      }
    }
  }

  const PLAN_SWAP_REPAY = 0
  const PLAN_REPAY_SWAP_REPAY = 1

  const planEntryData = !isFuseTriggered
    ? defaultAbiCoder.encode(
      ["uint256", "uint256"],
      [PLAN_REPAY_SWAP_REPAY, MAX_UINT]
    )
    : defaultAbiCoder.encode(
      ["uint256", "uint256"],
      [PLAN_SWAP_REPAY, 0]
    )

  const quote = await strategy.callStatic.quoteWithdrawByAgg(planEntryData)

  if (quote[1].toString() === '0') {
    if (!isFuseTriggered) {
      return {
        canExec: false,
        message: 'Zero tokenToSwap.',
      }
    } else {
      const AGG_ONEINCH_V5 = '0x1111111254EEB25477B68fb85Ed929f73A960582'.toLowerCase()
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData(
              'withdrawByAggStep',
              [
                quote[0],
                AGG_ONEINCH_V5,
                0,
                '0x00',
                planEntryData,
                0
              ]
            ),
          },
        ],
      }
    }
  }

  const tokens = defaultState[0]

  const aToB = quote[0] === tokens[0]

  if (agg === '1inch') {
    const aggQuote = await quoteOneInch(
      aToB ? tokens[0] : tokens[1],
      aToB ? tokens[1] : tokens[0],
      quote[1].toString(),
      strategyAddress,
      chainId,
      oneInchProtocols !== '' ? oneInchProtocols : undefined,
      fetchFunc
    )
    if (aggQuote) {
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData(
              'withdrawByAggStep',
              [
                aToB ? tokens[0] : tokens[1],
                aggQuote.to,
                quote[1],
                aggQuote.data,
                planEntryData,
                isFuseTriggered ? 0 : 1
              ]
            ),
          },
        ],
      }
    }
  } else if (agg === 'openocean') {
    const tokenIn = new Contract(quote[0] ? tokens[0] : tokens[1], ERC20_ABI, provider)
    const decimals = await tokenIn.decimals()
    const aggQuote = await quoteOpenOcean(
      aToB ? tokens[0] : tokens[1],
      aToB ? tokens[1] : tokens[0],
      formatUnits(quote[1], decimals),
      strategyAddress,
      chainId,
      fetchFunc
    )
    if (aggQuote) {
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData(
              'withdrawByAggStep',
              [
                aToB ? tokens[0] : tokens[1],
                aggQuote.to,
                quote[1],
                aggQuote.data,
                planEntryData,
                isFuseTriggered ? 0 : 1
              ]
            ),
          },
        ],
      }
    }
  } else {
    const tokenIn = new Contract(quote[0] ? tokens[0] : tokens[1], ERC20_ABI, provider)
    const decimals = await tokenIn.decimals()

    const aggQuotes = await Promise.all([
      quoteOneInch(
        aToB ? tokens[0] : tokens[1],
        aToB ? tokens[1] : tokens[0],
        quote[1].toString(),
        strategyAddress,
        chainId,
        oneInchProtocols as string || undefined,
        fetchFunc
      ),
      quoteOpenOcean(
        aToB ? tokens[0] : tokens[1],
        aToB ? tokens[1] : tokens[0],
        formatUnits(quote[1], decimals),
        strategyAddress,
        chainId,
        fetchFunc
      ),
    ])

    const sortedAggQuotes = aggQuotes
      .filter(p => p !== undefined)
      .sort((p1, p2) => BigNumber.from(p1.outAmount).lt(BigNumber.from(p2.outAmount)) ? 1 : -1)
    if (sortedAggQuotes.length > 0) {
      const to = sortedAggQuotes[0].to
      const data = sortedAggQuotes[0].data
      return {
        canExec: true,
        callData: [
          {
            to: strategyAddress,
            data: strategy.interface.encodeFunctionData(
              'withdrawByAggStep',
              [
                aToB ? tokens[0] : tokens[1],
                to,
                quote[1],
                data,
                planEntryData,
                isFuseTriggered ? 0 : 1
              ]
            ),
          },
        ],
      }
    } else {
      return {
        canExec: false,
        message: 'All aggregators returned errors.',
      }
    }
  }

  return {
    canExec: false,
    message: 'Cant get agg swap quote.',
  }
}
