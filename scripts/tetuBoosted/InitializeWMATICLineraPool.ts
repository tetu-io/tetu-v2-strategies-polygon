import { ethers } from 'hardhat'
import LinearPoolABI from '../abis/LinearPool.json'
import BalancerVaultABI from '../abis/BalancerVault.json'

const WMATIC_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
const WMATIC_LINEAR_POOL_ADDRESS = '0x52Cc8389C6B93d740325729Cc7c958066CEE4262'

const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'

async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)
  const gasPrice = (await ethers.provider.getGasPrice()).toNumber()
  const wmatic = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', WMATIC_ADDRESS)
  console.log(`signer WMATIC balance is ${await wmatic.balanceOf(signer.address)}`)
  const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer)
  let tx = await wmatic.approve(vault.address, ethers.utils.parseUnits('100', 18), {
    maxPriorityFeePerGas: (gasPrice * 1.5).toFixed(0),
    maxFeePerGas: (gasPrice * 1.5).toFixed(0)
  })
  console.log(`tx hash: ${tx.hash}`)
  await tx.wait()

  const wmaticLinerPool = new ethers.Contract(WMATIC_LINEAR_POOL_ADDRESS, LinearPoolABI, signer)
  console.log('swap 1 (WMATIC -> bb-t-WMATIC) join pool')
  const nonce = await ethers.provider.getSigner(0).getTransactionCount()
  console.log(`nonce: ${nonce}`)
  tx = await vault.swap(
    {
      poolId: await wmaticLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: WMATIC_ADDRESS,
      assetOut: WMATIC_LINEAR_POOL_ADDRESS,
      userData: '0x',
      amount: ethers.utils.parseUnits('5', 18)
    },
    {
      sender: signer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: signer.address
    },
    1,
    Date.now() + 1000,
    {
      maxPriorityFeePerGas: (gasPrice * 1.5).toFixed(0),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0)
    }
  )
  console.log(`tx hash: ${tx.hash}`)
  await tx.wait()


  console.log(`Signer BPT balance: ${await wmaticLinerPool.balanceOf(signer.address)}`)
  console.log(`Signer USDC balance: ${await wmatic.balanceOf(signer.address)}`)

  const poolTokens = await vault.getPoolTokens(await wmaticLinerPool.getPoolId())
  const t0 = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata', poolTokens.tokens[0])
  const t1 = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata', poolTokens.tokens[1])
  const t2 = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata', poolTokens.tokens[2])
  console.log(`t0: ${await t0.symbol()}`)
  console.log(`t1: ${await t1.symbol()}`)
  console.log(`t2: ${await t2.symbol()}`)

  const poolId = await wmaticLinerPool.getPoolId()
  console.log(`pool tokens: ${poolTokens} `)
  console.log(`pool info t0: ${await vault.getPoolTokenInfo(poolId, t0.address)} `)
  console.log(`pool info t1: ${await vault.getPoolTokenInfo(poolId, t1.address)} `)
  console.log(`pool info t2: ${await vault.getPoolTokenInfo(poolId, t2.address)} `)

  console.log('Done ')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
