# <img src="tetu_contracts.svg" alt="Tetu.io">

[![codecov](https://codecov.io/gh/tetu-io/tetu-v2-strategies-polygon/branch/master/graph/badge.svg?token=FJ38EG24U7)](https://codecov.io/gh/tetu-io/tetu-v2-strategies-polygon)

## Links

Web: https://tetu.io/

Docs: https://docs.tetu.io/

Discord: https://discord.gg/DSUKVEYuax

Twitter: https://twitter.com/tetu_io

## Setup new UniswapV3 based strategy

* [deployer] ```hardhat deploy --network matic```
* [tetu governance] announce strategy for splitter
* [converter governance] converterController.setWhitelistValues(strategyAddrress, true)
* check liquidator routes and add if it is needed
* [operator] strategy.setLiquidationThreshold((asset, threshold)
* [operator] strategy.setStrategyProfitHolder(strategyAddrress)
* [operator] rebalanceDebtConfig.setConfig(strategyAddr, lockedPercentForDelayedRebalance, lockedPercentForForcedRebalance, rebalanceDebtDelay)
* [gelato user] add task for NSR with RebalanceResolver address
* [operator] run on server ```npm run rebalance-debt:matic``` with env vars set
* [tetu governance] after 18h add strategy to splitter
