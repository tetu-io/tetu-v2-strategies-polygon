// Indices for IRebalancingV2Strategy.getDefaultState

import {BigNumber} from "ethers";
import {
  AlgebraConverterStrategy,
  IRebalancingStrategy,
  KyberConverterStrategy,
  UniswapV3ConverterStrategy
} from "../../../typechain";

//region IDefaultState indices
const IDX_ADDR_DEFAULT_STATE_TOKEN_A = 0;
const IDX_ADDR_DEFAULT_STATE_TOKEN_B = 1;
const IDX_ADDR_DEFAULT_STATE_POOL = 2;
const IDX_ADDR_DEFAULT_STATE_PROFIT_HOLDER = 3;

const IDX_TICK_DEFAULT_STATE_TICK_SPACING = 0;
const IDX_TICK_DEFAULT_STATE_LOWER_TICK = 1;
const IDX_TICK_DEFAULT_STATE_UPPER_TICK = 2;
const IDX_TICK_DEFAULT_STATE_REBALANCE_TICK_RANGE = 3;

const IDX_NUMS_DEFAULT_STATE_TOTAL_LIQUIDITY = 0;
const IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_A = 1;
const IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_B = 2;
const IDX_NUMS_DEFAULT_STATE_WITHDRAW_DONE = 3;
//endregion IDefaultState indices

//region IUniswapV3ConverterStrategySpecificState indices
const IDX_UIV3_SS_REBALANCE_EARNED0 = 0;
const IDX_UIV3_SS_REBALANCE_EARNED1 = 1;
const IDX_UIV3_SS_REBALANCE_LOST = 2;

//endregion IUniswapV3ConverterStrategySpecificState indices

/**
 * Unpacked data from
 *  IRebalancingV2Strategy.getDefaultState
 */
interface IDefaultState {
  tokenA, tokenB, pool, profitHolder: string;
  tickSpacing, lowerTick, upperTick, rebalanceTickRange: number;

  totalLiquidity: BigNumber;
  fuseStatusTokenA, fuseStatusTokenB, withdrawDone: number;
}

interface IUniswapV3ConverterStrategySpecificState {
  rebalanceEarned0: BigNumber;
  rebalanceEarned1: BigNumber;
  rebalanceLost: BigNumber;
}

interface IKyberStrategySpecificState {
  profitHolderBalances: BigNumber[];  // todo refactoring array => set of vars
  flags: boolean[]; // todo refactoring array => set of vars
}

interface IAlgebraStrategySpecificState {
  profitHolderBalances: BigNumber[];  // todo refactoring array => set of vars
}

export class PackedData {
  static async getDefaultState(strategy: IRebalancingStrategy): Promise<IDefaultState> {
    const ret = strategy.getDefaultState();
    return {
      tokenA: ret.addr[IDX_ADDR_DEFAULT_STATE_TOKEN_A],
      tokenB: ret.addr[IDX_ADDR_DEFAULT_STATE_TOKEN_B],
      pool: ret.addr[IDX_ADDR_DEFAULT_STATE_POOL],
      profitHolder: ret.addr[IDX_ADDR_DEFAULT_STATE_PROFIT_HOLDER],

      tickSpacing: ret.tickData[IDX_TICK_DEFAULT_STATE_TICK_SPACING],
      lowerTick: ret.tickData[IDX_TICK_DEFAULT_STATE_LOWER_TICK],
      upperTick: ret.tickData[IDX_TICK_DEFAULT_STATE_UPPER_TICK],
      rebalanceTickRange: ret.tickData[IDX_TICK_DEFAULT_STATE_REBALANCE_TICK_RANGE],

      totalLiquidity: ret.nums[IDX_NUMS_DEFAULT_STATE_TOTAL_LIQUIDITY],

      fuseStatusTokenA: ret.nums[IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_A].toNumber(),
      fuseStatusTokenB: ret.nums[IDX_NUMS_DEFAULT_STATE_FUSE_STATUS_B].toNumber(),
      withdrawDone: ret.nums[IDX_NUMS_DEFAULT_STATE_WITHDRAW_DONE].toNumber(),
    }
  }

  static async getSpecificStateUniv3(strategy: UniswapV3ConverterStrategy): Promise<IUniswapV3ConverterStrategySpecificState> {
    const ret = await strategy.getSpecificState();
    return {
      rebalanceEarned0: ret[IDX_UIV3_SS_REBALANCE_EARNED0],
      rebalanceEarned1: ret[IDX_UIV3_SS_REBALANCE_EARNED1],
      rebalanceLost: ret[IDX_UIV3_SS_REBALANCE_LOST],
    }
  }

  static async getSpecificStateKyber(strategy: KyberConverterStrategy): Promise<IKyberStrategySpecificState> {
    const ret = await strategy.getSpecificState();
    return {
      profitHolderBalances: ret.profitHolderBalances,
      flags: ret.flags
    }
  }

  static async getSpecificStateAlgebra(strategy: AlgebraConverterStrategy): Promise<IAlgebraStrategySpecificState> {
    const ret = await strategy.getSpecificState();
    return {
      profitHolderBalances: ret,
    }
  }
}
