/* tslint:disable:no-trailing-whitespace */
import {UniswapV3Utils} from "../utils/UniswapV3Utils";
import {ethers} from "hardhat";
import {IStrategyParams, MutateDirection} from "./types";
import {IERC20Metadata__factory} from "../../typechain";
import {formatUnits, getAddress, parseUnits} from "ethers/lib/utils";
import {deployBacktestSystem} from "./deployBacktestSystem";
import {getApr, showBacktestResult, strategyBacktest} from "./strategyBacktest";
import {AppDataSource} from "./db/data-source";
import {Result} from "./entity/Result";
import {Task} from "./entity/Task";
import {Repository} from "typeorm";

async function isTaskDone(task: Task, resultRepository: Repository<Result>) {
  // check results in progress
  const resultsInProgressCount = await resultRepository
    .countBy({
      task,
      done: false
    })
  return !resultsInProgressCount
}

function getRandomInt(max: number) {
  return Math.floor(Math.random() * (max + 1));
}

function mutateTickRange(original: number, direction: MutateDirection, tickSpacing: number, maxMutateSpacings: number = 5) {
  const spacings = original / tickSpacing
  const maxSpacingsMutate = spacings - 1 >= maxMutateSpacings ? maxMutateSpacings : spacings - 1
  const changeSpacings = (getRandomInt(maxSpacingsMutate - 1) + 1) * tickSpacing

  if (spacings === 1) {
    return getRandomInt(1) ? original + changeSpacings : original
  }

  if (direction === MutateDirection.DECREASE) {
    return original - changeSpacings
  } else if (direction === MutateDirection.INCREASE) {
    return original + changeSpacings
  } else {
    return getRandomInt(1) ? original + changeSpacings : original - changeSpacings
  }
}

function mutateRebalanceTickRange(original: number, max: number, tickSpacing: number) {
  if (original >= max) {
    const mutate = !!getRandomInt(1)
    if (mutate) {
      return mutateTickRange(max, MutateDirection.DECREASE, tickSpacing, 3)
    } else {
      return max
    }
  }

  return mutateTickRange(original, MutateDirection.UNKNOWN, tickSpacing)
}

