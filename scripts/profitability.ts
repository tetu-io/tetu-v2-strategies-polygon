import { createClient } from 'urql';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { getApr } from './uniswapV3Backtester/strategyBacktest';
import { writeFileSyncRestoreFolder } from '../test/baseUT/utils/FileUtils';
import fs, { writeFileSync } from 'fs';
import { ethers } from 'hardhat';
import {
  IERC20__factory, IERC20Metadata__factory,
  IPairBasedDefaultStateProvider__factory,
  ITetuConverter__factory,
  ITetuLiquidator__factory,
} from '../typechain';
import { JsonRpcProvider } from '@ethersproject/providers/src.ts/json-rpc-provider';
import { BigNumber } from 'ethers';
import { Misc } from './utils/Misc';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';

const whitelistedVaultsForInvesting = ['tUSDC', 'tUSDbC'];
const SUBGRAPH = Misc.getSubgraphUrl();
const HISTORY_DAYS = 7;

interface IDebtState {
  tokenACollateral: string;
  tokenADebt: string;
  tokenBCollateral: string;
  tokenBDebt: string;
}

async function getDebtState(
  strategyAddress: string,
  tokenA: string,
  tokenB: string,
  block: number,
  provider: JsonRpcProvider,
): Promise<IDebtState> {
  const d: IDebtState = {
    tokenACollateral: '0',
    tokenADebt: '0',
    tokenBCollateral: '0',
    tokenBDebt: '0',
  };
  const tools = Addresses.getTools();
  const converter = ITetuConverter__factory.connect(tools.converter, provider);

  const rAB = await converter.getDebtAmountStored(strategyAddress, tokenA, tokenB, false, { blockTag: block });
  const rBA = await converter.getDebtAmountStored(strategyAddress, tokenB, tokenA, false, { blockTag: block });
  d.tokenBDebt = rAB[0].toString();
  d.tokenACollateral = rAB[1].toString();
  d.tokenADebt = rBA[0].toString();
  d.tokenBCollateral = rBA[1].toString();
  return d;
}

