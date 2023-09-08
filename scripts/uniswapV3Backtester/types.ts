import {
  CErc20Immutable,
  CompPriceOracleImitator, Comptroller, ControllerV2, JumpRateModelV2,
  MockToken, MultiGauge, PairBasedStrategyReader, PriceOracleImitator, TetuConverter, TetuLiquidator,
  TetuVaultV2, Uni3Swapper,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3Factory,
  UniswapV3Lib, UniswapV3Pool, VaultFactory
} from "../../typechain";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";

export interface IConfig {
  liquiditySnapshotSurroundingTickSpacings: number
  maxTickRange: number
  maxRebalanceTickRange: number
  gens: number
  minIndividualsPerGen: number
  bestIndividualsPerGen: number
}

export enum MutateDirection {
  UNKNOWN,
  DECREASE,
  INCREASE
}

export interface IStrategyParams {
  tickRange: number
  rebalanceTickRange: number
}

export interface IContracts {
  tokens: {[realAddress: string]: MockToken}

  // strategy
  vault: TetuVaultV2
  strategy: UniswapV3ConverterStrategy

  // uniswap v3
  uniswapV3Factory: UniswapV3Factory
  uniswapV3Calee: UniswapV3Callee
  uniswapV3Helper: UniswapV3Lib
  pool: UniswapV3Pool

  // compound
  compPriceOracleImitator: CompPriceOracleImitator
  comptroller: Comptroller
  compInterestRateModel: JumpRateModelV2
  cTokens: {[realUnderlyingAddress: string]: CErc20Immutable}

  // liquidator
  liquidator: TetuLiquidator
  uni3swapper: Uni3Swapper

  // converter
  tetuConverter: TetuConverter
  priceOracleImitator: PriceOracleImitator

  // tetu v2
  controller: ControllerV2
  gauge: MultiGauge
  vaultFactory: VaultFactory

  reader: PairBasedStrategyReader
  rebalanceDebtSwapPool: UniswapV3Pool
}

export interface IVaultUniswapV3StrategyInfo {
  vault: TetuVaultV2,
  strategy: UniswapV3ConverterStrategy
}

export interface IBacktestResult {
  vaultName: string;
  vaultAssetSymbol: string;
  vaultAssetDecimals: number;
  tickRange: number;
  rebalanceTickRange: number;
  startTimestamp: number;
  endTimestamp: number;
  investAmount: BigNumber;
  earned: BigNumber;
  rebalances: number;
  rebalancesDebt: number;
  rebalancesDebtDelayed: number;
  rebalancesDebtClosing: number;
  startPrice: BigNumber;
  endPrice: BigNumber;
  maxPrice: BigNumber;
  minPrice: BigNumber;
  backtestLocalTimeSpent: number;
  tokenBSymbol: string;
  tokenBDecimals: number;
  disableBurns: boolean;
  disableMints: boolean;
  hardworkEarned: BigNumber;
  hardworkLost: BigNumber;
  vaultTotalAssetsBefore: BigNumber;
  vaultTotalAssetsAfter: BigNumber;
  strategyTotalAssetsAfter: BigNumber;
  insuranceAssetsBefore: BigNumber;
  insuranceAssetsAfter: BigNumber;
  totalLossCovered: BigNumber;
  totalPriceChangeLoss: BigNumber;
  totalLossCoveredFromRewards: BigNumber;
  totalProfitCovered: BigNumber;
  rebalanceLoss: BigNumber;
  nsrAndRebalanceDebtLoss: BigNumber;
  allowedLockedPercent: number;
  forceRebalanceDebtLockedPercent: number;
  rebalanceDebtDelay: number;
  timeOnFuse: number;
  poolTxs: number;
  strategyTokenBBalance: BigNumber;
}

export interface IRebalanceDebtSwapPoolParams {
  tickLower: number
  tickUpper: number
  amount0Desired: BigNumber
  amount1Desired: BigNumber
}