function bornGen0(task: Task, tickSpacing: number): IStrategyParams {
  return {
    tickRange: getRandomInt((task.config.maxTickRange - tickSpacing) / tickSpacing) * tickSpacing + tickSpacing,
    rebalanceTickRange: getRandomInt((task.config.maxRebalanceTickRange - tickSpacing) / tickSpacing) * tickSpacing + tickSpacing,
  }
}

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  if (chainId !== 31337) {
    console.error(`Incorrect hardhat chainId ${chainId}. Need 31337.`)
    process.exit(-1)
  }
  const rpc = process.env.TETU_MATIC_RPC_URL
  const provider = new ethers.providers.JsonRpcProvider(rpc)
  const providerChainId = (await provider.getNetwork()).chainId
  if (providerChainId !== 137) {
    console.error(`Incorrect rpc provider chainId ${providerChainId}. Need 137.`)
    process.exit(-1)
  }

  await AppDataSource.initialize()
    .catch((error) => {
      console.log(error)
      process.exit(-1)
    })

  console.log('=== Uniswap V3 backtester worker ===')

  // get task
  const taskRepository = AppDataSource.getRepository(Task)
  const task = await taskRepository
    .findOne({
      where: {
        done: false,
      },
      order: {
        id: 'ASC',
      },
    })
  if (!task) {
    console.log('No tasks.')
    return
  }

  task.pool = getAddress(task.pool)
  task.vaultAsset = getAddress(task.vaultAsset)
  const poolData = await UniswapV3Utils.getPoolData(task.pool)
  console.log(`Uniswap V3 pool: ${poolData.token0Symbol}-${poolData.token1Symbol}-${poolData.fee} [${task.pool}], tick spacing: ${poolData.tickSpacing}.`)
  const vaultAsset = IERC20Metadata__factory.connect(task.vaultAsset, provider)
  const vaultAssetDecimals = await vaultAsset.decimals()
  const investAmount = parseUnits(task.investAmountUnits, vaultAssetDecimals)
  console.log(`Invest amount: ${formatUnits(investAmount, vaultAssetDecimals)} ${await vaultAsset.symbol()}`)
  const startTimestamp = (await provider.getBlock(task.startBlock)).timestamp
  const endTimestamp = (await provider.getBlock(task.endBlock)).timestamp
  console.log(`Start block: ${task.startBlock} (${new Date(startTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(startTimestamp *
    1000).toLocaleTimeString('en-US')}). End block: ${task.endBlock} (${new Date(endTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(endTimestamp * 1000).toLocaleTimeString('en-US')}).`)

  const resultRepository = AppDataSource.getRepository(Result)

  while(1) {
    let strategyParams:IStrategyParams|undefined
    let gen:number

    // get last gen
    const selectResult = await resultRepository
      .findOne({
        select: {
          id: true,
          gen: true,
        },
        where: [{
          task,
        }],
        order: {
          gen: 'DESC',
        },
      })
    const lastGen = selectResult ? selectResult.gen : 0
    console.log(`Last generation is ${lastGen}`)

    // count how much results of last gen are already done
    const alreadyDoneInGen = await resultRepository
      .countBy({
        gen: lastGen,
        done: true,
        task,
      })
    console.log(`Already done: ${alreadyDoneInGen} of ${task.config.minIndividualsPerGen}.`)

    if (alreadyDoneInGen < task.config.minIndividualsPerGen) {
      gen = lastGen
      console.log(`Creating results in gen ${gen}`)
      if (gen === 0) {
        console.log('Gen is 0 then generating new params')
        strategyParams = bornGen0(task, poolData.tickSpacing)
      }
    } else {
      gen = lastGen + 1
      if (gen === task.config.gens) {
        console.log(`All ${task.config.gens} created. Work done.`)
        if (await isTaskDone(task, resultRepository)) {
          task.done = true
          await taskRepository.save(task)
        }
        return
      }
      console.log(`Starting new gen ${gen}`)
    }

    if (!strategyParams) {
      console.log('Need crossover and mutation')

      // get best parents
      const parents = await resultRepository
        .find({
          where: {
            gen: gen - 1,
            done: true,
            task,
          },
          order: {
            apr: 'DESC',
          },
          take: task.config.bestIndividualsPerGen,
        })

      // console.log('Best parents', parents)

      // get max rebalanceTickRange
      let maxRebalanceTickRange = task.config.maxRebalanceTickRange
      const minRebalanceTickRangeWithoutRebalancesResult = await resultRepository
        .findOne({
          where: {
            gen: gen - 1,
            done: true,
            task,
            rebalances: 0,
          },
          order: {
            rebalanceTickRange: 'ASC',
          },
        })
      if (minRebalanceTickRangeWithoutRebalancesResult) {
        maxRebalanceTickRange = minRebalanceTickRangeWithoutRebalancesResult.rebalanceTickRange
      }
      console.log(`Max rebalance tick range: ${maxRebalanceTickRange}`)

      const parent1Index = getRandomInt(parents.length - 1)
      let parent2Index = parent1Index
      while (parent1Index === parent2Index) {
        parent2Index = getRandomInt(parents.length - 1)
      }
      const parent1 = parents[parent1Index]
      const parent2 = parents[parent2Index]

      console.log('Parent 1', parent1)
      console.log('Parent 2', parent2)

      // predict best tickRange mutation direction
      /*let */
      const tickRangeMutationDirection: MutateDirection = MutateDirection.UNKNOWN
      /*if (parent1.rebalances === parent2.rebalances) {
        if (parent1.apr !== parent2.apr) {
          if (parent1.apr > parent2.apr) {
            tickRangeMutationDirection = parent1.tickRange < parent2.tickRange ? MutateDirection.DECREASE : MutateDirection.INCREASE
          } else {
            tickRangeMutationDirection = parent1.tickRange < parent2.tickRange ? MutateDirection.INCREASE : MutateDirection.DECREASE
          }
        }
      }
      console.log('Tick range mutation direction', tickRangeMutationDirection)*/

      for (let i = 0; i < 50; i++) {
        // check exist
        const tickRange = mutateTickRange(parent1.tickRange, tickRangeMutationDirection, poolData.tickSpacing)
        const rebalanceTickRange = mutateRebalanceTickRange(parent2.rebalanceTickRange, maxRebalanceTickRange, poolData.tickSpacing)
        if (await resultRepository.countBy({
          task,
          tickRange,
          rebalanceTickRange,
        })) {
          console.log('Params already exist')
        } else {
          strategyParams = {
            tickRange,
            rebalanceTickRange,
          }
          break
        }
      }

      if (!strategyParams) {
        console.log('Cant find unique strategy params. Work done.')
        if (await isTaskDone(task, resultRepository)) {
          task.done = true
          await taskRepository.save(task)
        }
        return
      }
    }

    console.log(`Gen: ${gen}. Tick range: ${strategyParams.tickRange}. Rebalance tick range: ${strategyParams.rebalanceTickRange}.`)

    const result = new Result()
    result.gen = gen
    result.done = false
    result.task = task
    result.tickRange = strategyParams.tickRange
    result.rebalanceTickRange = strategyParams.rebalanceTickRange
    result.earned = ''
    result.apr = 0
    result.rebalances = 0
    await resultRepository.save(result)

    const liquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(task.pool), task.startBlock, task.config.liquiditySnapshotSurroundingTickSpacings)
    const signer = (await ethers.getSigners())[0];
    const contracts = await deployBacktestSystem(
      signer,
      liquiditySnapshot,
      getAddress(task.vaultAsset),
      poolData.token0,
      poolData.token1,
      poolData.fee,
      strategyParams.tickRange,
      strategyParams.rebalanceTickRange
    )

    const results = await strategyBacktest(
      signer,
      contracts.vault,
      contracts.strategy,
      contracts.uniswapV3Calee,
      contracts.uniswapV3Helper,
      liquiditySnapshot,
      task.investAmountUnits,
      task.startBlock,
      task.endBlock,
      getAddress(task.pool),
      0,
      true,
      true
    )

    await showBacktestResult(results)

    result.apr = getApr(results.earned, results.investAmount, results.startTimestamp, results.endTimestamp)
    result.earned = results.earned.toString()
    result.done = true
    result.rebalances = results.rebalances
    await resultRepository.save(result)
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
