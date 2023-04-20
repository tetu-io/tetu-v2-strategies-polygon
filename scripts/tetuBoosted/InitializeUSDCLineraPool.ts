import { ethers } from 'hardhat';
import LinearPoolABI from '../abis/LinearPool.json';
import BalancerVaultABI from '../abis/BalancerVault.json';

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
const USDC_LINEAR_POOL_ADDRESS = "0xae646817e458C0bE890b81e8d880206710E3c44e"
const BALANCER_VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
const USDC_4626_ADDRESS = "0x113f3D54C31EBC71510FD664c8303B34fBc2B355"

async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)

  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS)
  console.log(`signer USDC balance is ${await usdc.balanceOf(signer.address)}`)
  const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer)
  await usdc.approve(vault.address, ethers.utils.parseUnits("100", 6))
  const tUsdPool = await ethers.getContractAt("ERC4626Strict", USDC_4626_ADDRESS)
  await usdc.approve(tUsdPool.address, ethers.utils.parseUnits("100", 6))
  await tUsdPool.deposit(ethers.utils.parseUnits("5", 6), signer.address)
  console.log(`tUsdc4626Strict balance is ${await tUsdPool.balanceOf(signer.address)}`)
  await tUsdPool.approve(vault.address, ethers.utils.parseUnits("100", 18))

  const usdcLinerPool = new ethers.Contract(USDC_LINEAR_POOL_ADDRESS, LinearPoolABI, signer)
  console.log("swap 1 (USDC -> bb-t-USDC) join pool")
  await vault.swap(
    {
      poolId: await usdcLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: USDC_ADDRESS,
      assetOut: USDC_LINEAR_POOL_ADDRESS,
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

  console.log(`Signer BPT balance: ${await usdcLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await usdc.balanceOf(signer.address)}`)
  console.log("swap 2 (tUSDC -> bb-t-USDC) join pool")
  await vault.swap(
    {
      poolId: await usdcLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: tUsdPool.address,
      assetOut: USDC_LINEAR_POOL_ADDRESS,
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

  console.log(`Signer BPT balance: ${await usdcLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await usdc.balanceOf(signer.address)}`)

  // console.log("swap 3 (USDC -> tUSDC)")
  // await vault.swap(
  //   {
  //     poolId: await usdcLinerPool.getPoolId(),
  //     kind: 0, // GIVEN_IN
  //     assetIn: tUsdPool.address,
  //     assetOut: USDC_ADDRESS,
  //     userData: "0x",
  //     amount: ethers.utils.parseUnits("10", 6)
  //   },
  //   {
  //     sender: signer.address,
  //     fromInternalBalance: false,
  //     toInternalBalance: false,
  //     recipient: signer.address
  //   },
  //   1,
  //   Date.now() + 1000
  // )

  console.log(`Signer BPT balance: ${await usdcLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await usdc.balanceOf(signer.address)}`)

  const poolTokens = await vault.getPoolTokens(await usdcLinerPool.getPoolId())
  const t0 = await ethers.getContractAt("IERC20Metadata", poolTokens.tokens[0])
  const t1 = await ethers.getContractAt("IERC20Metadata", poolTokens.tokens[1])
  const t2 = await ethers.getContractAt("IERC20Metadata", poolTokens.tokens[2])
  console.log(`t0: ${await t0.symbol()}`)
  console.log(`t1: ${await t1.symbol()}`)
  console.log(`t2: ${await t2.symbol()}`)

  const poolId = await usdcLinerPool.getPoolId()
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
