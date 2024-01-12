# <img src="tetu_contracts.svg" alt="Tetu.io">

[![codecov](https://codecov.io/gh/tetu-io/tetu-v2-strategies-polygon/branch/master/graph/badge.svg?token=FJ38EG24U7)](https://codecov.io/gh/tetu-io/tetu-v2-strategies-polygon)

## Links

Web: https://tetu.io/

Docs: https://docs.tetu.io/

Discord: https://discord.gg/DSUKVEYuax

Twitter: https://twitter.com/tetu_io

## Setup new ConverterStrategyBase-based strategy
chain = ['matic', 'base', 'zkevm']

1. [operator] ```npm run deploy-[chain]```
1. [tetu governance] announce strategy for splitter
1. [converter governance] whitelist strategy: converterController([TetuConverterAddress]).setWhitelistValues([strategyAddress], true)
1. [tetu governance] check liquidator routes and add if it is needed
1. [operator] strategy.setLiquidationThreshold((asset, threshold) [for each 1000]
1. [operator] strategy.setReinvestThresholdPercent((thresholdPercent18) [10]
1. [operator] strategy.setStrategyProfitHolder(strategyAddress)
1. [tetu governance] change if need strategy.setupPerformanceFee(30000, treasury,0)
1. [operator] rebalanceDebtConfig.setConfig(strategyAddr, lockedPercentForDelayedRebalance, lockedPercentForForcedRebalance, rebalanceDebtDelay) [3, 50, 600]
1. ~~[tetu governance] Register RebalanceResolver as operator~~
1. ~~[operator] add task for NSR with RebalanceResolver address, register task executer in the resolver~~
1. [operator] run locally ```set-settings:[chain]```
1. [operator] run on server ```npm run rebalance:[chain]``` with env vars set
1. [operator] after 18h add strategy to splitter
1. [converter governance] register keeper-resolver as operator in keeper: [Keeper].changeOperatorStatus([], 1) 
