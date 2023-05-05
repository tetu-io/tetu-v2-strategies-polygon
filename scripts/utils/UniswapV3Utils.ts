/* tslint:disable:no-trailing-whitespace */
import {BigNumber, ethers} from "ethers";
import {UniswapV3Pool__factory} from "../../typechain";
import fs from "fs";
import { createClient } from 'urql'
import 'isomorphic-unfetch';
import {Misc} from "./Misc";

export class UniswapV3Utils {
  static SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon'

  public static async getPoolTransactions(poolAddr: string, startBlock: number, endBlock: number) {
    console.log(`Get Uniswap V3 pool transactions for ${poolAddr} for blocks ${startBlock} - ${endBlock}`)

    const cacheDir = 'tmp';
    const cacheFileName = `cache_uniswapV3PoolTransactions-${poolAddr}-${startBlock}-${endBlock}.json`;

    let r: IPoolTransaction[] = []

    const fsContent = fs.existsSync(`${cacheDir}/${cacheFileName}`) ? fs.readFileSync(`${cacheDir}/${cacheFileName}`) : null
    if (fsContent) {
      r = JSON.parse(fsContent.toString())
      console.log(`Got from cache (${r.length} txs).`)
    } else {
      const rpc = process.env.TETU_MATIC_RPC_URL
      const provider = new ethers.providers.JsonRpcProvider(rpc)
      const startTimestamp = (await provider.getBlock(startBlock)).timestamp;
      const endTimestamp = (await provider.getBlock(endBlock)).timestamp;
      console.log(`Timestamps: ${startTimestamp} - ${endTimestamp}`)

      let usedTxIds: {[id: string]: boolean} = {}
      let got = 0

      const client = createClient({
        url: this.SUBGRAPH,
      })
      let lastTimestamp = startTimestamp
      let query
      console.log('Fetch mints..')
      while (true) {
        query = this.getMintsQuery(poolAddr, lastTimestamp, endTimestamp)
        const data = await client.query(query, {}).toPromise()
        if (!data?.data?.mints) {
          console.log('Error fetching from subgraph')
          break;
        }

        for (const mint of data.data.mints) {
          if (!usedTxIds[mint.id]) {
            r.push({
              type: TransactionType.MINT,
              timestamp: parseInt(mint.timestamp, 10),
              amount: mint.amount,
              amount0: mint.amount0,
              amount1: mint.amount1,
              tickLower: parseInt(mint.tickLower, 10),
              tickUpper: parseInt(mint.tickUpper, 10),
            })

            usedTxIds[mint.id] = true
            got++
          }
        }

        lastTimestamp = data.data.mints[data.data.mints.length - 1].timestamp
        if (data.data.mints.length < 1000) {
          break
        }
      }
      console.log(`Got ${got} mints.`)

      console.log('Fetch burns..')
      lastTimestamp = startTimestamp
      got = 0
      usedTxIds = {}
      while (true) {
        query = this.getBurnsQuery(poolAddr, lastTimestamp, endTimestamp)
        const data = await client.query(query, {}).toPromise()
        if (!data?.data?.burns) {
          console.log('Error fetching from subgraph')
          break;
        }

        for (const burn of data.data.burns) {
          if (!usedTxIds[burn.id]) {
            r.push({
              type: TransactionType.BURN,
              timestamp: parseInt(burn.timestamp, 10),
              amount: burn.amount,
              amount0: burn.amount0,
              amount1: burn.amount1,
              tickLower: parseInt(burn.tickLower, 10),
              tickUpper: parseInt(burn.tickUpper, 10),
            })

            usedTxIds[burn.id] = true
            got++
          }
        }

        lastTimestamp = data.data.burns[data.data.burns.length - 1].timestamp
        if (data.data.burns.length < 1000) {
          break
        }
      }
      console.log(`Got ${got} burns.`)

      console.log('Fetch swaps..')
      lastTimestamp = startTimestamp
      got = 0
      usedTxIds = {}
      while (true) {
        query = this.getSwapsQuery(poolAddr, lastTimestamp, endTimestamp)
        const data = await client.query(query, {}).toPromise()
        if (!data?.data?.swaps) {
          console.log('Error fetching from subgraph')
          console.log(data)
          break;
        }

        for (const swap of data.data.swaps) {
          if (!usedTxIds[swap.id]) {
            r.push({
              type: TransactionType.SWAP,
              timestamp: parseInt(swap.timestamp, 10),
              amount0: swap.amount0,
              amount1: swap.amount1,
            })

            usedTxIds[swap.id] = true
            got++
          }
        }

        lastTimestamp = data.data.swaps[data.data.swaps.length - 1].timestamp
        if (data.data.swaps.length < 1000) {
          break
        }
      }
      console.log(`Got ${got} swaps.`)

      r = r.sort((a,b) => {
        if (a.timestamp < b.timestamp) {
          return -1;
        }
        if (a.timestamp > b.timestamp) {
          return 1;
        }

        if (a.type === TransactionType.MINT) {
          return -1
        }

        return 1
      })

      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir);
      }
      fs.writeFileSync(`${cacheDir}/${cacheFileName}`, JSON.stringify(r));
      console.log(`Done. Added to cache file ${cacheDir}/${cacheFileName}.`)
    }

    return r
  }

  public static async getPoolLiquiditySnapshot(poolAddr: string, block: number, numSurroundingTicks: number): Promise<IPoolLiquiditySnapshot> {
    console.log(`Get Uniswap V3 pool liquidity snapshot for ${poolAddr} at block ${block}, numSurroundingTicks: ${numSurroundingTicks}..`)

    let r: IPoolLiquiditySnapshot = {
      pool: poolAddr,
      block,
      numSurroundingTicks,
      currentTick: 0,
      currentSqrtPriceX96: '0',
      ticks: [],
    }

    const cacheDir = 'tmp';
    const cacheFileName = `cache_uniswapV3PoolLiquiditySnapshot-${poolAddr}-${block}-${numSurroundingTicks}.json`;
    const fsContent = fs.existsSync(`${cacheDir}/${cacheFileName}`) ? fs.readFileSync(`${cacheDir}/${cacheFileName}`) : null
    if (fsContent) {
      r = JSON.parse(fsContent.toString())
      console.log(`Got from cache.`)
    } else {
      const rpc = process.env.TETU_MATIC_RPC_URL
      const provider = new ethers.providers.JsonRpcProvider(rpc)
      const pool = UniswapV3Pool__factory.connect(poolAddr, provider)
      const tickSpacing = this.getTickSpacing(await pool.fee())
      const slot0 = await pool.functions.slot0({blockTag: block})
      r.currentSqrtPriceX96 = slot0.sqrtPriceX96.toString()
      r.currentTick = slot0.tick
      const activeTickIdx = Math.floor(slot0.tick / tickSpacing) * tickSpacing
      const processedTicks: ITickProcessed[] = []
      const liquidity = (await pool.functions.liquidity({blockTag: block}))[0]
      const activeTickData = await pool.functions.ticks(activeTickIdx, {blockTag: block})
      const activeTickProcessed = {
        tickIdx: activeTickIdx,
        liquidityGross: activeTickData.liquidityGross.toString(),
        liquidityNet: activeTickData.liquidityNet.toString(),
        liquidityActive: liquidity.toString(),
      }
      processedTicks.push(activeTickProcessed)
      let previousTickProcessed = activeTickProcessed
      for (let i = 0; i < numSurroundingTicks; i++) {
        const tickIdx = previousTickProcessed.tickIdx + tickSpacing
        const tickData = await pool.functions.ticks(tickIdx, {blockTag: block})
        const currentTickProcessed: ITickProcessed = {
          tickIdx,
          liquidityGross: tickData.liquidityGross.toString(),
          liquidityNet: tickData.liquidityNet.toString(),
          liquidityActive: BigNumber.from(previousTickProcessed.liquidityActive).add(tickData.liquidityNet).toString(),
        }
        processedTicks.push(currentTickProcessed)
        previousTickProcessed = currentTickProcessed
        process.stdout.write(`.`)
      }
      previousTickProcessed = activeTickProcessed
      for (let i = 0; i < numSurroundingTicks; i++) {
        const tickIdx = previousTickProcessed.tickIdx - tickSpacing
        const tickData = await pool.functions.ticks(tickIdx, {blockTag: block})
        const currentTickProcessed: ITickProcessed = {
          tickIdx,
          liquidityGross: tickData.liquidityGross.toString(),
          liquidityNet: tickData.liquidityNet.toString(),
          liquidityActive: BigNumber.from(previousTickProcessed.liquidityActive).sub(previousTickProcessed.liquidityNet).toString(),
        }
        processedTicks.push(currentTickProcessed)
        previousTickProcessed = currentTickProcessed
        process.stdout.write(`.`)
      }
      r.ticks = processedTicks.sort((a,b) => a.tickIdx < b.tickIdx ? -1 : 1)

      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir);
      }
      fs.writeFileSync(`${cacheDir}/${cacheFileName}`, JSON.stringify(r));
      console.log('')
      console.log(`Done. Added to cache file ${cacheDir}/${cacheFileName}.`)
    }

    return r
  }

  private static getMintsQuery(pool: string, startTimestamp: number, endTimestamp: number) {
    return `query {
      mints(first: 1000, orderBy: timestamp, where:{pool: "${pool.toLowerCase()}", timestamp_gte: "${startTimestamp}", timestamp_lt: "${endTimestamp}"}) {
        id
        timestamp
        tickLower
        tickUpper
        amount
        amount0
        amount1
      }
    }`
  }

  private static getBurnsQuery(pool: string, startTimestamp: number, endTimestamp: number) {
    return `query {
      burns(first: 1000, orderBy: timestamp, where:{pool: "${pool.toLowerCase()}", timestamp_gte: "${startTimestamp}", timestamp_lt: "${endTimestamp}"}) {
        id
        timestamp
        tickLower
        tickUpper
        amount
        amount0
        amount1
      }
    }`
  }

  private static getSwapsQuery(pool: string, startTimestamp: number, endTimestamp: number) {
    return `query {
      swaps(first: 1000, orderBy: timestamp, where:{pool: "${pool.toLowerCase()}", timestamp_gte: "${startTimestamp}", timestamp_lt: "${endTimestamp}"}) {
        id
        timestamp
        amount0
        amount1
      }
    }`
  }

  public static getTickSpacing(feeTier: number): number {
    switch (feeTier) {
      case 10000:
        return 200
      case 3000:
        return 60
      case 500:
        return 10
      case 100:
        return 1
      default:
        throw Error(`Tick spacing for fee tier ${feeTier} undefined.`)
    }
  }

  public static async getFees(pool: string, lowerTick: number, upperTick: number, owner: string, block: number = 0): Promise<[BigNumber, BigNumber]> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.TETU_MATIC_RPC_URL)
    const overrides = block === 0 ? {} : {blockTag: block,}
    const positionId = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "int24", "int24"], [owner, lowerTick, upperTick]))
    const univ3pool = UniswapV3Pool__factory.connect(pool, provider)
    const slot0 = await univ3pool.slot0(overrides)
    const position = await univ3pool.positions(positionId, overrides)
    const lowerTickData = await univ3pool.ticks(lowerTick, overrides)
    const upperTickData = await univ3pool.ticks(upperTick, overrides)
    const feeGrowthGlobal0X128 = await univ3pool.feeGrowthGlobal0X128(overrides)
    const feeGrowthGlobal1X128 = await univ3pool.feeGrowthGlobal1X128(overrides)

    // compute fee0
    const feeGrowthBelow0 = slot0.tick >= lowerTick ? lowerTickData.feeGrowthOutside0X128 : feeGrowthGlobal0X128.sub(lowerTickData.feeGrowthOutside0X128)
    const feeGrowthAbove0 = slot0.tick < upperTick ? upperTickData.feeGrowthOutside0X128 : feeGrowthGlobal0X128.sub(upperTickData.feeGrowthOutside0X128)
    let feeGrowthInside0 = feeGrowthGlobal0X128.sub(feeGrowthBelow0).sub(feeGrowthAbove0)
    if (feeGrowthInside0.lt(0)) {
      feeGrowthInside0 = BigNumber.from(Misc.MAX_UINT).sub(feeGrowthInside0.mul(-1))
    }
    const fee0 = position.liquidity.mul(feeGrowthInside0.sub(position.feeGrowthInside0LastX128)).div(BigNumber.from('0x100000000000000000000000000000000'))

    // compute fee1
    const feeGrowthBelow1 = slot0.tick >= lowerTick ? lowerTickData.feeGrowthOutside1X128 : feeGrowthGlobal1X128.sub(lowerTickData.feeGrowthOutside1X128)
    const feeGrowthAbove1 = slot0.tick < upperTick ? upperTickData.feeGrowthOutside1X128 : feeGrowthGlobal1X128.sub(upperTickData.feeGrowthOutside1X128)
    let feeGrowthInside1 = feeGrowthGlobal1X128.sub(feeGrowthBelow1).sub(feeGrowthAbove1)
    if (feeGrowthInside1.lt(0)) {
      feeGrowthInside1 = BigNumber.from(Misc.MAX_UINT).sub(feeGrowthInside1.mul(-1))
    }
    const fee1 = position.liquidity.mul(feeGrowthInside1.sub(position.feeGrowthInside1LastX128)).div(BigNumber.from('0x100000000000000000000000000000000'))

    return [fee0, fee1]
  }
}

export interface IPoolTransaction {
  type: TransactionType
  timestamp: number
  amount0: string
  amount1: string
  amount?: string
  tickLower?: number
  tickUpper?: number
}

export enum TransactionType {
  MINT,
  BURN,
  SWAP
}

export interface IPoolLiquiditySnapshot {
  pool: string
  block: number
  currentTick: number
  currentSqrtPriceX96: string
  numSurroundingTicks: number
  ticks: ITickProcessed[]
}

interface ITickProcessed {
  tickIdx: number
  liquidityGross: string
  liquidityNet: string
  liquidityActive: string
}