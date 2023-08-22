/* tslint:disable:no-trailing-whitespace */
import hre, { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { getAddress } from 'ethers/lib/utils';
import { IPoolLiquiditySnapshot, UniswapV3Utils } from '../../../../scripts/utils/UniswapV3Utils';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { config as dotEnvConfig } from 'dotenv';
import {
  deployBacktestSystem,
} from "../../../../scripts/uniswapV3Backtester/deployBacktestSystem";
import {IBacktestResult, IContracts} from "../../../../scripts/uniswapV3Backtester/types";
import {showBacktestResult, strategyBacktest} from "../../../../scripts/uniswapV3Backtester/strategyBacktest";


// How to
// anvil --prune-history
// hardhat test test/strategies/polygon/uniswapv3/UniswapV3ConverterStrategyBacktester.ts --network foundry

// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
  }).argv;

describe('UmiswapV3 converter strategy backtester', function() {
  // ==== backtest config ====
  // before depeg start ts - 1690882487
  const backtestStartBlock = 45764000; // Aug-01-2023 02:55:08 AM +UTC // 45700000; // 7/30/2023 3:31:06 PM
  // const backtestEndBlock = 46000000; // Aug-07-2023 01:26:23 AM +UTC - fails on ts 1690914072
  const backtestEndBlock = 45785000; // Aug-01-2023 03:32:23 PM +UTC
  const investAmountUnits: string = '10000' // 1k USDC, 1k WMATIC etc
  const txLimit = 0; // 0 - unlimited
  const disableBurns = false; // backtest is 5x slower with enabled burns for volatile pools
  const disableMints = false;
  const rebalanceDebt = true;
  const allowedLockedPercent = 25;
  const forceRebalanceDebtLockedPercent = 70;
  const rebalanceDebtDelay = 3600;

  /*const params = {
    vaultAsset: MaticAddresses.WMATIC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_WMATIC_MaticX_500,
    token0: MaticAddresses.WMATIC_TOKEN,
    token1: MaticAddresses.MaticX_TOKEN,
    poolFee: 500,
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 0,
    rebalanceTickRange: 0,
  }*/
  const params = {
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_USDC_USDT_100, // USDC_USDT_0.01%
    token0: MaticAddresses.USDC_TOKEN,
    token1: MaticAddresses.USDT_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
    tickRange: 0, // 1 tick
    rebalanceTickRange: 0, // 1 tick
  }
  /*const params = {
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_USDC_DAI_100, // USDC_DAI_0.01%
    token0: MaticAddresses.USDC_TOKEN,
    token1: MaticAddresses.DAI_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 50, // 50*1*0.01% == +-0.5% price
    tickRange: 0, // 1 tick
    rebalanceTickRange: 0, // 1 tick
  }*/
    // USDC vault
  /*{
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_USDC_WETH_500,
    token0: MaticAddresses.USDC_TOKEN,
    token1: MaticAddresses.WETH_TOKEN,
    poolFee: 500, // 0.05%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 1200, // 1200*0.01% == +- 12% price
    rebalanceTickRange: 40, // 40*0.01% == 0.4% price change
  },*/
  /*{
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_WMATIC_USDC_500, // WMATIC_USDC_0.05%
    token0: MaticAddresses.WMATIC_TOKEN,
    token1: MaticAddresses.USDC_TOKEN,
    poolFee: 500, // 0.05%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 1200, // 1200*0.01% == +- 12% price
    rebalanceTickRange: 60, // 60*0.01% == 0.6% price change
  },*/
  /*{
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_WMATIC_USDC_3000, // WMATIC_USDC_0.3%
    token0: MaticAddresses.WMATIC_TOKEN,
    token1: MaticAddresses.USDC_TOKEN,
    poolFee: 3000, // 0.3%
    liquiditySnapshotSurroundingTickSpacings: 50, // 50*60*0.01% == +-30% price
    tickRange: 1200,
    rebalanceTickRange: 60,
  },*/
  /*{
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_USDC_DAI_100, // USDC_DAI_0.01%
    token0: MaticAddresses.USDC_TOKEN,
    token1: MaticAddresses.DAI_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
    tickRange: 0, // 1 tick
    rebalanceTickRange: 0, // 1 tick
  },*/
  /*{
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_USDC_USDT_100, // USDC_USDT_0.01%
    token0: MaticAddresses.USDC_TOKEN,
    token1: MaticAddresses.USDT_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
    tickRange: 0, // 1 tick
    rebalanceTickRange: 0, // 1 tick
  },*/
  /*{
    vaultAsset: MaticAddresses.USDC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_USDC_miMATIC_100, // USDC_miMATIC_0.01%
    token0: MaticAddresses.USDC_TOKEN,
    token1: MaticAddresses.miMATIC_TOKEN,
    poolFee: 100, // 0.01%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
    tickRange: 1, // 2 ticks
    rebalanceTickRange: 1, // 1 tick
  },*/
  // WMATIC vault
  /*{
    vaultAsset: MaticAddresses.WMATIC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_WMATIC_WETH_500, // WMATIC_WETH_0.05%
    token0: MaticAddresses.WMATIC_TOKEN,
    token1: MaticAddresses.WETH_TOKEN,
    poolFee: 500, // 0.05%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 1200, // +- 12% price
    rebalanceTickRange: 320, // 0.6% price change
  },*/
  /*{
    vaultAsset: MaticAddresses.WMATIC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_WMATIC_MaticX_500,
    token0: MaticAddresses.WMATIC_TOKEN,
    token1: MaticAddresses.MaticX_TOKEN,
    poolFee: 500,
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 0,
    rebalanceTickRange: 0,
  },*/
  // WBTC vault
  /*{
    vaultAsset: MaticAddresses.WBTC_TOKEN,
    pool: MaticAddresses.UNISWAPV3_WBTC_WETH_500,
    token0: MaticAddresses.WBTC_TOKEN,
    token1: MaticAddresses.WETH_TOKEN,
    poolFee: 500, // 0.05%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 1200, // +- 12% price
    rebalanceTickRange: 120, // 0.6% price change
  },*/
  // WETH vault
  /*{
    vaultAsset: MaticAddresses.WETH_TOKEN,
    pool: MaticAddresses.UNISWAPV3_wstETH_WETH_500,
    token0: MaticAddresses.wstETH_TOKEN,
    token1: MaticAddresses.WETH_TOKEN,
    poolFee: 500, // 0.05%
    liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
    tickRange: 0, // 1 tick spacing
    rebalanceTickRange: 0, // 1 tick spacing
  },*/
  // =========================

  let contracts: IContracts
  let liquiditySnapshot: IPoolLiquiditySnapshot

  // time snapshots
  let snapshot: string;
  let snapshotBefore: string;

  // signers
  let signer: SignerWithAddress;
  let user: SignerWithAddress;
  
  let backtestResult: IBacktestResult;

  if (argv.disableStrategyTests) {
    return;
  }

  const chainId = hre.network.config.chainId
  if (chainId !== 31337) {
    console.log('Backtester can only work in the local hardhat or foundry network (31337 chainId)');
    return;
  }

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [signer, user] = await ethers.getSigners();

    liquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(
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
      params.rebalanceTickRange
    )

    await contracts.uniswapV3Calee.toggleNoRevert()
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
    if (backtestResult) {
      console.log('');
      console.log('');
      console.log(`=== Uniswap V3 delta-neutral strategy backtester ===`);
      console.log('');
      showBacktestResult(backtestResult);
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
    )
  })
});
