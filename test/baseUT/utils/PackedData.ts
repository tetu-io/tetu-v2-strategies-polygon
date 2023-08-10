// Indices for IRebalancingV2Strategy.getDefaultState

import {BigNumber} from "ethers";
import {
  AlgebraConverterStrategy, IPairBasedDefaultStateProvider,
  KyberConverterStrategy,
  UniswapV3ConverterStrategy
} from "../../../typechain";
import {formatUnits} from "ethers/lib/utils";

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
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_0 = 4;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_1 = 5;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_2 = 6;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_3 = 7;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_0 = 8;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_1 = 9;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_2 = 10;
const IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_3 = 11;
const IDX_NUMS_DEFAULT_STATE_LAST_REBALANCE_NO_SWAP = 12;

const IDX_BOOL_VALUES_DEFAULT_STATE_IS_STABLE_POOL = 0;
const IDX_BOOL_VALUES_DEFAULT_STATE_DEPOSITOR_SWAP_TOKENS = 1;
//endregion IDefaultState indices

//region IUniv3SpecificState indices
const IDX_UIV3_SS_REBALANCE_EARNED0 = 0;
const IDX_UIV3_SS_REBALANCE_EARNED1 = 1;
//endregion IUniv3SpecificState indices

//region IAlgebraSpecificState indices
const IDX_ALGEBRA_PROFIT_HOLDER_TOKEN_A = 0;
const IDX_ALGEBRA_PROFIT_HOLDER_TOKEN_B = 1;
const IDX_ALGEBRA_PROFIT_HOLDER_REWARD_TOKEN = 2;
const IDX_ALGEBRA_PROFIT_HOLDER_BONUS_REWARD_TOKEN = 3;
//endregion IAlgebraSpecificState indices

//region IKyberSpecificState indices
const IDX_KYBER_PROFIT_HOLDER_TOKEN_A = 0;
const IDX_KYBER_PROFIT_HOLDER_TOKEN_B = 1;
const IDX_KYBER_PROFIT_HOLDER_KNC = 2;

const IDX_KYBER_FLAG_STAKED = 0;
const IDX_KYBER_FLAG_NEED_STAKE = 1;
const IDX_KYBER_FLAG_NEED_UNSTAKE = 2;
//endregion IKyberSpecificState indices

/**
 * Unpacked data from
 *  IRebalancingV2Strategy.getDefaultState
 */
export interface IDefaultState {
  tokenA: string;
  tokenB: string;
  pool: string;
  profitHolder: string;

  tickSpacing: number;
  lowerTick: number;
  upperTick: number;
  rebalanceTickRange: number;

  totalLiquidity: BigNumber;
  fuseStatusTokenA: number;
  fuseStatusTokenB: number;
  withdrawDone: number;

  fuseThresholdsA: number[];
  fuseThresholdsB: number[];

  isStablePool: boolean;
  depositorSwapTokens: boolean;

  lastRebalanceNoSwap: number;
}

export interface IUniv3SpecificState {
  rebalanceEarned0: BigNumber;
  rebalanceEarned1: BigNumber;
}

export interface IKyberSpecificState {
  profitHolderBalances: {
    balanceTokenA: BigNumber;
    balanceTokenB: BigNumber;
    balanceKNC: BigNumber;
  }
  flags: {
    staked: boolean;
    needStake: boolean;
    needUnstake: boolean;
  }
}

export interface IAlgebraSpecificState {
  profitHolderBalances: {
    balanceTokenA: BigNumber;
    balanceTokenB: BigNumber;
    balanceRewardToken: BigNumber;
    balanceBonusRewardToken: BigNumber;
  }
}

export class PackedData {
  static async getDefaultState(strategy: IPairBasedDefaultStateProvider): Promise<IDefaultState> {
    const ret = await strategy.getDefaultState();
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
      fuseThresholdsA: [
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_0], 18),
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_1], 18),
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_2], 18),
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_A_3], 18),
      ],
      fuseThresholdsB: [
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_0], 18),
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_1], 18),
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_2], 18),
        +formatUnits(ret.nums[IDX_NUMS_DEFAULT_STATE_THRESHOLD_B_3], 18),
      ],
      lastRebalanceNoSwap: ret.nums[IDX_NUMS_DEFAULT_STATE_LAST_REBALANCE_NO_SWAP].toNumber(),

      isStablePool: ret.boolValues[IDX_BOOL_VALUES_DEFAULT_STATE_IS_STABLE_POOL],
      depositorSwapTokens: ret.boolValues[IDX_BOOL_VALUES_DEFAULT_STATE_DEPOSITOR_SWAP_TOKENS],
    }
  }

  static async getSpecificStateUniv3(strategy: UniswapV3ConverterStrategy): Promise<IUniv3SpecificState> {
    const ret = await strategy.getSpecificState();
    return {
      rebalanceEarned0: ret[IDX_UIV3_SS_REBALANCE_EARNED0],
      rebalanceEarned1: ret[IDX_UIV3_SS_REBALANCE_EARNED1],
    }
  }

  static async getSpecificStateKyber(strategy: KyberConverterStrategy): Promise<IKyberSpecificState> {
    const ret = await strategy.getSpecificState();
    return {
      profitHolderBalances: {
        balanceTokenA: ret.nums[IDX_KYBER_PROFIT_HOLDER_TOKEN_A],
        balanceTokenB: ret.nums[IDX_KYBER_PROFIT_HOLDER_TOKEN_B],
        balanceKNC: ret.nums[IDX_KYBER_PROFIT_HOLDER_KNC],
      },
      flags: {
        staked: ret.flags[IDX_KYBER_FLAG_STAKED],
        needStake: ret.flags[IDX_KYBER_FLAG_NEED_STAKE],
        needUnstake: ret.flags[IDX_KYBER_FLAG_NEED_UNSTAKE]
      }
    }
  }

  static async getSpecificStateAlgebra(strategy: AlgebraConverterStrategy): Promise<IAlgebraSpecificState> {
    const ret = await strategy.getSpecificState();
    return {
      profitHolderBalances: {
        balanceTokenA: ret[IDX_ALGEBRA_PROFIT_HOLDER_TOKEN_A],
        balanceTokenB: ret[IDX_ALGEBRA_PROFIT_HOLDER_TOKEN_B],
        balanceRewardToken: ret[IDX_ALGEBRA_PROFIT_HOLDER_REWARD_TOKEN],
        balanceBonusRewardToken: ret[IDX_ALGEBRA_PROFIT_HOLDER_BONUS_REWARD_TOKEN],
      }
    }
  }
}
