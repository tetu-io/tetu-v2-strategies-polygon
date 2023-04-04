import { ethers } from 'hardhat'
import { IBalancerBoostedAavePool } from '../../../typechain'


async function main() {

  const WMATIC_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
  const ST_MATIC_ADDRESS = '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4'

  const WMATIC_BIG_HOLDER_ADDRESS = '0xfffbcd322ceace527c8ec6da8de2461c6d9d4e6e'
  const ST_MATIC_BIG_HOLDER_ADDRESS = '0x8915814e90022093099854babd3ea9ac67d25565'

  const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
  const WMATIC_LINEAR_POOL_ADDRESS = '0x52Cc8389C6B93d740325729Cc7c958066CEE4262'

  const T_ST_MATIC_LINEAR_POOL_ADDRESS = '0x4739E50B59B552D490d3FDc60D200977A38510c0'
  const BB_T_MATIC_ADDRESS = '0x71BD10C2a590b5858f5576550c163976A48Af906'
  const REF_MATIC_POOL_ADDRESS = '0x8159462d255C1D24915CB51ec361F700174cD994'

  const wmaticLinearPool = await ethers.getContractAt('IBalancerBoostedAavePool', WMATIC_LINEAR_POOL_ADDRESS)
  const stMaticLinearPool = await ethers.getContractAt('IBalancerBoostedAavePool', T_ST_MATIC_LINEAR_POOL_ADDRESS)
  const bbtMaticPool = await ethers.getContractAt('IBalancerBoostedAavePool', BB_T_MATIC_ADDRESS) as IBalancerBoostedAavePool
  const refMaticPool = await ethers.getContractAt('IBalancerBoostedAavePool', REF_MATIC_POOL_ADDRESS) as IBalancerBoostedAavePool

  const signer = (await ethers.getSigners())[0]


  console.log('=== TESTS ===')


  const wmatic = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', WMATIC_ADDRESS)
  let impersonatedSigner = await ethers.getImpersonatedSigner(WMATIC_BIG_HOLDER_ADDRESS)
  await wmatic.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('100000'))
  await wmatic.connect(signer)

  const stMatic = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', ST_MATIC_ADDRESS)
  impersonatedSigner = await ethers.getImpersonatedSigner(ST_MATIC_BIG_HOLDER_ADDRESS)
  await stMatic.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('100000'))
  await stMatic.connect(signer)

  const vault = await ethers.getContractAt('IBVault', BALANCER_VAULT_ADDRESS)
  await wmatic.approve(vault.address, ethers.utils.parseUnits('100000'))
  await stMatic.approve(vault.address, ethers.utils.parseUnits('100000'))


  console.log('swap 1 (WMATIC -> bb-t-WMATIC) join pool')
  await vault.swap(
    {
      poolId: await wmaticLinearPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: wmatic.address,
      assetOut: wmaticLinearPool.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('90000')
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
  console.log(`Signer BPT balance: ${await wmaticLinearPool.balanceOf(signer.address)}`)

  console.log('swap 2 (stMATIC -> bb-t-stMATIC) join pool')
  await vault.swap(
    {
      poolId: await stMaticLinearPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: stMatic.address,
      assetOut: stMaticLinearPool.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('90000')
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
  console.log(`Signer BPT balance: ${await stMaticLinearPool.balanceOf(signer.address)}`)
  console.log(`bb-t-matic Pool token rate ${await bbtMaticPool.getRate()}`)
  // add more liquidity to bb-t-WMATIC pool
  // -------- 1 --------

  await vault.swap(
    {
      poolId: await bbtMaticPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: wmaticLinearPool.address,
      assetOut: bbtMaticPool.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('80000')
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

  await vault.swap(
    {
      poolId: await bbtMaticPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: stMaticLinearPool.address,
      assetOut: bbtMaticPool.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('80000')
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

  console.log(`bb-t-matic Pool token rate ${await bbtMaticPool.getRate()}`)
  console.log(`ref Pool token rate ${await refMaticPool.getRate()}`)

  const wmaticBefore1 = await wmaticLinearPool.balanceOf(signer.address)
  const stMaticBefore1 = await stMaticLinearPool.balanceOf(signer.address)

  console.log('swap 4 (tSTMatic -> tWMATIC ) join pool')
  await vault.swap(
    {
      poolId: await bbtMaticPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: stMaticLinearPool.address,
      assetOut: wmaticLinearPool.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('10')
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

  const wmaticAfter1 = await wmaticLinearPool.balanceOf(signer.address)
  const stMaticAfter1 = await stMaticLinearPool.balanceOf(signer.address)

  console.log(`Signer tWMATIC balance diff: ${wmaticAfter1 - wmaticBefore1}`)
  console.log(`Signer tSTMATIC balance diff : ${stMaticAfter1 - stMaticBefore1}`)
  console.log(`rate: ${(wmaticAfter1 - wmaticBefore1) / (stMaticAfter1 - stMaticBefore1)}`)


  const wmaticBefore2 = await wmatic.balanceOf(signer.address)
  const stMaticBefore2 = await stMatic.balanceOf(signer.address)

  console.log('swap 5 (tSTMatic -> tWMATIC ) join pool')
  await vault.swap(
    {
      poolId: '0x8159462d255c1d24915cb51ec361f700174cd99400000000000000000000075d', // existing pool
      kind: 0, // GIVEN_IN
      assetIn: stMatic.address,
      assetOut: wmatic.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('10')
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

  const wmaticAfter2 = await wmatic.balanceOf(signer.address)
  const stMaticAfter2 = await stMatic.balanceOf(signer.address)

  console.log(`Signer WMATIC balance diff: ${wmaticAfter2 - wmaticBefore2}`)
  console.log(`Signer stMATIC balance diff : ${stMaticAfter2 - stMaticBefore2}`)
  console.log(`rate: ${(wmaticAfter2 - wmaticBefore2) / (stMaticAfter2 - stMaticBefore2)}`)

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
