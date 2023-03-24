import { ethers } from 'hardhat'
import BalancerVaultABI from '../abis/BalancerVault.json'
import ComposableStablePoolABI from '../abis/ComposableStablePool.json'
import { BigNumber } from 'ethers'

const WMATIC_LINEAR_POOL_ADDRESS = '0x52Cc8389C6B93d740325729Cc7c958066CEE4262'
const STMATIC_LINEAR_POOL_ADDRESS = '0x4739E50B59B552D490d3FDc60D200977A38510c0'
const MATIC_COMPOSABLE_POOL_ADDRESS = '0xF22a66046B5307842F21B311ECB4C462c24C0635'


const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'


async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)
  const gasPrice = (await ethers.provider.getGasPrice()).toNumber()

  const bbtWMATIC = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', WMATIC_LINEAR_POOL_ADDRESS)
  const bbtWMATICBalance = await bbtWMATIC.balanceOf(signer.address)
  console.log('bbtWMATICBalance', bbtWMATICBalance.toString())
  const bbtSTMATIC = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', STMATIC_LINEAR_POOL_ADDRESS)
  const bbtSTMATICBalance = await bbtSTMATIC.balanceOf(signer.address)
  console.log('bbtSTMATICBalance', bbtSTMATICBalance.toString())
  const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer)

  const maticComposablePool = new ethers.Contract(MATIC_COMPOSABLE_POOL_ADDRESS, ComposableStablePoolABI, signer)

  const allTokens = [STMATIC_LINEAR_POOL_ADDRESS, WMATIC_LINEAR_POOL_ADDRESS, MATIC_COMPOSABLE_POOL_ADDRESS]

  const currentBalances = [bbtSTMATICBalance, bbtWMATICBalance, BigNumber.from(0)]
  // not sure why we need to add "519229685853482762853049632900000000" for BPT token.
  // Copied from the boosted aave pool initialization
  const maxBalances = [bbtSTMATICBalance, bbtWMATICBalance, BigNumber.from('519229685853482762853049632900000000')]
  console.log('Current balances', currentBalances)


  console.log('Approoving vault')
  let tx = await bbtWMATIC.approve(BALANCER_VAULT_ADDRESS, bbtWMATICBalance, {
    maxPriorityFeePerGas: (gasPrice * 1.5).toFixed(0),
    maxFeePerGas: (gasPrice * 1.5).toFixed(0)
  })
  console.log('Approoving vault', tx.hash)
  await tx.wait()

  tx = await bbtSTMATIC.approve(BALANCER_VAULT_ADDRESS, bbtSTMATICBalance, {
    maxPriorityFeePerGas: (gasPrice * 1.5).toFixed(0),
    maxFeePerGas: (gasPrice * 1.5).toFixed(0)
  })
  console.log('Approoving vault', tx.hash)
  await tx.wait()
  tx = await maticComposablePool.approve(BALANCER_VAULT_ADDRESS, bbtWMATICBalance, {
    maxPriorityFeePerGas: (gasPrice * 1.5).toFixed(0),
    maxFeePerGas: (gasPrice * 1.5).toFixed(0)
  })
  console.log('Approoving vault', tx.hash)
  await tx.wait()

  console.log(`All tokens ${allTokens}`)
  console.log(`Max balances ${maxBalances}`)

  const JOIN_KIND_INIT = 0
  const initUserData = ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256[]'],
    [JOIN_KIND_INIT, currentBalances]
  )
  const poolId = await maticComposablePool.getPoolId()
  console.log('Pool id', poolId)
  console.log('Join Init vault')
  tx = await vault.joinPool(
    poolId,
    signer.address,
    signer.address,
    {
      assets: allTokens,
      maxAmountsIn: maxBalances,
      userData: initUserData,
      fromInternalBalance: false
    },
    {
      maxPriorityFeePerGas: (gasPrice * 1.5).toFixed(0),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0)
    })

  console.log('Joining pool', tx.hash)
  await tx.wait()
  console.log('Balance after joining', await maticComposablePool.balanceOf(signer.address))

  console.log('Done ')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
