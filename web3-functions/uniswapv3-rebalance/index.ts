import { Web3Function, Web3FunctionContext } from '@gelatonetwork/web3-functions-sdk';
import { BigNumber, Contract } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import { ERC20_ABI, quoteOneInch, quoteOpenOcean, STRATEGY_ABI } from '../w3f-utils';
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";

// npx hardhat w3f-deploy uniswapv3-rebalance

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

  if (quote[1].gt(0)) {
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

      const aggQuotes = await Promise.all([
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

      const sortedAggQuotes = aggQuotes
        .filter(p => p !== undefined)
        .sort((p1, p2) => BigNumber.from(p1.outAmount).lt(BigNumber.from(p2.outAmount)) ? 1 : -1);
      if (sortedAggQuotes.length > 0) {
        const to = sortedAggQuotes[0].to;
        const data = sortedAggQuotes[0].data;
        return {
          canExec: true,
          callData: [
            {
              to: strategyAddress,
              data: strategy.interface.encodeFunctionData('rebalanceSwapByAgg', [quote[0], quote[1], to, data]),
            },
          ],
        };
      } else {
        return {
          canExec: false,
          message: 'All aggregators returned errors.',
        };
      }
    }
    return {
      canExec: false,
      message: 'Cant get agg swap quote.',
    };
  } else {
    return {
      canExec: true,
      callData: [
        {
          to: strategyAddress,
          data: strategy.interface.encodeFunctionData('rebalanceSwapByAgg', [false, BigNumber.from(0), MaticAddresses.AGG_ONEINCH_V5, '0x']),
        },
      ],
    };
  }
});
