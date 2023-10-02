import {createClient} from "urql";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {getApr} from "./uniswapV3Backtester/strategyBacktest";

const whitelistedVaultsForInvesting = ['tUSDC',]
const SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/a17/tetu-v2'

async function main() {
    console.log('Tetu V2 strategies profitability');

    const client = createClient({
        url: SUBGRAPH,
    })

    const data = await client.query(getStrategiesData(), {}).toPromise()
    if (!data?.data?.vaultEntities) {
        console.log('Error fetching from subgraph')
        return
    }

    for (const vaultEntity of data.data.vaultEntities) {
        if (whitelistedVaultsForInvesting.includes(vaultEntity.symbol)) {
            console.log('Vault', vaultEntity.symbol)
            for (const strategy of vaultEntity.splitter.strategies) {
                console.log(`Strategy ${strategy.specificName} [${strategy.version}]`)

                const dayHistories: {
                    day: string
                    realApr: number
                    feesClaimed: string
                    rewardsClaimed: string
                    profitCovered: string
                    lossCoveredFromInsurance: string
                    lossCoveredFromRewards: string
                    lastHistory: {
                        time: number
                        tvl: string
                        feesClaimed: string
                        rewardsClaimed: string
                        profitCovered: string
                        lossCoveredFromInsurance: string
                        lossCoveredFromRewards: string
                    }
                }[] = []

                let dayIndex = 0
                let dayIndexStr = ''
                for (let i = strategy.history.length - 1; i >= 0; i--) {
                    const history = strategy.history[i]
                    const dayStr = (new Date(history.time * 1000)).toLocaleDateString('en-US')
                    if (!dayIndexStr) {
                        dayIndexStr = dayStr
                    } else if (dayIndexStr !== dayStr) {
                        dayIndex++
                        dayIndexStr = dayStr
                    }

                    if (dayHistories[dayIndex] === undefined) {
                        dayHistories.push({
                            day: dayStr,
                            realApr: 0,
                            lastHistory: history,
                            feesClaimed: '0',
                            rewardsClaimed: '0',
                            profitCovered: '0',
                            lossCoveredFromInsurance: '0',
                            lossCoveredFromRewards: '0'
                        })

                        if (dayIndex > 0) {
                            const prevDay = dayHistories[dayIndex - 1]
                            dayHistories[dayIndex].feesClaimed = formatUnits(
                                parseUnits(history.feesClaimed, vaultEntity.decimals)
                                    .sub(parseUnits(prevDay.lastHistory.feesClaimed, vaultEntity.decimals)),
                                vaultEntity.decimals
                            )
                            dayHistories[dayIndex].rewardsClaimed = formatUnits(
                                parseUnits(history.rewardsClaimed, vaultEntity.decimals)
                                    .sub(parseUnits(prevDay.lastHistory.rewardsClaimed, vaultEntity.decimals)),
                                vaultEntity.decimals
                            )
                            dayHistories[dayIndex].profitCovered = formatUnits(
                                parseUnits(history.profitCovered, vaultEntity.decimals)
                                    .sub(parseUnits(prevDay.lastHistory.profitCovered, vaultEntity.decimals)),
                                vaultEntity.decimals
                            )
                            dayHistories[dayIndex].lossCoveredFromInsurance = formatUnits(
                                parseUnits(history.lossCoveredFromInsurance, vaultEntity.decimals)
                                    .sub(parseUnits(prevDay.lastHistory.lossCoveredFromInsurance, vaultEntity.decimals)),
                                vaultEntity.decimals
                            )
                            dayHistories[dayIndex].lossCoveredFromRewards = formatUnits(
                                parseUnits(history.lossCoveredFromRewards, vaultEntity.decimals)
                                    .sub(parseUnits(prevDay.lastHistory.lossCoveredFromRewards, vaultEntity.decimals)),
                                vaultEntity.decimals
                            )
                            if (parseUnits(history.tvl, vaultEntity.decimals).gt(0)) {
                                dayHistories[dayIndex].realApr = getApr(
                                    parseUnits(dayHistories[dayIndex].feesClaimed, vaultEntity.decimals)
                                        .add(parseUnits(dayHistories[dayIndex].rewardsClaimed, vaultEntity.decimals))
                                        .add(parseUnits(dayHistories[dayIndex].profitCovered, vaultEntity.decimals))
                                        .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromInsurance, vaultEntity.decimals))
                                        .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromRewards, vaultEntity.decimals)),
                                    parseUnits(history.tvl, vaultEntity.decimals),
                                    prevDay.lastHistory.time,
                                    history.time
                                )
                            }
                        }
                    } else {
                        dayHistories[dayIndex].feesClaimed = formatUnits(
                            parseUnits(dayHistories[dayIndex].feesClaimed, vaultEntity.decimals).add(
                                parseUnits(history.feesClaimed, vaultEntity.decimals)
                                    .sub(parseUnits(dayHistories[dayIndex].lastHistory.feesClaimed, vaultEntity.decimals))
                            ),
                            vaultEntity.decimals
                        )
                        dayHistories[dayIndex].rewardsClaimed = formatUnits(
                            parseUnits(dayHistories[dayIndex].rewardsClaimed, vaultEntity.decimals).add(
                                parseUnits(history.rewardsClaimed, vaultEntity.decimals)
                                    .sub(parseUnits(dayHistories[dayIndex].lastHistory.rewardsClaimed, vaultEntity.decimals))
                            ),
                            vaultEntity.decimals
                        )
                        dayHistories[dayIndex].profitCovered = formatUnits(
                            parseUnits(dayHistories[dayIndex].profitCovered, vaultEntity.decimals).add(
                                parseUnits(history.profitCovered, vaultEntity.decimals)
                                    .sub(parseUnits(dayHistories[dayIndex].lastHistory.profitCovered, vaultEntity.decimals))
                            ),
                            vaultEntity.decimals
                        )
                        dayHistories[dayIndex].lossCoveredFromInsurance = formatUnits(
                            parseUnits(dayHistories[dayIndex].lossCoveredFromInsurance, vaultEntity.decimals).add(
                                parseUnits(history.lossCoveredFromInsurance, vaultEntity.decimals)
                                    .sub(parseUnits(dayHistories[dayIndex].lastHistory.lossCoveredFromInsurance, vaultEntity.decimals))
                            ),
                            vaultEntity.decimals
                        )
                        dayHistories[dayIndex].lossCoveredFromRewards = formatUnits(
                            parseUnits(dayHistories[dayIndex].lossCoveredFromRewards, vaultEntity.decimals).add(
                                parseUnits(history.lossCoveredFromRewards, vaultEntity.decimals)
                                    .sub(parseUnits(dayHistories[dayIndex].lastHistory.lossCoveredFromRewards, vaultEntity.decimals))
                            ),
                            vaultEntity.decimals
                        )
                        if (dayIndex > 0) {
                            const prevDay = dayHistories[dayIndex - 1]

                            if (parseUnits(history.tvl, vaultEntity.decimals).gt(0)) {
                                dayHistories[dayIndex].realApr = getApr(
                                    parseUnits(dayHistories[dayIndex].feesClaimed, vaultEntity.decimals)
                                        .add(parseUnits(dayHistories[dayIndex].rewardsClaimed, vaultEntity.decimals))
                                        .add(parseUnits(dayHistories[dayIndex].profitCovered, vaultEntity.decimals))
                                        .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromInsurance, vaultEntity.decimals))
                                        .sub(parseUnits(dayHistories[dayIndex].lossCoveredFromRewards, vaultEntity.decimals)),
                                    parseUnits(history.tvl, vaultEntity.decimals),
                                    prevDay.lastHistory.time,
                                    history.time
                                )
                            }
                        }

                        dayHistories[dayIndex].lastHistory = history
                    }
                }

                for (const day of dayHistories) {
                    console.log(`  ${day.day}. Real APR: ${day.realApr}%. Fees: ${day.feesClaimed}. Rewards: ${day.rewardsClaimed}. Profit to cover: ${day.profitCovered}. Loss insurance: ${day.lossCoveredFromInsurance}. Loss rewards: ${day.lossCoveredFromRewards}.`)
                }

                // console.log(dayHistories)
            }
            console.log('')
        }
    }
}

function getStrategiesData() {
    return `query {
      vaultEntities {
        symbol
        decimals
        splitter {
          strategies(where: {paused: false}) {
            name
            version
            specificName
            history(first: 100, orderBy: id, orderDirection: desc) {
              time
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
    }`
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

