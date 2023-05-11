import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IERC20Metadata__factory, IUniswapV3Pool__factory,
  TetuVaultV2,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3Lib
} from "../../typechain";
import {IPoolLiquiditySnapshot, TransactionType, UniswapV3Utils} from "../utils/UniswapV3Utils";
import {formatUnits, getAddress, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {Misc} from "../utils/Misc";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {IBacktestResult} from "./types";

export async function strategyBacktest(
  signer: SignerWithAddress,
  vault: TetuVaultV2,
  strategy: UniswapV3ConverterStrategy,
  uniswapV3Calee: UniswapV3Callee,
  uniswapV3Helper: UniswapV3Lib,
  liquiditySnapshot: IPoolLiquiditySnapshot,
  investAmountUnits: string,
  backtestStartBlock: number,
  backtestEndBlock: number,
  uniswapV3RealPoolAddress: string,
  txLimit: number = 0,
  disableBurns: boolean = false,
  disableMints: boolean = false,
): Promise<IBacktestResult> {
  const state = await strategy.getState();
  const startTimestampLocal = Math.floor(Date.now() / 1000);
  const tokenA = IERC20Metadata__factory.connect(state.tokenA, signer);
  const tokenADecimals = await tokenA.decimals();
  const tokenB = IERC20Metadata__factory.connect(state.tokenB, signer);
  const pool = IUniswapV3Pool__factory.connect(state.pool, signer);
  const token0 = IERC20Metadata__factory.connect(await pool.token0(), signer);
  const token1 = IERC20Metadata__factory.connect(await pool.token1(), signer);
  const token0Decimals = await token0.decimals();
  const token1Decimals = await token1.decimals();
  const token0Symbol = await token0.symbol();
  const token1Symbol = await token1.symbol();
  const tickSpacing = UniswapV3Utils.getTickSpacing(await pool.fee());
  const investAmount = parseUnits(investAmountUnits, tokenADecimals)

  console.log(`Starting backtest of ${await vault.name()}`);
  console.log(`Filling pool with initial liquidity from snapshot (${liquiditySnapshot.ticks.length} ticks)..`);
  for (const tick of liquiditySnapshot.ticks) {
    if (BigNumber.from(tick.liquidityActive).gt(0)) {
      await uniswapV3Calee.mint(
        pool.address,
        signer.address,
        tick.tickIdx,
        tick.tickIdx + tickSpacing,
        tick.liquidityActive,
      );
    }
  }

  console.log(`Deposit ${await tokenA.symbol()} to vault...`);
  await tokenA.approve(vault.address, Misc.MAX_UINT);
  await vault.deposit(investAmount, signer.address);
  const totalAssetsinStrategyBefore = await strategy.totalAssets();

  const initialState = await strategy.getState()
  expect(initialState.totalLiquidity).gt(0)

  const liquidityTickLower = liquiditySnapshot.ticks[0].tickIdx;
  const liquidityTickUpper = liquiditySnapshot.ticks[liquiditySnapshot.ticks.length - 1].tickIdx;
  const startPrice = await uniswapV3Helper.getPrice(pool.address, tokenB.address);
  let endPrice = startPrice;
  let minPrice = startPrice;
  let maxPrice = startPrice;
  let i = 0;
  let rebalances = 0;
  const poolTxs = await UniswapV3Utils.getPoolTransactions(
    getAddress(uniswapV3RealPoolAddress),
    backtestStartBlock,
    backtestEndBlock,
  );
  const startTimestamp = poolTxs[0].timestamp;
  const txsTotal = txLimit === 0 || txLimit > poolTxs.length ? poolTxs.length : txLimit;
  let endTimestamp = startTimestamp;
  let previousTimestamp = startTimestamp;
  for (const poolTx of poolTxs) {
    i++;
    endTimestamp = poolTx.timestamp;

    if (!disableMints && poolTx.type === TransactionType.MINT && poolTx.tickUpper !== undefined && poolTx.tickLower !==
      undefined) {

      process.stdout.write(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] MINT`);
      const parts = (poolTx.tickUpper - poolTx.tickLower) / tickSpacing;
      const newTickUpper = poolTx.tickUpper > liquidityTickUpper ? liquidityTickUpper : poolTx.tickUpper;
      const newTickLower = poolTx.tickLower < liquidityTickLower ? liquidityTickLower : poolTx.tickLower;
      for (let t = newTickLower; t < newTickUpper - tickSpacing; t += tickSpacing) {
        await uniswapV3Calee.mint(
          pool.address,
          signer.address,
          t,
          t + tickSpacing,
          BigNumber.from(poolTx.amount).div(parts),
        );
        process.stdout.write(`.`);
      }

      console.log('');
    }

    if (!disableBurns && poolTx.type === TransactionType.BURN && poolTx.tickUpper !== undefined && poolTx.tickLower !==
      undefined) {
      if (poolTx.tickUpper < liquidityTickLower || poolTx.tickLower > liquidityTickUpper) {
        // burn liquidity not in pool range
        continue;
      }

      if (BigNumber.from(poolTx.amount).eq(0)) {
        // zero burn == collect fees
        continue;
      }

      process.stdout.write(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] BURN`);
      if (poolTx.tickLower < liquidityTickLower || poolTx.tickUpper > liquidityTickUpper) {
        const rangeOrigin = BigNumber.from(poolTx.tickUpper - poolTx.tickLower);
        const newTickUpper = poolTx.tickUpper > liquidityTickUpper ? liquidityTickUpper : poolTx.tickUpper;
        const newTickLower = poolTx.tickLower < liquidityTickLower ? liquidityTickLower : poolTx.tickLower;
        const newRange = BigNumber.from(newTickUpper - newTickLower);
        const newAmount = BigNumber.from(poolTx.amount).mul(newRange).div(rangeOrigin);
        const parts = (newTickUpper - newTickLower) / tickSpacing;
        for (let t = newTickLower; t < newTickUpper - tickSpacing; t += tickSpacing) {
          await pool.burn(t, t + tickSpacing, BigNumber.from(newAmount).div(parts));
          process.stdout.write(`.`);
        }
      } else {
        const parts = (poolTx.tickUpper - poolTx.tickLower) / tickSpacing;
        for (let t = poolTx.tickLower; t < poolTx.tickUpper - tickSpacing; t += tickSpacing) {
          await pool.burn(t, t + tickSpacing, BigNumber.from(poolTx.amount).div(parts));
          process.stdout.write(`.`);
        }
      }
      console.log('');
    }

    if (poolTx.type === TransactionType.SWAP) {
      const swap0to1 = parseUnits(poolTx.amount1, token1Decimals).lt(0);
      const tokenIn = swap0to1 ? token0.address : token1.address;
      const amountIn = swap0to1 ? parseUnits(poolTx.amount0, token0Decimals) : parseUnits(
        poolTx.amount1,
        token1Decimals,
      );
      if (amountIn.eq(0)) {
        console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap zero amount. Skipped.`);
        continue;
      }
      const priceBefore = await uniswapV3Helper.getPrice(pool.address, tokenB.address);
      await uniswapV3Calee.swap(pool.address, signer.address, tokenIn, amountIn);
      const priceAfter = await uniswapV3Helper.getPrice(pool.address, tokenB.address);

      const priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8);
      const priceChangeStr = priceChangeVal.eq(0) ? '' : ` (${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(
        priceChangeVal,
        5,
      )}%)`;
      console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap ${swap0to1
        ? token0Symbol
        : token1Symbol} -> ${swap0to1 ? token1Symbol : token0Symbol}. Price: ${formatUnits(
        priceAfter,
        tokenADecimals,
      )}${priceChangeStr}.`);

      if (priceAfter.gt(maxPrice)) {
        maxPrice = priceAfter;
      }

      if (priceAfter.lt(minPrice)) {
        minPrice = priceAfter;
      }

      endPrice = priceAfter;
    }

    if (previousTimestamp !== poolTx.timestamp) {
      if (await strategy.needRebalance()) {
        rebalances++;
        process.stdout.write(`Rebalance ${rebalances}.. `);
        const tx = await strategy.rebalance();
        const txRes = await tx.wait();
        console.log(`done with ${txRes.gasUsed} gas.`);
      }

      if ((await strategy.getState()).isFuseTriggered) {
        console.log('Fuse enabled!');
        break;
      }
    }

    previousTimestamp = poolTx.timestamp;
    if (i >= txsTotal) {
      break;
    }
  }

  console.log('doHardWork...');
  const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
  await strategy.connect(splitterSigner).doHardWork();

  const totalAssetsinStrategyAfter = await strategy.totalAssets();
  const endTimestampLocal = Math.floor(Date.now() / 1000);
  const earned = totalAssetsinStrategyAfter.sub(totalAssetsinStrategyBefore);

  return {
    vaultName: await vault.name(),
    vaultAssetSymbol: await tokenA.symbol(),
    vaultAssetDecimals: tokenADecimals,
    tickRange: (state.upperTick - state.lowerTick) / 2,
    rebalanceTickRange: state.rebalanceTickRange,
    startTimestamp,
    endTimestamp,
    investAmount,
    earned,
    rebalances,
    startPrice,
    endPrice,
    maxPrice,
    minPrice,
    backtestLocalTimeSpent: endTimestampLocal - startTimestampLocal,
    tokenBSymbol: await tokenB.symbol(),
    disableBurns,
    disableMints,
  };
}

