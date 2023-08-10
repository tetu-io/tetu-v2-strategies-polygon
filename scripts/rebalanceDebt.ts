/* tslint:disable */
import hre, {ethers} from "hardhat";
import {runResolver} from "../web3-functions/w3f-utils";
import axios from "axios";

// test rebalance debt
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtW3F.ts
// TETU_REBALANCE_DEBT_STRATEGIES=<address> TETU_PAIR_BASED_STRATEGY_READER=<address> TETU_REBALANCE_DEBT_CONFIG=<address> hardhat run scripts/rebalanceDebt.ts --network localhost

// test fuse
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtOnFuseW3F.ts
// TETU_REBALANCE_DEBT_STRATEGIES=<address> TETU_PAIR_BASED_STRATEGY_READER=<address> TETU_REBALANCE_DEBT_CONFIG=<address> hardhat run scripts/rebalanceDebt.ts --network localhost

const fetchFuncAxios = async (url: string) => {
  return (await axios.get(url)).data
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  console.log('Strategies debt rebalancer')

  if (!['localhost', 'matic'].includes(hre.network.name)) {
    console.log('Unsupported network', hre.network.name)
    console.log('Only localhost and matic networks supported')
    process.exit(-1)
  }

  const strategiesStr = process.env.TETU_REBALANCE_DEBT_STRATEGIES
  if (!strategiesStr) {
    console.error('Put strategy addresses to env TETU_REBALANCE_DEBT_STRATEGIES (comma separated)')
    process.exit(-1)
  }

  const configAddress = process.env.TETU_REBALANCE_DEBT_CONFIG
  if (!configAddress) {
    console.error('Put RebalanceDebtConfig deployed contract address to env TETU_REBALANCE_DEBT_CONFIG')
    process.exit(-1)
  }

  const readerAddress = process.env.TETU_PAIR_BASED_STRATEGY_READER
  if (!readerAddress) {
    console.error('Put PairBasedStrategyReader deployed contract address to env TETU_PAIR_BASED_STRATEGY_READER')
    process.exit(-1)
  }

  const agg = process.env.TETU_REBALANCE_DEBT_AGG || ''
  const oneInchProtocols = process.env.TETU_REBALANCE_DEBT_1INCH_PROTOCOLS || ''

  const strateies = strategiesStr.split(',')
  console.log('Strategies', strateies)

  const provider = ethers.provider
  const signer = (await ethers.getSigners())[0]

  while(1) {
    for (const strategyAddress of strateies) {
      const result = await runResolver(
        provider,
        strategyAddress,
        readerAddress,
        configAddress,
        agg,
        oneInchProtocols,
        fetchFuncAxios
      )

      if (result) {
        if (result.canExec) {
          process.stdout.write('Send tx.. ')
          const response = await signer.sendTransaction({ to: result.callData[0].to, data: result.callData[0].data, gasLimit: 10_000_000 })
          process.stdout.write(`[tx: ${response.hash}].. `)
          const receipt = await response.wait()
          console.log(`done with ${receipt.gasUsed} gas`)
        } else {
          console.log(result)
        }
      }

    }

    await sleep(3000)
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
})