import { Web3Function, Web3FunctionContext } from '@gelatonetwork/web3-functions-sdk'
import { BigNumber, Contract } from 'ethers'
import {defaultAbiCoder, formatUnits} from 'ethers/lib/utils'
import {CONFIG_ABI, ERC20_ABI, quoteOneInch, quoteOpenOcean, READER_ABI, STRATEGY_ABI, ZERO_ADDRESS} from '../w3f-utils'

// npx hardhat w3f-deploy uniswapv3-reduce-debt

Web3Function.onRun(async(context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context
  const strategyAddress = userArgs.strategy as string
  const readerAddress = userArgs.reader as string
  const configAddress = userArgs.config as string

  // const allowedLockedPercent = userArgs.allowedLockedPercent as number || 25
  const agg = (userArgs.agg as string ?? '').trim()
  const oneInchProtocols = (userArgs.oneInchProtocols as string ?? '').trim()
  const provider = multiChainProvider.default()
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
  console.log('isFuseTriggered', isFuseTriggered)

  const percent = r[0].mul(100).div(r[1]).toNumber()
  console.log("Locked percent", percent)
  if (!isFuseTriggered && percent <= allowedLockedPercent) {
    return {
      canExec: false,
      message: `Not need to reduce debt. Current locked: ${percent}%. Max allowed locked: ${allowedLockedPercent}%`,
    }
  }

  if (isFuseTriggered && percent === 0) {
    return {
      canExec: false,
      message: `Not need to reduce debt. Fuse triggered. Current locked: ${percent}%.`,
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
    console.log('Last block timestamp', ts)
    const lastRebalanceNoSwaps = defaultState[2][12].toNumber()
    const delay = config[2].toNumber()
    console.log('Last rebalanceNoSwaps', lastRebalanceNoSwaps)
    console.log('Delay', delay)
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
      ["uint256"],
      [PLAN_REPAY_SWAP_REPAY]
    )
    : defaultAbiCoder.encode(
      ["uint256", "uint256"],
      [PLAN_SWAP_REPAY, 0]
    )

  const quote = await strategy.callStatic.quoteWithdrawByAgg(planEntryData)

  if (quote[0] === ZERO_ADDRESS) {
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
                ZERO_ADDRESS,
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
                1
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
                quote[0] ? tokens[0] : tokens[1],
                aggQuote.to,
                quote[1],
                aggQuote.data,
                planEntryData,
                1
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
        quote[0] ? tokens[0] : tokens[1],
        quote[0] ? tokens[1] : tokens[0],
        quote[1].toString(),
        strategyAddress,
        chainId,
        userArgs.oneInchProtocols as string || undefined,
      ),
      quoteOpenOcean(
        quote[0] ? tokens[0] : tokens[1],
        quote[0] ? tokens[1] : tokens[0],
        formatUnits(quote[1], decimals),
        strategyAddress,
        chainId,
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
                quote[0] ? tokens[0] : tokens[1],
                to,
                quote[1],
                data,
                planEntryData,
                1
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
})
