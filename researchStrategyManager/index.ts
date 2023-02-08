#!/usr/bin/env node
/* tslint:disable:no-trailing-whitespace */

import {BigNumber, ethers} from "ethers";
import {
  asset,
  erc20Abi, uniswapV3ResearchStrategyAbi,
  uniswapV3SimpleStrategyAbi,
} from "./constants";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {MaxUint256} from "@ethersproject/constants/lib/bignumbers";
import {config as dotEnvConfig} from "dotenv";

dotEnvConfig()

console.log('Uniswap strategies manager')

const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
console.log(`Signer ${signer.address}`)

async function approveIfNeed(token: string, spender: string, amount: BigNumber) {
  const gasPrice = await getGasPrice()
  const tokenContract = new ethers.Contract(token, erc20Abi, signer)
  const allowance = await tokenContract.allowance(signer.address, spender)
  if (allowance.lt(amount)) {
    process.stdout.write(`Approving ${await tokenContract.symbol()} for spender ${spender}.. `)
    const tx = await tokenContract.approve(spender, MaxUint256, {gasPrice,})
    process.stdout.write('tx sent.. ')
    await tx.wait()
    console.log('confirmed.')
  }
}

async function getGasPrice() {
  const gasPrice = await provider.getGasPrice()
  return gasPrice.mul(150).div(100)
}

async function deposit(token: string, strategyAddress: string, amount: BigNumber) {
  const gasPrice = await getGasPrice()
  const tokenContract = new ethers.Contract(token, erc20Abi, signer)
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3SimpleStrategyAbi, signer)
  process.stdout.write(`Depositing ${await tokenContract.symbol()} to strategy ${strategyAddress}.. `)
  const tx = await strategyContract.deposit(asset.address, amount, {gasPrice,})
  process.stdout.write('tx sent.. ')
  await tx.wait()
  console.log('confirmed.')
}

async function changeTickRange(strategyAddress: string, newTickRange: number) {
  const gasPrice = await getGasPrice()
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3SimpleStrategyAbi, signer)
  process.stdout.write(`Changing tickRange to ${newTickRange} for strategy ${strategyAddress}.. `)
  const tx = await strategyContract.changeTickRange(newTickRange, {gasPrice,})
  process.stdout.write('tx sent.. ')
  await tx.wait()
  console.log('confirmed.')
}

async function changeRebalanceTickRange(strategyAddress: string, newRebalanceTickRange: number) {
  const gasPrice = await getGasPrice()
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3SimpleStrategyAbi, signer)
  process.stdout.write(`Changing rebalanceTickRange to ${newRebalanceTickRange} for strategy ${strategyAddress}.. `)
  const tx = await strategyContract.changeRebalanceTickRange(newRebalanceTickRange, {gasPrice,})
  process.stdout.write('tx sent.. ')
  await tx.wait()
  console.log('confirmed.')
}

async function withdrawAll(strategyAddress: string) {
  const gasPrice = await getGasPrice()
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3SimpleStrategyAbi, signer)
  process.stdout.write(`Withdrawing all from strategy ${strategyAddress}.. `)
  const tx = await strategyContract.withdrawAll(asset.address, {gasPrice,})
  process.stdout.write('tx sent.. ')
  await tx.wait()
  console.log('confirmed.')
}

let lastPrice = BigNumber.from(0)

const namesCache = {}

async function showStrategyTracking(strategyAddress: string) {
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3ResearchStrategyAbi, signer)
  const tracking = await strategyContract.tracking()
  if (!namesCache[strategyAddress]) {
    namesCache[strategyAddress] = await strategyContract.name()
  }

  const periodSecs = parseInt(tracking.period.toString(), 10)
  const periodMins = Math.floor(periodSecs / 60)
  const periodHours = Math.floor(periodMins / 60)
  let periodStr = ''
  if (periodHours) {
    periodStr += `${periodHours}h:`
  }
  periodStr += `${periodMins - periodHours*60}m`

  const assetsAmount = await strategyContract.getEstimatedBalance(asset.address)
  console.log(`${namesCache[strategyAddress]}\tAPR: ${formatUnits(tracking.apr, 2)}%\tPeriod: ${periodStr}, Rebalances: ${tracking.rebalances.toString()}, Earned: ${tracking.earned.toString()}, IL: ${tracking.il.toString()}, RebalanceCost: ${tracking.rebalanceCost.toString()}, Assets: ${formatUnits(assetsAmount, asset.decimals)} USDC.`)
}

