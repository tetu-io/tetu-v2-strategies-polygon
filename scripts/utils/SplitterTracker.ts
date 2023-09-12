/* tslint:disable:no-trailing-whitespace */
import { ethers } from 'hardhat';
import {deployAddresses} from "../addresses/deploy-addresses";
import {
  StrategyBaseV2, StrategyBaseV2__factory, StrategySplitterV2__factory,
  TetuVaultV2__factory, UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory,
  UniswapV3ConverterStrategyLogicLib__factory
} from "../../typechain";
import {Web3Utils} from "./Web3Utils";
import {BigNumber, utils} from "ethers";
import {UniswapV3Utils} from "./UniswapV3Utils";
import {formatUnits} from "ethers/lib/utils";
import { Misc } from './Misc';
import { EnvSetup } from './EnvSetup';

const trackSplitters = [
  deployAddresses.SPLITTER_USDC_ADDRESS.matic,
]

const startBlock = 41300000

async function main() {
  if (Misc.getChainId() !== 137) {
    console.log('Tracker works only in polygon network [137]')
    process.exit(1)
  }

  const signer = (await ethers.getSigners())[0]
  const uniswapV3StrategyRebalanceTopic = UniswapV3ConverterStrategyLogicLib__factory.createInterface().getEventTopic(UniswapV3ConverterStrategyLogicLib__factory.createInterface().getEvent('Rebalanced'))
  const splitterHardworkTopic = StrategySplitterV2__factory.createInterface().getEventTopic(StrategySplitterV2__factory.createInterface().getEvent('HardWork'))

  const rpc = EnvSetup.getEnv().maticRpcUrl
  const provider = new ethers.providers.JsonRpcProvider(rpc)

  const curBlock = await ethers.provider.getBlockNumber()

  for (const splitterAddress of trackSplitters) {
    const topics: string[] = [splitterHardworkTopic]
    const contracts: string[] = [splitterAddress]
    const strategiesStats: {[addr:string]: {earned0: BigNumber, earned1: BigNumber, lost: BigNumber}} = {}

    const splitter = StrategySplitterV2__factory.connect(splitterAddress, signer)
    const vault = TetuVaultV2__factory.connect(await splitter.vault(), signer)
    const totalStrategies = (await splitter.strategiesLength()).toNumber()
    console.log(`Vault ${await vault.name()}`)

    for (let i = 0; i < totalStrategies; i++) {
      const strategy = StrategyBaseV2__factory.connect(await splitter.strategies(i), signer)
      const platform = await strategy.PLATFORM()
      console.log(`Strategy ${await strategy.NAME()}. Platform: ${platform}`)

      strategiesStats[strategy.address] = {
        earned0: BigNumber.from(0),
        earned1: BigNumber.from(0),
        lost: BigNumber.from(0),
      }

      /*if (platform === 'UniswapV3') {
        if (!topics.includes(uniswapV3StrategyRebalanceTopic)) {
          topics.push(uniswapV3StrategyRebalanceTopic)
        }
        contracts.push(strategy.address)
      }*/
    }

    // parse HardWork events
    const logs = await Web3Utils.parseLogs(
      contracts,
      topics,
      startBlock,
      curBlock
    );
    console.log('logs', logs.length);

    for (const log of logs) {
      if (log.topics.includes(splitterHardworkTopic)) {
        console.log(`HardWork at block ${log.blockNumber}`)
        for (const strategyAddress of Object.keys(strategiesStats)) {
          let strategy: StrategyBaseV2|UniswapV3ConverterStrategy = StrategyBaseV2__factory.connect(strategyAddress, provider)
          if (await strategy.PLATFORM() === 'UniswapV3') {
            strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, provider)
            const state = await strategy.getState({
              blockTag: log.blockNumber - 1
            })

            const fees = await UniswapV3Utils.getFees(state.pool, state.lowerTick, state.upperTick, strategy.address, log.blockNumber - 1)
            console.log('Earned:', formatUnits(state.rebalanceResults[0].add(state.rebalanceResults[1]).add(fees[0]).add(fees[1]).sub(state.rebalanceResults[2]), 6))

            strategiesStats[strategyAddress].earned0 = strategiesStats[strategyAddress].earned0.add(state.rebalanceResults[0]).add(fees[0])
            strategiesStats[strategyAddress].earned1 = strategiesStats[strategyAddress].earned1.add(state.rebalanceResults[1]).add(fees[1])
            strategiesStats[strategyAddress].lost = strategiesStats[strategyAddress].lost.add(state.rebalanceResults[2])
          }
        }
      }
    }

    let totalEarned0 = BigNumber.from(0)
    let totalEarned1 = BigNumber.from(0)
    let totalLoss = BigNumber.from(0)
    for (const strategyAddress of Object.keys(strategiesStats)) {
      totalEarned0 = totalEarned0.add(strategiesStats[strategyAddress].earned0)
      totalEarned1 = totalEarned1.add(strategiesStats[strategyAddress].earned1)
      totalLoss = totalLoss.add(strategiesStats[strategyAddress].lost)
    }

    // todo use prices and decimals for various assets
    console.log(`Total earned approximately: ${formatUnits(totalEarned0.add(totalEarned1), 6)} USD. Total loss: ${formatUnits(totalLoss.toString(), 6)} USD.`)

  }

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
