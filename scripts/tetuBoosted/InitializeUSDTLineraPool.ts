import { ethers } from 'hardhat';
import LinearPoolABI from '../abis/LinearPool.json';
import BalancerVaultABI from '../abis/BalancerVault.json';

const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"
const USDT_LINEAR_POOL_ADDRESS = "0x7c82A23B4C48D796dee36A9cA215b641C6a8709d"
const USDT_4626_ADDRESS = "0x236975DA9f0761e9CF3c2B0F705d705e22829886"

const BALANCER_VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"

async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)

  const usdt = await ethers.getContractAt("IERC20", USDT_ADDRESS)
  console.log(`signer USDT balance is ${await usdt.balanceOf(signer.address)}`)
  const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer)

  await usdt.approve(vault.address, ethers.utils.parseUnits("100", 6))
  //
  const tUSDTPool = await ethers.getContractAt("ERC4626Strict", USDT_4626_ADDRESS)
  await usdt.approve(tUSDTPool.address, ethers.utils.parseUnits("100", 6))
  await tUSDTPool.deposit(ethers.utils.parseUnits("5", 6), signer.address)
  console.log(`tUSDT4626Strict balance is ${await tUSDTPool.balanceOf(signer.address)}`)
  await tUSDTPool.approve(vault.address, ethers.utils.parseUnits("100", 6))


  //
  const usdtLinerPool = new ethers.Contract(USDT_LINEAR_POOL_ADDRESS, LinearPoolABI, signer)
  console.log("swap 1 (ustd -> bb-t-USDT) join pool")
  let tx = await vault.swap(
    {
      poolId: await usdtLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: USDT_ADDRESS,
      assetOut: USDT_LINEAR_POOL_ADDRESS,
      userData: "0x",
      amount: ethers.utils.parseUnits("5", 6)
    },
    {
      sender: signer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: signer.address
    },
    1,
    Date.now() + 1000
  )
  console.log("Transacton hash = ", tx.hash);
  tx.wait();

  console.log(`Signer BPT balance: ${await usdtLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await usdt.balanceOf(signer.address)}`)
  console.log("swap 2 (tUSDT -> bb-t-USDT) join pool")


  tx = await vault.swap(
    {
      poolId: await usdtLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: tUSDTPool.address,
      assetOut: USDT_LINEAR_POOL_ADDRESS,
      userData: "0x",
      amount: ethers.utils.parseUnits("5", 6)
    },
    {
      sender: signer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: signer.address
    },
    1,
    Date.now() + 1000
  )
  console.log("Transacton hash = ", tx.hash);
  tx.wait();

  console.log(`Signer BPT balance: ${await usdtLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await usdt.balanceOf(signer.address)}`)

  console.log(`Signer BPT balance: ${await usdtLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await usdt.balanceOf(signer.address)}`)

  const poolTokens = await vault.getPoolTokens(await usdtLinerPool.getPoolId())
  const t0 = await ethers.getContractAt("IERC20Metadata", poolTokens.tokens[0])
  const t1 = await ethers.getContractAt("IERC20Metadata", poolTokens.tokens[1])
  const t2 = await ethers.getContractAt("IERC20Metadata", poolTokens.tokens[2])
  console.log(`t0: ${await t0.symbol()}`)
  console.log(`t1: ${await t1.symbol()}`)
  console.log(`t2: ${await t2.symbol()}`)

  const poolId = await usdtLinerPool.getPoolId()
  console.log(`pool tokens: ${poolTokens} `)
  console.log(`pool info t0: ${await vault.getPoolTokenInfo(poolId, t0.address)} `)
  console.log(`pool info t1: ${await vault.getPoolTokenInfo(poolId, t1.address)} `)
  console.log(`pool info t2: ${await vault.getPoolTokenInfo(poolId, t2.address)} `)

  console.log("Done ")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
