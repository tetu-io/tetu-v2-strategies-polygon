/* tslint:disable:no-trailing-whitespace */
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {getAddress, parseUnits} from 'ethers/lib/utils';
import { IPoolLiquiditySnapshot, UniswapV3Utils } from '../../../../scripts/utils/UniswapV3Utils';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { deployBacktestSystem } from '../../../../scripts/uniswapV3Backtester/deployBacktestSystem';
import {
  IBacktestResult,
  IContracts,
  IRebalanceDebtSwapPoolParams,
} from '../../../../scripts/uniswapV3Backtester/types';
import { showBacktestResult, strategyBacktest } from '../../../../scripts/uniswapV3Backtester/strategyBacktest';
import { EnvSetup } from '../../../../scripts/utils/EnvSetup';
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";

// How to
// anvil --prune-history
// hardhat test test/strategies/polygon/uniswapv3/UniswapV3ConverterStrategyBacktester.ts --network foundry

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");

describe('UmiswapV3 converter strategy backtester for BASE network', function() {
  // https://github.com/Uniswap/interface/blob/main/src/graphql/thegraph/apollo.ts
  const SUBGRAPH = 'https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest'

  // ==== backtest config ====
  const backtestStartBlock = 5450000 // ok 5200000 // Oct-13-2023 09:29:07 AM +UTC
  const backtestEndBlock = 5470400 // Oct-19-2023
  const investAmountUnits: string = '100'
  const txLimit = 0; // 0 - unlimited
  const disableBurns = false;
  const disableMints = false;
  const rebalanceDebt = true;
  const allowedLockedPercent = 25;
  const forceRebalanceDebtLockedPercent = 70;
  const rebalanceDebtDelay = 7200;
  const fuseThresholds = ['0.999', '0.9991', '1.001', '1.0009',]

  const params = {
    vaultAsset: BaseAddresses.USDbC_TOKEN,
    pool: BaseAddresses.UNISWAPV3_DAI_USDbC_100,
    token0: BaseAddresses.DAI_TOKEN,
    token1: BaseAddresses.USDbC_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 100, // == +-1% price
    tickRange: 0, // 1 tick
    rebalanceTickRange: 0, // 1 tick
  }
  const rebalanceDebtSwapPoolParams: IRebalanceDebtSwapPoolParams = {
    tickLower: -276360, // ~1:1 price
    tickUpper: -276300,
    amount0Desired: parseUnits('1000', 18),
    amount1Desired: parseUnits('1000', 18),
  }
  /*const params = {
    vaultAsset: BaseAddresses.USDbC_TOKEN,
    pool: BaseAddresses.UNISWAPV3_USDC_USDbC_100,
    token0: BaseAddresses.USDC_TOKEN,
    token1: BaseAddresses.USDbC_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 100, // == +-1% price
    tickRange: 0, // 1 tick
    rebalanceTickRange: 0, // 1 tick
  }
  const rebalanceDebtSwapPoolParams: IRebalanceDebtSwapPoolParams = {
    tickLower: -60, // ~1:1 price
    tickUpper: 60,
    amount0Desired: parseUnits('1000', 6),
    amount1Desired: parseUnits('1000', 6),
  }*/
  // =========================

  let contracts: IContracts
  let liquiditySnapshot: IPoolLiquiditySnapshot

  // time snapshots
  let snapshot: string;
  let snapshotBefore: string;

  // signers
  let signer: SignerWithAddress;

  let backtestResult: IBacktestResult;

  if (EnvSetup.getEnv().disableBacktesting) {
    return;
  }

  const chainId = hre.network.config.chainId
  if (chainId !== 31337) {
    console.log('Backtester can only work in the local hardhat or foundry network (31337 chainId)');
    return;
  }

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [signer] = await ethers.getSigners();

    liquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(
      EnvSetup.getEnv().baseRpcUrl,
      getAddress(params.pool),
      backtestStartBlock,
      params.liquiditySnapshotSurroundingTickSpacings,
    );

    contracts = await deployBacktestSystem(
      signer,
      liquiditySnapshot.currentSqrtPriceX96,
      getAddress(params.vaultAsset),
      getAddress(params.token0),
      getAddress(params.token1),
      params.poolFee,
      params.tickRange,
      params.rebalanceTickRange,
      rebalanceDebtSwapPoolParams,
        [
          {
            address: BaseAddresses.USDbC_TOKEN,
            name: 'USDbC',
            decimals: 6
          },
          {
            address: BaseAddresses.DAI_TOKEN,
            name: 'DAI',
            decimals: 18
          },
          {
            address: BaseAddresses.USDC_TOKEN,
            name: 'USDC',
            decimals: 6
          },
        ]
    )

    await contracts.strategy.setFuseThresholds([
      parseUnits(fuseThresholds[0]),
      parseUnits(fuseThresholds[1]),
      parseUnits(fuseThresholds[2]),
      parseUnits(fuseThresholds[3]),
    ])
    // console.log('Fuse thresholds', fuseThresholds.map(a => parseUnits(a).toString()))

    // await contracts.uniswapV3Calee.toggleNoRevert()
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
    if (backtestResult) {
      console.log('');
      console.log('');
      console.log(`=== Uniswap V3 NSR strategy backtester ===`);
      console.log('');
      showBacktestResult(backtestResult, fuseThresholds, backtestStartBlock, backtestEndBlock, rebalanceDebtSwapPoolParams);
    }
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('Backtesting', async function() {
    backtestResult = await strategyBacktest(
      EnvSetup.getEnv().baseRpcUrl,
      SUBGRAPH,
      signer,
      contracts.vault,
      contracts.strategy,
      contracts.uniswapV3Calee,
      contracts.uniswapV3Helper,
      liquiditySnapshot,
      investAmountUnits,
      backtestStartBlock,
      backtestEndBlock,
      params.pool,
      txLimit,
      disableBurns,
      disableMints,
      rebalanceDebt,
      contracts.reader,
      allowedLockedPercent,
      forceRebalanceDebtLockedPercent,
      rebalanceDebtDelay,
      contracts.rebalanceDebtSwapPool,
    )
  })
});
