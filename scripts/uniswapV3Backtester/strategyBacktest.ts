/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IERC20Metadata__factory, IUniswapV3Pool__factory, PairBasedStrategyReader,
  TetuVaultV2,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3Lib
} from "../../typechain";
import {IPoolLiquiditySnapshot, TransactionType, UniswapV3Utils} from "../utils/UniswapV3Utils";
import {defaultAbiCoder, formatUnits, getAddress, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {Misc} from "../utils/Misc";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {IBacktestResult} from "./types";
import {UniswapV3StrategyUtils} from "../../test/baseUT/strategies/UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../test/baseUT/utils/UniversalTestUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";

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
  rebalanceDebt = false,
  reader: PairBasedStrategyReader|undefined,
  allowedLockedPercent: number = 25,
  forceRebalanceDebtLockedPercent: number = 70,
  rebalanceDebtDelay: number = 3600
): Promise<IBacktestResult> {
  const state = await strategy.getDefaultState();
  const startTimestampLocal = Math.floor(Date.now() / 1000);
  const tokenA = IERC20Metadata__factory.connect(state[0][0], signer);
  const tokenADecimals = await tokenA.decimals();
  const tokenB = IERC20Metadata__factory.connect(state[0][1], signer);
  const pool = IUniswapV3Pool__factory.connect(state[0][2], signer);
  const token0 = IERC20Metadata__factory.connect(await pool.token0(), signer);
  const token1 = IERC20Metadata__factory.connect(await pool.token1(), signer);
  const token0Decimals = await token0.decimals();
  const token1Decimals = await token1.decimals();
  const token0Symbol = await token0.symbol();
  const token1Symbol = await token1.symbol();
  const tickSpacing = UniswapV3Utils.getTickSpacing(await pool.fee());
  const investAmount = parseUnits(investAmountUnits, tokenADecimals)
  let fee0 = BigNumber.from(0);
  let fee1 = BigNumber.from(0);
  let totalLossCoveredFromInsurance = BigNumber.from(0)
  let totalLossCoveredFromRewards = BigNumber.from(0)
  let rebalanceLoss = BigNumber.from(0)
  let fees
  let tx
  let txReceipt
  let lastNSRTimestamp = 0
  let rebalancesDebtDelayed = 0
  let rebalancesDebtClosing = 0
  let totalProfitCovered = BigNumber.from(0)
  let nsrAndRebalanceDebtLoss = BigNumber.from(0)
  let totalPriceChangeLoss = BigNumber.from(0)

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
  const vaultTotalAssetsBefore = await vault.totalAssets()
  const insuranceAssetsBefore = await tokenA.balanceOf(await vault.insurance())

  const initialState = await strategy.getDefaultState()
  expect(initialState[2][0]).gt(0)

  const liquidityTickLower = liquiditySnapshot.ticks[0].tickIdx;
  const liquidityTickUpper = liquiditySnapshot.ticks[liquiditySnapshot.ticks.length - 1].tickIdx;
  const startPrice = await uniswapV3Helper.getPrice(pool.address, tokenB.address);
  let endPrice = startPrice;
  let minPrice = startPrice;
  let maxPrice = startPrice;
  let i = 0;
  let rebalances = 0;
  let rebalancesDebt = 0;
  const poolTxs = await UniswapV3Utils.getPoolTransactions(
    getAddress(uniswapV3RealPoolAddress),
    backtestStartBlock,
    backtestEndBlock,
  );
  const startTimestamp = poolTxs[0].timestamp;
  const txsTotal = txLimit === 0 || txLimit > poolTxs.length ? poolTxs.length : txLimit;
  let endTimestamp = startTimestamp;
  let previousTimestamp = startTimestamp;
  let timeOnFuse = 0
  let lastFuseTimestamp = 0

  for (const poolTx of poolTxs) {
    i++;
    endTimestamp = poolTx.timestamp;

    if (!disableMints && poolTx.type === TransactionType.MINT && poolTx.tickUpper !== undefined && poolTx.tickLower !==
      undefined) {

      process.stdout.write(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] MINT`);
      const parts = (poolTx.tickUpper - poolTx.tickLower) / tickSpacing;
      if (BigNumber.from(poolTx.amount).div(parts).gt(0)) {
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
      const tokenInDecimals = swap0to1 ? token0Decimals : token1Decimals
      const tokenInSymbol = swap0to1 ? token0Symbol : token1Symbol
      const amountIn = swap0to1 ? parseUnits(poolTx.amount0, token0Decimals) : parseUnits(
        poolTx.amount1,
        token1Decimals,
      );
      if (amountIn.eq(0)) {
        console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap zero amount. Skipped.`);
        continue;
      }
      const priceBefore = await uniswapV3Helper.getPrice(pool.address, tokenB.address);
      await uniswapV3Calee.swap(pool.address, signer.address, tokenIn, amountIn, {gasLimit: 19_000_000});
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
      )}${priceChangeStr}. Amount: ${formatUnits(amountIn, tokenInDecimals)} ${tokenInSymbol}.`);

      if (priceAfter.gt(maxPrice)) {
        maxPrice = priceAfter;
      }

      if (priceAfter.lt(minPrice)) {
        minPrice = priceAfter;
      }

      endPrice = priceAfter;
    }

    if (previousTimestamp !== poolTx.timestamp) {
      let defaultState = await strategy.getDefaultState()
      let isFuseTriggered = defaultState[2][1].toString() === '2' || defaultState[2][1].toString() === '3' || defaultState[2][2].toString() === '2' || defaultState[2][2].toString() === '3'

      if (!isFuseTriggered && lastFuseTimestamp > 0) {
        console.log('No fuse trigger: continue work.')
        lastFuseTimestamp = 0
      }

      if (await strategy.needRebalance()) {
        rebalances++;
        process.stdout.write(`NSR ${rebalances}.. `);
        const lockedPercentBefore = await getLockedPercent(reader, strategy.address)
        tx = await strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
        txReceipt = await tx.wait();
        fees = UniswapV3StrategyUtils.extractClaimedFees(txReceipt)
        if (fees) {
          fee0 = fee0.add(fees[0])
          fee1 = fee1.add(fees[1])
        }
        const lossCovered = UniversalTestUtils.extractLossCoveredUniversal(txReceipt)

        const lossUncovered = UniswapV3StrategyUtils.extractPriceChangeLoss(txReceipt)

        const lockedPercentAfter = await getLockedPercent(reader, strategy.address)
        console.log(`done with ${txReceipt.gasUsed} gas.`);
        totalLossCoveredFromInsurance = totalLossCoveredFromInsurance.add(lossCovered)
        const extractedRebalanceLoss = UniswapV3StrategyUtils.extractRebalanceLoss(txReceipt)
        console.log(`Locked for debt service: ${lockedPercentBefore}% -> ${lockedPercentAfter}%. Price change loss covered by insurance: ${formatUnits(lossCovered, tokenADecimals)}. Price change profit to cover: ${formatUnits(extractedRebalanceLoss[1], tokenADecimals)}.`)
        rebalanceLoss = rebalanceLoss.add(extractedRebalanceLoss[0])
        totalLossCoveredFromRewards = totalLossCoveredFromRewards.add(extractedRebalanceLoss[2])
        totalProfitCovered = totalProfitCovered.add(extractedRebalanceLoss[1])
        nsrAndRebalanceDebtLoss = nsrAndRebalanceDebtLoss.add(extractedRebalanceLoss[0])
        totalPriceChangeLoss = totalPriceChangeLoss.add(lossUncovered[0].add(lossUncovered[1]))

        lastNSRTimestamp = poolTx.timestamp
      }

      defaultState = await strategy.getDefaultState()
      isFuseTriggered = defaultState[2][1].toString() === '2' || defaultState[2][1].toString() === '3' || defaultState[2][2].toString() === '2' || defaultState[2][2].toString() === '3'
      const isWithdrawDone = defaultState[2][3].toNumber() > 0;

      if (isFuseTriggered) {
        if (lastFuseTimestamp > 0 && lastFuseTimestamp !== poolTx.timestamp) {
          timeOnFuse += poolTx.timestamp - lastFuseTimestamp
        }

        if (lastFuseTimestamp === 0) {
          console.log('Fuse trigger: liquidity is not provided, NSR stopped.')
        }

        lastFuseTimestamp = poolTx.timestamp
      }

      if (rebalanceDebt && reader) {
        const percent = await getLockedPercent(reader, strategy.address)
        const needForcedRebalanceDebt = !isFuseTriggered && percent > forceRebalanceDebtLockedPercent;
        const needDelayedRebalanceDebt = !isFuseTriggered && percent > allowedLockedPercent && poolTx.timestamp - lastNSRTimestamp > rebalanceDebtDelay

        if ((isFuseTriggered && !isWithdrawDone) || needDelayedRebalanceDebt || needForcedRebalanceDebt) {
          rebalancesDebt++
          if (needDelayedRebalanceDebt || needForcedRebalanceDebt) {
            process.stdout.write(`Rebalance debt ${rebalancesDebt} (${needDelayedRebalanceDebt ? 'delayed' : 'forced'}).. `)
            if (needDelayedRebalanceDebt) {
              rebalancesDebtDelayed++
            }
          } else {
            process.stdout.write(`Rebalance debt ${rebalancesDebt} (closing debts on fuse trigger).. `)
            rebalancesDebtClosing++
          }

          const PLAN_SWAP_REPAY = 0;
          const PLAN_REPAY_SWAP_REPAY = 1;

          const planEntryData = !isFuseTriggered
            ? defaultAbiCoder.encode(
            ['uint256', 'uint256'],
            [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT],
          )
          : defaultAbiCoder.encode(
            ['uint256', 'uint256'],
            [PLAN_SWAP_REPAY, 0],
          );

          const quote = await strategy.callStatic.quoteWithdrawByAgg(planEntryData, {gasLimit: 19_000_000});

          tx = await strategy.withdrawByAggStep(
            quote[0],
            MaticAddresses.ZERO_ADDRESS,
            quote[1],
            '0x00',
            planEntryData,
            isFuseTriggered ? 0 : 1,
            {gasLimit: 19_000_000}
          )
          txReceipt = await tx.wait()
          console.log(`done with ${txReceipt.gasUsed} gas.`)

          fees = UniswapV3StrategyUtils.extractClaimedFees(txReceipt)
          if (fees) {
            fee0 = fee0.add(fees[0])
            fee1 = fee1.add(fees[1])
          }

          const percentAfter = await getLockedPercent(reader, strategy.address)
          const lossCovered = UniversalTestUtils.extractLossCoveredUniversal(txReceipt)

          const lossUncovered = UniswapV3StrategyUtils.extractPriceChangeLoss(txReceipt)

          const extractedRebalanceLoss = UniswapV3StrategyUtils.extractRebalanceDebtLoss(txReceipt)
          const extractedUnsentAmountToInsurance = UniswapV3StrategyUtils.extractRebalanceDebtUnsentProfitToCover(txReceipt)

          console.log(`Locked for debt service: ${percent}% -> ${percentAfter}%.${isFuseTriggered && isWithdrawDone ? ' Withdraw done.' : ''} Price change Loss covered by insurance: ${formatUnits(lossCovered, tokenADecimals)}. Price change profit to cover: ${formatUnits(extractedRebalanceLoss[1], tokenADecimals)}. Swap loss: ${formatUnits(extractedRebalanceLoss[0], tokenADecimals)}. Swap loss for cover by rewards: ${formatUnits(extractedRebalanceLoss[2], tokenADecimals)}. Covered loss from rewards: ${extractedUnsentAmountToInsurance[0]}.`)

          totalLossCoveredFromInsurance = totalLossCoveredFromInsurance.add(lossCovered)
          totalLossCoveredFromRewards = totalLossCoveredFromRewards.add(extractedRebalanceLoss[2])
          totalProfitCovered = totalProfitCovered.add(extractedRebalanceLoss[1])
          nsrAndRebalanceDebtLoss = nsrAndRebalanceDebtLoss.add(extractedRebalanceLoss[0])
          totalPriceChangeLoss = totalPriceChangeLoss.add(lossUncovered[0].add(lossUncovered[1]))
        }
      }
    }

    previousTimestamp = poolTx.timestamp;
    if (i >= txsTotal) {
      break;
    }
  }

  console.log('doHardWork...');
  const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
  const hwResult = await strategy.connect(splitterSigner).callStatic.doHardWork()
  tx = await strategy.connect(splitterSigner).doHardWork();
  txReceipt = await tx.wait()
  fees = UniswapV3StrategyUtils.extractClaimedFees(txReceipt)
  if (fees) {
    fee0 = fee0.add(fees[0])
    fee1 = fee1.add(fees[1])
    console.log('Total fee0', fee0.toString())
    console.log('Total fee1', fee1.toString())
  }
  const lossCoveredAtHardwork = UniversalTestUtils.extractLossCoveredUniversal(txReceipt)
  totalLossCoveredFromInsurance = totalLossCoveredFromInsurance.add(lossCoveredAtHardwork)

  const strategyTotalAssetsAfter = await strategy.totalAssets();
  const endTimestampLocal = Math.floor(Date.now() / 1000);

  const vaultTotalAssetsAfter = await vault.totalAssets()
  const insuranceAssetsAfter = await tokenA.balanceOf(await vault.insurance())

  const earned = tokenA.address === token0.address ? fee0.add(fee1.mul(endPrice).div(parseUnits('1', token1Decimals))) : fee1.add(fee0.mul(endPrice).div(parseUnits('1', token0Decimals)));

  const strategyTokenBBalance = await tokenB.balanceOf(strategy.address)
  const tokenBDecimals = await tokenB.decimals()

  return {
    vaultName: await vault.name(),
    vaultAssetSymbol: await tokenA.symbol(),
    vaultAssetDecimals: tokenADecimals,
    tickRange: (state[1][2] - state[1][1]) / 2,
    rebalanceTickRange: state[1][3],
    startTimestamp,
    endTimestamp,
    investAmount,
    earned,
    rebalances,
    rebalancesDebt,
    startPrice,
    endPrice,
    maxPrice,
    minPrice,
    backtestLocalTimeSpent: endTimestampLocal - startTimestampLocal,
    tokenBSymbol: await tokenB.symbol(),
    disableBurns,
    disableMints,
    hardworkEarned: hwResult[0],
    hardworkLost: hwResult[1],
    vaultTotalAssetsBefore,
    vaultTotalAssetsAfter,
    strategyTotalAssetsAfter,
    insuranceAssetsBefore,
    insuranceAssetsAfter,
    totalLossCovered: totalLossCoveredFromInsurance,
    totalLossCoveredFromRewards,
    rebalanceLoss,
    allowedLockedPercent,
    forceRebalanceDebtLockedPercent,
    rebalanceDebtDelay,
    timeOnFuse,
    rebalancesDebtDelayed,
    rebalancesDebtClosing,
    poolTxs: poolTxs.length,
    totalProfitCovered,
    nsrAndRebalanceDebtLoss,
    strategyTokenBBalance,
    tokenBDecimals,
    totalPriceChangeLoss,
  };
}

export function getApr(earned: BigNumber, investAmount: BigNumber, startTimestamp: number, endTimestamp: number) {
  const earnedPerSec1e10 = endTimestamp > startTimestamp ? earned.mul(parseUnits('1', 10)).div(endTimestamp - startTimestamp) : BigNumber.from(0);
  const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10));
  const apr = earnedPerDay.mul(365).mul(100000000).div(investAmount).div(1000);
  return +formatUnits(apr, 3)
}

export function showBacktestResult(r: IBacktestResult, fuseThresholds: [] = [], startBlock: number, endBlock: number) {
  console.log(`Strategy ${r.vaultName}. Tick range: ${r.tickRange} (+-${r.tickRange /
  100}% price). Rebalance tick range: ${r.rebalanceTickRange} (+-${r.rebalanceTickRange / 100}% price).`);
  console.log(`Allowed locked: ${r.allowedLockedPercent}%. Forced rebalance debt locked: ${r.forceRebalanceDebtLockedPercent}%. Rebalance debt delay: ${r.rebalanceDebtDelay} secs. Fuse thresholds: [${fuseThresholds[0].join(',')}], [${fuseThresholds[1].join(',')}].`)

  // real APR revenue
  const realApr = getApr(r.earned.add(r.totalProfitCovered).sub(r.totalLossCovered).sub(r.totalLossCoveredFromRewards), r.vaultTotalAssetsBefore, r.startTimestamp, r.endTimestamp)
  console.log(`Real APR (    revenue    ): ${realApr}%. Total assets before: ${formatUnits(r.vaultTotalAssetsBefore, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Fees earned: ${formatUnits(r.earned, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Profit to cover: ${formatUnits(r.totalProfitCovered, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Loss covered by insurance: ${formatUnits(r.totalLossCovered, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. NSR and swap loss covered from rewards: ${formatUnits(r.totalLossCoveredFromRewards, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}.`)

  // real APR balance change
  const totalBalanceAfter = r.vaultTotalAssetsAfter.add(r.insuranceAssetsAfter)
  const totalBalanceBefore = r.vaultTotalAssetsBefore.add(r.insuranceAssetsBefore)
  const realAprBalances = getApr(totalBalanceAfter.sub(totalBalanceBefore), r.vaultTotalAssetsBefore, r.startTimestamp, r.endTimestamp)
  console.log(`Real APR (balances change): ${realAprBalances}%. Balance change: ${totalBalanceAfter.gt(totalBalanceBefore) ? '+' : ''}${formatUnits(totalBalanceAfter.sub(totalBalanceBefore), r.vaultAssetDecimals)}. Before: ${formatUnits(totalBalanceBefore, r.vaultAssetDecimals)}. After: ${formatUnits(totalBalanceAfter, r.vaultAssetDecimals)}.`)

  // ui APRs
  const vaultApr = getApr(r.vaultTotalAssetsAfter.sub(r.vaultTotalAssetsBefore), r.vaultTotalAssetsBefore, r.startTimestamp, r.endTimestamp)
  console.log(`Vault APR (in ui): ${vaultApr}%. Total assets before: ${formatUnits(r.vaultTotalAssetsBefore, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Earned: ${formatUnits(r.vaultTotalAssetsAfter.sub(r.vaultTotalAssetsBefore), r.vaultAssetDecimals)} ${r.vaultAssetSymbol}.`)
  const strategyApr = getApr(r.hardworkEarned.sub(r.hardworkLost), r.strategyTotalAssetsAfter, r.startTimestamp, r.endTimestamp)
  console.log(`Strategy APR (in ui): ${strategyApr}%. Total assets: ${formatUnits(r.strategyTotalAssetsAfter, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Hardwork earned: ${formatUnits(r.hardworkEarned, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Hardwork lost: ${formatUnits(r.hardworkLost, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}.`)

  console.log(`Insurance balance change: ${r.insuranceAssetsAfter.gt(r.insuranceAssetsBefore) ? '+' : ''}${formatUnits(r.insuranceAssetsAfter.sub(r.insuranceAssetsBefore), r.vaultAssetDecimals)} ${r.vaultAssetSymbol}.`)

  console.log(`Rebalances: ${r.rebalances}. Rebalance debts: ${r.rebalancesDebt} (${r.rebalancesDebtDelayed} delayed, ${r.rebalancesDebt - r.rebalancesDebtDelayed - r.rebalancesDebtClosing} forced, ${r.rebalancesDebtClosing} closing).`);
  console.log(`Period: ${periodHuman(r.endTimestamp - r.startTimestamp)}. Start: ${new Date(r.startTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(r.startTimestamp *
    1000).toLocaleTimeString('en-US')} (block: ${startBlock}). Finish: ${new Date(r.endTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(r.endTimestamp * 1000).toLocaleTimeString('en-US')} (block: ${endBlock}).`);
  console.log(`Time on fuse trigger: ${periodHuman(r.timeOnFuse)} (${Math.round(r.timeOnFuse / (r.endTimestamp - r.startTimestamp) * 1000)/10}%).`)
  console.log(`Prices in pool: start ${formatUnits(r.startPrice, r.vaultAssetDecimals)}, end ${formatUnits(
    r.endPrice,
    r.vaultAssetDecimals,
  )}, min ${formatUnits(r.minPrice, r.vaultAssetDecimals)}, max ${formatUnits(r.maxPrice, r.vaultAssetDecimals)}.`);

  if (r.disableMints || r.disableBurns) {
    console.log(`Mints: ${!r.disableMints ? 'enabled' : 'disabled'}. Burns: ${!r.disableBurns
      ? 'enabled'
      : 'disabled'}.`);
  }

  console.log(`Time spent for backtest: ${periodHuman(r.backtestLocalTimeSpent)}. Pool transactions: ${r.poolTxs}. Strategy transactions: ${r.rebalances + r.rebalancesDebt + 2}.`);
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

async function getLockedPercent(reader: PairBasedStrategyReader, strategyAddress) {
  const r = await reader.getLockedUnderlyingAmount(strategyAddress) as [BigNumber, BigNumber]
  return  r[0].mul(100).div(r[1]).toNumber();
}
