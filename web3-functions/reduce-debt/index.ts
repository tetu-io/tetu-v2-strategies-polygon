import { Web3Function, Web3FunctionContext } from '@gelatonetwork/web3-functions-sdk'
import { runResolver } from '../w3f-utils'
import ky from 'ky'

// npx hardhat w3f-deploy reduce-debt

const fetchFuncKy = async (url: string) => {
  return ky
    .get(url, { timeout: 5_000, retry: 3 })
    .json()
}

Web3Function.onRun(async(context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context
  const strategyAddress = userArgs.strategy as string
  const readerAddress = userArgs.reader as string
  const configAddress = userArgs.config as string

  // const allowedLockedPercent = userArgs.allowedLockedPercent as number || 25
  const agg = (userArgs.agg as string ?? '').trim()
  const oneInchProtocols = (userArgs.oneInchProtocols as string ?? '').trim()
  const provider = multiChainProvider.default()

  return runResolver(
    provider,
    strategyAddress,
    readerAddress,
    configAddress,
    agg,
    oneInchProtocols,
    fetchFuncKy
  )
})
