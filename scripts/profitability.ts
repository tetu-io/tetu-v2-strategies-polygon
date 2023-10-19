import {createClient} from "urql";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {getApr} from "./uniswapV3Backtester/strategyBacktest";
import {writeFileSyncRestoreFolder} from "../test/baseUT/utils/FileUtils";
import fs, {writeFileSync} from "fs";
import {MaticAddresses} from "./addresses/MaticAddresses";
import {EnvSetup} from "./utils/EnvSetup";
import {ethers} from "hardhat";
import {
    IPairBasedDefaultStateProvider__factory,
    ITetuConverter__factory, ITetuLiquidator__factory,
} from "../typechain";
import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {BigNumber} from "ethers";

const whitelistedVaultsForInvesting = ['tUSDC',]
const SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/a17/tetu-v2?version=pending'
const CONVERTER = MaticAddresses.TETU_CONVERTER

interface IDebtState {
    tokenACollateral: string
    tokenADebt: string
    tokenBCollateral: string
    tokenBDebt: string
}

async function getDebtState(
    strategyAddress: string,
    tokenA: string,
    tokenB: string,
    block: number,
    provider: JsonRpcProvider
): Promise<IDebtState> {
    const d: IDebtState = {
        tokenACollateral: '0',
        tokenADebt: '0',
        tokenBCollateral: '0',
        tokenBDebt: '0',
    }

    const converter = ITetuConverter__factory.connect(CONVERTER, provider)

    const rAB = await converter.getDebtAmountStored(strategyAddress, tokenA, tokenB, false, {blockTag: block})
    const rBA = await converter.getDebtAmountStored(strategyAddress, tokenB, tokenA, false, {blockTag: block})
    d.tokenBDebt = rAB[0]
    d.tokenACollateral = rAB[1]
    d.tokenADebt = rBA[0]
    d.tokenBCollateral = rBA[1]
    return d
}

async function main() {
    console.log('Tetu V2 strategies profitability');

    const rpc = EnvSetup.getEnv().maticRpcUrl
    const provider = new ethers.providers.JsonRpcProvider(rpc)
    const liquidator = ITetuLiquidator__factory.connect(MaticAddresses.TETU_LIQUIDATOR, provider)

    const pathOut = "./tmp/profitability.csv";
    const headers = [
        'Strategy',
        'Date',
        'Real APR',
        'TVL',
        'Claimed fees',
        'Claimed rewards',
        'FixPrice profit',
        'FixPrice Loss (covered by insurance)',
        'Debt cost',
        'Swap Loss (covered by rewards)',
    ]
    let rows: string[][] = []

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

                const defaultState = await IPairBasedDefaultStateProvider__factory.connect(strategy.id, provider).getDefaultState()
                const tokenA = defaultState.addr[0]
                const tokenB = defaultState.addr[1]

                let debtState: IDebtState | undefined = undefined

                const dayHistories: {
                    day: string
                    realApr: number
                    feesClaimed: string
                    rewardsClaimed: string
                    profitCovered: string
                    lossCoveredFromInsurance: string
                    lossCoveredFromRewards: string
                    debtCost: string
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
                            lossCoveredFromRewards: '0',
                            debtCost: '0',
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

                    if (debtState === undefined) {
                        debtState = await getDebtState(strategy.id, tokenA, tokenB, history.block + 1, provider)
                    } else {
                        const newDebtState = await getDebtState(strategy.id, tokenA, tokenB, history.block - 1, provider)

                        let debtCost = '0'
                        if (BigNumber.from(debtState.tokenACollateral).gt(0)) {
                            const supplyProfit = BigNumber.from(newDebtState.tokenACollateral).sub(BigNumber.from(debtState.tokenACollateral))
                            const debtLoss = await liquidator.getPrice(tokenB, tokenA, BigNumber.from(newDebtState.tokenBDebt).sub(BigNumber.from(debtState.tokenBDebt)), {blockTag: history.block - 1})
                            debtCost = formatUnits(
                                debtLoss.sub(supplyProfit),
                                vaultEntity.decimals
                            )
                        }
                        if (BigNumber.from(debtState.tokenBCollateral).gt(0)) {
                            const supplyProfit = await liquidator.getPrice(tokenB, tokenA, BigNumber.from(newDebtState.tokenBCollateral).sub(BigNumber.from(debtState.tokenBCollateral)),  {blockTag: history.block - 1})
                            const debtLoss = BigNumber.from(newDebtState.tokenADebt).sub(BigNumber.from(debtState.tokenADebt))
                            debtCost = formatUnits(
                                debtLoss.sub(supplyProfit),
                                vaultEntity.decimals
                            )
                        }

                        dayHistories[dayIndex].debtCost = formatUnits(
                            parseUnits(dayHistories[dayIndex].debtCost, vaultEntity.decimals).add(
                                parseUnits(debtCost, vaultEntity.decimals)
                            ),
                            vaultEntity.decimals
                        )

                        debtState = await getDebtState(strategy.id, tokenA, tokenB, history.block + 1, provider)
                    }

                }

                rows.push(...dayHistories.map(day => [
                    `${strategy.specificName} [${strategy.version}]`,
                    day.day,
                    '' + day.realApr,
                    day.lastHistory.tvl,
                    day.feesClaimed,
                    day.rewardsClaimed,
                    day.profitCovered,
                    day.lossCoveredFromInsurance,
                    day.debtCost,
                    day.lossCoveredFromRewards,
                ]))

                for (const day of dayHistories) {
                    console.log(`  ${day.day}. Real APR: ${day.realApr}%. Fees: ${day.feesClaimed}. Rewards: ${day.rewardsClaimed}. Profit to cover: ${day.profitCovered}. Loss insurance: ${day.lossCoveredFromInsurance}. Loss rewards: ${day.lossCoveredFromRewards}. Debt cost: ${day.debtCost}.`)
                }
            }
            console.log('')
        }
    }

    fs.rmSync(pathOut, {force: true,})
    writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', {encoding: 'utf8', flag: 'a'})
    for (const row of rows) {
        writeFileSync(pathOut, row.join(';') + '\n', {encoding: 'utf8', flag: 'a'})
    }
}

function getStrategiesData() {
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
            history(first: 100, orderBy: id, orderDirection: desc) {
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
    }`
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