async function showPoolPrice(strategyAddress) {
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3SimpleStrategyAbi, signer)
  const price = await strategyContract.getPrice('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270')
  const priceChange = lastPrice.gt(0) ? price.sub(lastPrice).mul(10**10).div(price).div(10**4) : BigNumber.from(0)
  const priceChangeText = !priceChange.eq(0) ? `${priceChange.gt(0) ? '+' : ''}${formatUnits(priceChange, 4)}%` : ''
  lastPrice = price
  console.log(`WMATIC price: ${formatUnits(price, asset.decimals)} ${priceChangeText}`)
}

async function showEstimateBalance(strategyAddress: string) {
  const strategyContract = new ethers.Contract(strategyAddress, uniswapV3SimpleStrategyAbi, signer)
  const b = await strategyContract.getEstimatedBalance(asset.address)
  const price = await strategyContract.getPrice('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270')
  const priceChange = lastPrice.gt(0) ? price.sub(lastPrice).mul(10**10).div(price).div(10**4) : BigNumber.from(0)
  const priceChangeText = !priceChange.eq(0) ? `${priceChange.gt(0) ? '+' : ''}${formatUnits(priceChange, 4)}%` : ''
  lastPrice = price
  console.log(`Estimated assets: ${formatUnits(b, asset.decimals)} USDC. Price: ${formatUnits(price, asset.decimals)} ${priceChangeText}`)
}

async function main() {
  const network = await provider.getNetwork()
  console.log(`Network: ${network.name} [${network.chainId}]`)

  const strategies = [
    '0xda3e33fbc53FC9DB1dB06b4E8d9D97Cd216b4e28', // RESEARCH_1.2_WMATIC-USDC-0.05%_1200_40
    '0xE8c528A94876D4A98C6a052DEB67F56Bc7CccA7C', // RESEARCH_1.2_WMATIC-USDC-0.05%_1800_50
    '0x4BFcfC83316C910FCC72f12d3C305Bba7f249f5D', // RESEARCH_1.2_WMATIC-USDC-0.05%_2400_60
    // '0xE480Ef76af652f8D9558fB911981D01FB8d609f3', // RESEARCH_1.2_WMATIC-USDC-0.05%_1200_30
    // '0xB7165A9BA0bAf0b74a2023Dc8F24a1e3e7085E53', // RESEARCH_1.2_WMATIC-USDC-0.05%_1200-20
  ]


  // await changeTickRange('0xda3e33fbc53FC9DB1dB06b4E8d9D97Cd216b4e28', 1200)
  // await changeRebalanceTickRange('0xda3e33fbc53FC9DB1dB06b4E8d9D97Cd216b4e28', 40)
  // await changeTickRange('0xE8c528A94876D4A98C6a052DEB67F56Bc7CccA7C', 1800)
  // await changeRebalanceTickRange('0xE8c528A94876D4A98C6a052DEB67F56Bc7CccA7C', 40)
  // await changeTickRange('0x4BFcfC83316C910FCC72f12d3C305Bba7f249f5D', 2400)
  // await changeRebalanceTickRange('0x4BFcfC83316C910FCC72f12d3C305Bba7f249f5D', 40)


  // deposits
  /*for (const strategyAddress of strategies) {
    await approveIfNeed(asset.address, strategyAddress, parseUnits('10.005', 6))
    await deposit(asset.address, strategyAddress, parseUnits('10.005', 6))
  }*/


  // withdrawAll
  /*for (const strategyAddress of strategies) {
    await withdrawAll(strategyAddress)
  }*/

  // return


  while (1) {
    console.log('')
    console.log('Uniswap V3 range moving strategy research')
    // await showPoolPrice(strategies[0])
    for (const strategyAddress of strategies) {
      await showStrategyTracking(strategyAddress)
    }
    await sleep(30000);
  }
}

main()

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}