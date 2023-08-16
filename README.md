# <img src="tetu_contracts.svg" alt="Tetu.io">

[![codecov](https://codecov.io/gh/tetu-io/tetu-v2-strategies-polygon/branch/master/graph/badge.svg?token=FJ38EG24U7)](https://codecov.io/gh/tetu-io/tetu-v2-strategies-polygon)

## Links

Web: https://tetu.io/

Docs: https://docs.tetu.io/

Discord: https://discord.gg/DSUKVEYuax

Twitter: https://twitter.com/tetu_io

## Setup new UniswapV3 based strategy

* * [operator] ```hardhat deploy --network matic```
* * [tetu governance] announce strategy for splitter
* * [converter governance] converterController.setWhitelistValues(strategyAddrress, true)
* * [tetu governance] check liquidator routes and add if it is needed
* * [operator] strategy.setLiquidationThreshold((asset, threshold) (for each 1000)
* * [operator] strategy.seReinvestThreholdPercent((thresholdPerc18) (10)
* * [operator] strategy.setStrategyProfitHolder(strategyAddrress)
* * [operator] rebalanceDebtConfig.setConfig(strategyAddr, lockedPercentForDelayedRebalance, lockedPercentForForcedRebalance, rebalanceDebtDelay)
* * [tetu governance] Register RebalanceResolver as operator
* * [operator] add task for NSR with RebalanceResolver address, register task executer in the resolver
* [operator] run on server ```npm run rebalance-debt:matic``` with env vars set
* [operator] after 18h add strategy to splitter