async function main() {
  console.log('Tetu V2 strategies profitability');

  const provider = ethers.provider;
  const tools = Addresses.getTools();

  const liquidator = ITetuLiquidator__factory.connect(tools.liquidator, provider);

  const pathOut = `./tmp/profitability/${Date.now()}.csv`;
  const headers = [
    'Strategy',
    'Date',
    'Real APR',
    'TVL',
    'tokenA Balance',
    'tokenB Balance',
    'Claimed fees(without covered by profit)',
    'Claimed rewards(without covered by profit)',
    'Covered by profit',
    'Covered by insurance',
    'Covered by insurance % x1000',
    'Debt cost',
    'Debt cost % x1000',
    'IL cost(+other)',
    'Swap Loss (covered by profit)',
  ];
  const rows: string[][] = [];

  const client = createClient({
    url: SUBGRAPH,
  });

  const DAY = 60 * 60 * 24;
  const data = await client.query(getStrategiesData((Math.round(Date.now() / 1000 / DAY) * DAY) - DAY *
    HISTORY_DAYS), {}).toPromise();
  // console.log(data.data)
  if (!data?.data?.vaultEntities) {
    console.log('Error fetching from subgraph');
    return;
  }

  for (const vaultEntity of data.data.vaultEntities) {
    if (whitelistedVaultsForInvesting.includes(vaultEntity.symbol)) {
      console.log('Vault', vaultEntity.symbol);
      for (const strategy of vaultEntity.splitter.strategies) {
        console.log(`Strategy ${strategy.specificName} [${strategy.version}]`);

        const defaultState = await IPairBasedDefaultStateProvider__factory.connect(strategy.id, provider)
          .getDefaultState();
        const tokenA = defaultState.addr[0];
        const tokenB = defaultState.addr[1];
        const tokenADecimals = await IERC20Metadata__factory.connect(tokenA, provider).decimals();
        const tokenBDecimals = await IERC20Metadata__factory.connect(tokenB, provider).decimals();

        let debtState: IDebtState | undefined = undefined;

        const dayHistories: {
          time: number
          day: string
          realApr: number
          feesClaimed: string
          rewardsClaimed: string
          profitCovered: string
          lossCoveredFromInsurance: string
          lossCoveredFromRewards: string
          debtCost: string
          tokenABalance: string
          tokenBBalance: string
          lastHistory: {
            time: number
            tvl: string
            feesClaimed: string
            rewardsClaimed: string
            profitCovered: string
            lossCoveredFromInsurance: string
            lossCoveredFromRewards: string
          }
        }[] = [];

        let dayIndex = 0;
        let dayIndexStr = '';
        for (let i = strategy.history.length - 1; i >= 0; i--) {
          const history = strategy.history[i];
          const dayStr = (new Date(history.time * 1000)).toLocaleDateString('ru-RU');
          process.stdout.write(`\r${strategy.specificName} ${dayStr}  ${strategy.history.length -
          i} / ${strategy.history.length}`);
          if (!dayIndexStr) {
            dayIndexStr = dayStr;
          } else if (dayIndexStr !== dayStr) {
            dayIndex++;
            dayIndexStr = dayStr;
          }


          if (dayHistories[dayIndex] === undefined) {
            dayHistories.push({
              time: history.time,
              day: dayStr,
              realApr: 0,
              lastHistory: history,
              feesClaimed: '0',
              rewardsClaimed: '0',
              profitCovered: '0',
              lossCoveredFromInsurance: '0',
              lossCoveredFromRewards: '0',
              debtCost: '0',
              tokenABalance: formatUnits(await IERC20__factory.connect(tokenA, provider).balanceOf(strategy.id), tokenADecimals),
              tokenBBalance: formatUnits(await IERC20__factory.connect(tokenB, provider).balanceOf(strategy.id), tokenBDecimals),
            });

            if (dayIndex > 0) {
              const prevDay = dayHistories[dayIndex - 1];
              dayHistories[dayIndex].feesClaimed = formatUnits(
                parseUnits(history.feesClaimed, vaultEntity.decimals)
                  .sub(parseUnits(prevDay.lastHistory.feesClaimed, vaultEntity.decimals)),
                vaultEntity.decimals,
              );
              dayHistories[dayIndex].rewardsClaimed = formatUnits(
                parseUnits(history.rewardsClaimed, vaultEntity.decimals)
                  .sub(parseUnits(prevDay.lastHistory.rewardsClaimed, vaultEntity.decimals)),
                vaultEntity.decimals,
              );
              dayHistories[dayIndex].profitCovered = formatUnits(
                parseUnits(history.profitCovered, vaultEntity.decimals)
                  .sub(parseUnits(prevDay.lastHistory.profitCovered, vaultEntity.decimals)),
                vaultEntity.decimals,
              );
              dayHistories[dayIndex].lossCoveredFromInsurance = formatUnits(
                parseUnits(history.lossCoveredFromInsurance, vaultEntity.decimals)
                  .sub(parseUnits(prevDay.lastHistory.lossCoveredFromInsurance, vaultEntity.decimals)),
                vaultEntity.decimals,
              );
              dayHistories[dayIndex].lossCoveredFromRewards = formatUnits(
                parseUnits(history.lossCoveredFromRewards, vaultEntity.decimals)
                  .sub(parseUnits(prevDay.lastHistory.lossCoveredFromRewards, vaultEntity.decimals)),
                vaultEntity.decimals,
              );
              if (parseUnits(history.tvl, vaultEntity.decimals).gt(0)) {
                dayHistories[dayIndex].realApr = getApr(
                  parseUnits(dayHistories[dayIndex].feesClaimed, vaultEntity.decimals)
                    .add(parseUnits(dayHistories[dayIndex].rewardsClaimed, vaultEntity.decimals))
                    .add(parseUnits(dayHistories[dayIndex].profitCovered, vaultEntity.decimals))
                    .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromInsurance, vaultEntity.decimals))
                    .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromRewards, vaultEntity.decimals)),
                  parseUnits(history.tvl, vaultEntity.decimals),
                  prevDay.lastHistory.time,
                  history.time,
                );
              }
            }
          } else {
            dayHistories[dayIndex].feesClaimed = formatUnits(
              parseUnits(dayHistories[dayIndex].feesClaimed, vaultEntity.decimals).add(
                parseUnits(history.feesClaimed, vaultEntity.decimals)
                  .sub(parseUnits(dayHistories[dayIndex].lastHistory.feesClaimed, vaultEntity.decimals)),
              ),
              vaultEntity.decimals,
            );
            dayHistories[dayIndex].rewardsClaimed = formatUnits(
              parseUnits(dayHistories[dayIndex].rewardsClaimed, vaultEntity.decimals).add(
                parseUnits(history.rewardsClaimed, vaultEntity.decimals)
                  .sub(parseUnits(dayHistories[dayIndex].lastHistory.rewardsClaimed, vaultEntity.decimals)),
              ),
              vaultEntity.decimals,
            );
            dayHistories[dayIndex].profitCovered = formatUnits(
              parseUnits(dayHistories[dayIndex].profitCovered, vaultEntity.decimals).add(
                parseUnits(history.profitCovered, vaultEntity.decimals)
                  .sub(parseUnits(dayHistories[dayIndex].lastHistory.profitCovered, vaultEntity.decimals)),
              ),
              vaultEntity.decimals,
            );
            dayHistories[dayIndex].lossCoveredFromInsurance = formatUnits(
              parseUnits(dayHistories[dayIndex].lossCoveredFromInsurance, vaultEntity.decimals).add(
                parseUnits(history.lossCoveredFromInsurance, vaultEntity.decimals)
                  .sub(parseUnits(dayHistories[dayIndex].lastHistory.lossCoveredFromInsurance, vaultEntity.decimals)),
              ),
              vaultEntity.decimals,
            );
            dayHistories[dayIndex].lossCoveredFromRewards = formatUnits(
              parseUnits(dayHistories[dayIndex].lossCoveredFromRewards, vaultEntity.decimals).add(
                parseUnits(history.lossCoveredFromRewards, vaultEntity.decimals)
                  .sub(parseUnits(dayHistories[dayIndex].lastHistory.lossCoveredFromRewards, vaultEntity.decimals)),
              ),
              vaultEntity.decimals,
            );
            if (dayIndex > 0) {
              const prevDay = dayHistories[dayIndex - 1];

              if (parseUnits(history.tvl, vaultEntity.decimals).gt(0)) {
                dayHistories[dayIndex].realApr = getApr(
                  parseUnits(dayHistories[dayIndex].feesClaimed, vaultEntity.decimals)
                    .add(parseUnits(dayHistories[dayIndex].rewardsClaimed, vaultEntity.decimals))
                    .add(parseUnits(dayHistories[dayIndex].profitCovered, vaultEntity.decimals))
                    .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromInsurance, vaultEntity.decimals))
                    .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromRewards, vaultEntity.decimals)),
                  parseUnits(history.tvl, vaultEntity.decimals),
                  prevDay.lastHistory.time,
                  history.time,
                );
              }
            }

            dayHistories[dayIndex].lastHistory = history;
          }



          if (debtState === undefined) {
            debtState = await getDebtState(strategy.id, tokenA, tokenB, history.block + 1, provider);
          } else {
            const newDebtState = await getDebtState(strategy.id, tokenA, tokenB, history.block - 1, provider);

            let debtCost = '0';
            if (BigNumber.from(debtState.tokenACollateral).gt(0)) {
              const supplyProfit = BigNumber.from(newDebtState.tokenACollateral)
                .sub(BigNumber.from(debtState.tokenACollateral));
              const debtLoss = await liquidator.getPrice(
                tokenB,
                tokenA,
                BigNumber.from(newDebtState.tokenBDebt).sub(BigNumber.from(debtState.tokenBDebt)),
                { blockTag: history.block - 1 },
              );
              debtCost = formatUnits(
                debtLoss.sub(supplyProfit),
                vaultEntity.decimals,
              );
            }
            if (BigNumber.from(debtState.tokenBCollateral).gt(0)) {
              const supplyProfit = await liquidator.getPrice(
                tokenB,
                tokenA,
                BigNumber.from(newDebtState.tokenBCollateral).sub(BigNumber.from(debtState.tokenBCollateral)),
                { blockTag: history.block - 1 },
              );
              const debtLoss = BigNumber.from(newDebtState.tokenADebt).sub(BigNumber.from(debtState.tokenADebt));
              debtCost = formatUnits(
                debtLoss.sub(supplyProfit),
                vaultEntity.decimals,
              );
            }

            dayHistories[dayIndex].debtCost = formatUnits(
              parseUnits(dayHistories[dayIndex].debtCost, vaultEntity.decimals).add(
                parseUnits(debtCost, vaultEntity.decimals),
              ),
              vaultEntity.decimals,
            );

            debtState = await getDebtState(strategy.id, tokenA, tokenB, history.block + 1, provider);
          }

        }

        rows.push(...dayHistories.sort(d => d.time).map(day => [
          `${strategy.specificName} [${strategy.version}]`,
          day.day,
          '' + day.realApr,
          day.lastHistory.tvl,
          day.tokenABalance,
          day.tokenBBalance,
          day.feesClaimed,
          day.rewardsClaimed,
          day.profitCovered,
          day.lossCoveredFromInsurance,
          (Number(day.lossCoveredFromInsurance) / Number(day.lastHistory.tvl) * 100_000).toString(),
          day.debtCost,
          (Number(day.debtCost) / Number(day.lastHistory.tvl) * 100_000).toString(),
          (Number(day.lossCoveredFromInsurance) - Number(day.debtCost)).toString(),
          day.lossCoveredFromRewards,
        ]));
        rows.push(['\n']);

        console.log('\n');
        for (const day of dayHistories) {
          console.log(`  ${day.day}. Real APR: ${day.realApr}%. Fees: ${day.feesClaimed}. Rewards: ${day.rewardsClaimed}. Profit to cover: ${day.profitCovered}. Loss insurance: ${day.lossCoveredFromInsurance}. Loss rewards: ${day.lossCoveredFromRewards}. Debt cost: ${day.debtCost}.`);
        }
      }
      console.log('');
    }
  }

  fs.rmSync(pathOut, { force: true });
  writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', { encoding: 'utf8', flag: 'a' });
  for (const row of rows) {
    writeFileSync(pathOut, row.join(';') + '\n', { encoding: 'utf8', flag: 'a' });
  }
}

function getStrategiesData(fromTime: number) {
  return `query {
      vaultEntities {
        symbol
        decimals
        splitter {
          strategies(where: {paused: false}) {
            id
            name
            version
            specificName
            history(first: 1000, orderBy: id, orderDirection: desc, where: {time_gte: ${fromTime.toFixed(0)}}) {
              time
              block
              tvl
              feesClaimed
              rewardsClaimed
              profitCovered
              lossCoveredFromInsurance
              lossCoveredFromRewards
            }
          }
        }
      }
    }`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
