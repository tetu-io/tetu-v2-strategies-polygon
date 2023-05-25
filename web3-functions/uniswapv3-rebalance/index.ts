import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky from "ky";

const STRATEGY_ABI = [
  "function needRebalance() external view returns (bool)",
  "function quoteRebalanceSwap() external returns (bool, uint)",
  "function rebalanceSwapByAgg(bool direction, uint amount, address agg, bytes memory swapData) external",
  "function getState() external view returns (address, address, address, int24, int24, int24, int24, uint128, bool, uint, uint[] memory)",
]

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;
  const strategyAddress = userArgs.strategy as string
  const provider = multiChainProvider.default()
  const chainId = (await provider.getNetwork()).chainId
  const strategy = new Contract(strategyAddress, STRATEGY_ABI, provider)
  const isNeedRebalance = await strategy.needRebalance()

  if (!isNeedRebalance) {
    return {
      canExec: false,
      message: "Not need rebalance",
    };
  }

  const state = await strategy.getState()
  const quote = await strategy.callStatic.quoteRebalanceSwap()

  const params = {
    fromTokenAddress: quote[0] ? state[0] : state[1],
    toTokenAddress: quote[0] ? state[1] : state[0],
    amount: quote[1].toString(),
    fromAddress: strategyAddress,
    slippage: '0.5',
    disableEstimate: true,
    allowPartialFill: false,
    protocols: userArgs.oneInchProtocols as string || undefined,
  }

  const url = `https://api.1inch.io/v5.0/${chainId}/swap?${(new URLSearchParams(JSON.parse(JSON.stringify(params)))).toString()}`

  const oneInchQuote: {tx?: {to?: string, data?: string}} = await ky
    .get(url, { timeout: 5_000, retry: 0 })
    .json();

  if (oneInchQuote && oneInchQuote.tx && oneInchQuote.tx.data && oneInchQuote.tx.to) {
    return {
      canExec: true,
      callData: [
        {
          to: strategyAddress,
          data: strategy.interface.encodeFunctionData("rebalanceSwapByAgg", [quote[0], quote[1], oneInchQuote.tx.to, oneInchQuote.tx.data]),
        },
      ],
    };
  }

  return {
    canExec: false,
    message: "Cant get agg swap quote.",
  };
})