export function getApr(earned: BigNumber, investAmount: BigNumber, startTimestamp: number, endTimestamp: number) {
  const earnedPerSec1e10 = earned.mul(parseUnits('1', 10)).div(endTimestamp - startTimestamp);
  const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10));
  const apr = earnedPerDay.mul(365).mul(100000000).div(investAmount).div(1000);
  return +formatUnits(apr, 3)
}

export function showBacktestResult(r: IBacktestResult) {
  console.log(`Strategy ${r.vaultName}. Tick range: ${r.tickRange} (+-${r.tickRange /
  100}% price). Rebalance tick range: ${r.rebalanceTickRange} (+-${r.rebalanceTickRange / 100}% price).`);
  const earnedPerSec1e10 = r.earned.mul(parseUnits('1', 10)).div(r.endTimestamp - r.startTimestamp);
  const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10));
  const apr = earnedPerDay.mul(365).mul(100000000).div(r.investAmount).div(1000);
  console.log(`APR: ${formatUnits(apr, 3)}%. Invest amount: ${formatUnits(
    r.investAmount,
    r.vaultAssetDecimals,
  )} ${r.vaultAssetSymbol}. Earned: ${formatUnits(r.earned, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Rebalances: ${r.rebalances}.`);
  console.log(`Period: ${periodHuman(r.endTimestamp - r.startTimestamp)}. Start: ${new Date(r.startTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(r.startTimestamp *
    1000).toLocaleTimeString('en-US')}. Finish: ${new Date(r.endTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(r.endTimestamp * 1000).toLocaleTimeString('en-US')}.`);
  console.log(`Start price of ${r.tokenBSymbol}: ${formatUnits(r.startPrice, r.vaultAssetDecimals)}. End price: ${formatUnits(
    r.endPrice,
    r.vaultAssetDecimals,
  )}. Min price: ${formatUnits(r.minPrice, r.vaultAssetDecimals)}. Max price: ${formatUnits(r.maxPrice, r.vaultAssetDecimals)}.`);
  console.log(`Mints: ${!r.disableMints ? 'enabled' : 'disabled'}. Burns: ${!r.disableBurns
    ? 'enabled'
    : 'disabled'}.`);
  console.log(`Time spent for backtest: ${periodHuman(r.backtestLocalTimeSpent)}.`);
  console.log('');
}

export function periodHuman(periodSecs: number) {
  const periodMins = Math.floor(periodSecs / 60);
  const periodHours = Math.floor(periodMins / 60);
  const periodDays = Math.floor(periodHours / 24);
  let periodStr = '';
  if (periodDays) {
    periodStr += `${periodDays}d `;
  }
  if (periodHours) {
    periodStr += `${periodHours - periodDays * 24}h:`;
  }
  periodStr += `${periodMins - periodHours * 60}m`;
  if (!periodDays && !periodHours) {
    if (periodMins) {
      periodStr += ':';
    }
    periodStr += `${periodSecs - periodMins * 60}s`;
  }
  return periodStr;
}
