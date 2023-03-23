import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction, DeploymentSubmission } from 'hardhat-deploy/types'
import { Consts } from '../deploy_constants/constatants'
import { ethers } from 'hardhat'
import ComposableStablePoolFactoryABI from '../scripts/abis/ComposableStablePoolFactory.json'
import ComposableStablePoolABI from '../scripts/abis/ComposableStablePool.json'
import LinearPoolABI from '../scripts/abis/LinearPool.json'
import BalancerVaultABI from '../scripts/abis/BalancerVault.json'
import { expect } from 'chai'
import LinearPoolRebalancerABI from '../scripts/abis/LinearPoolRebalancer.json'
import { isContractExist } from '../deploy_constants/deploy-helpers'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { COMPOSABLE_STABLE_POOL_FACTORY_ADDRESS } = await getNamedAccounts()

  if (await isContractExist(hre, 'bbTMaticComposablePool')) {
    return
  }

  const wmaticLinearPool = await deployments.get('bbTWMATIC4626LinearPool')
  const stMaticLinearPool = await deployments.get('bbTstMATIC4626LinearPool')

  const tWmaticStrategy = await deployments.get('tWMaticStrategy')
  const tStMaticStrategy = await deployments.get('tStMaticStrategy')

  const poolData = [
    { pool: wmaticLinearPool.address, strategy: tWmaticStrategy.address },
    { pool: stMaticLinearPool.address, strategy: tStMaticStrategy.address }
  ]

  poolData.sort((a, b) => a.pool.localeCompare(b.pool))

  const poolParams = [
    'Balancer Tetu Boosted MATIC Pool',
    'bb-t-MATIC',
    poolData.map(p => p.pool),
    '2000', // amplificationParameter
    poolData.map(p => p.strategy), // strategy implements IRatesProvider interface
    ['21600', '21600'], // tokenRateCacheDurations
    [false, false], // exemptFromYieldProtocolFeeFlags
    '100000000000000', // swapFeePercentage
    Consts.BAL_DELEGATED_OWNER_ADDRESS
  ]

  const signer = (await ethers.getSigners())[0]
  const factory = new ethers.Contract(COMPOSABLE_STABLE_POOL_FACTORY_ADDRESS, ComposableStablePoolFactoryABI, signer)
  const tx = await factory.create(...poolParams)
  const receipt = await tx.wait()

  // tslint:disable-next-line:no-any
  const poolAddress = receipt.events?.find((e: any) => e.event === 'PoolCreated')?.args?.pool
  console.log('bb-t-MATIC PoolAddress:', poolAddress)

  const deploymentSubmission: DeploymentSubmission = {
    abi: ComposableStablePoolABI,
    address: poolAddress
  }
  await deployments.save('bbTMaticComposablePool', deploymentSubmission)


  if (hre.network.name === 'hardhat') {
    console.log('=== TESTS ===')

    const WMATIC_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
    const WMATIC_BIG_HOLDER_ADDRESS = '0xfffbcd322ceace527c8ec6da8de2461c6d9d4e6e'
    const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'

    const wmatic = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', WMATIC_ADDRESS)
    const impersonatedSigner = await ethers.getImpersonatedSigner(WMATIC_BIG_HOLDER_ADDRESS)
    await wmatic.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('100000'))
    await wmatic.connect(signer)
    console.log(`signer WMATIC balance is ${await wmatic.balanceOf(signer.address)}`)
    const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer)
    await wmatic.approve(vault.address, ethers.utils.parseUnits('100000'))

    // whitelist strategy
    const TETU_V1_CONTROLLER_ADDRESS = '0x6678814c273d5088114B6E40cC49C8DB04F9bC29'
    const controller = await ethers.getContractAt('ITetuV1Controller', TETU_V1_CONTROLLER_ADDRESS)
    await signer.sendTransaction({ to: await controller.governance(), value: ethers.utils.parseEther('10') })
    const impersonatedGovernance = await ethers.getImpersonatedSigner(await controller.governance())
    await controller.connect(impersonatedGovernance).changeWhiteListStatus([tWmaticStrategy.address], true)

    const depositAmount = ethers.utils.parseUnits('50000')
    const tWmatic = await deployments.get('tWMatic4626Strict')
    const tWmaticPool = await ethers.getContractAt('ERC4626Strict', tWmatic.address)
    await wmatic.approve(tWmaticPool.address, depositAmount)
    await tWmaticPool.deposit(depositAmount, signer.address)
    expect(await tWmaticPool.balanceOf(signer.address)).to.be.equal(depositAmount)
    await tWmaticPool.approve(vault.address, depositAmount.mul(2))

    const linerPool = new ethers.Contract(wmaticLinearPool.address, LinearPoolABI, signer)

    console.log('swap 1 (WMATIC -> bb-t-WMATIC) join pool')
    await vault.swap(
      {
        poolId: await linerPool.getPoolId(),
        kind: 0, // GIVEN_IN
        assetIn: WMATIC_ADDRESS,
        assetOut: wmaticLinearPool.address,
        userData: '0x',
        amount: ethers.utils.parseUnits('40000')
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
    console.log(`Signer BPT balance: ${await linerPool.balanceOf(signer.address)}`)
    console.log(`Signer WMATIC balance: ${await wmatic.balanceOf(signer.address)}`)

    // rebalance test
    const tokenInfo = await vault.getPoolTokenInfo(await linerPool.getPoolId(), wmatic.address)
    const rebalancer = new ethers.Contract(tokenInfo.assetManager, LinearPoolRebalancerABI, signer)

    await wmatic.approve(rebalancer.address, depositAmount)
    await rebalancer.rebalanceWithExtraMain(signer.address, '5000000')
    expect((await vault.getPoolTokenInfo(await linerPool.getPoolId(), wmatic.address)).cash).to.be.equal(ethers.utils.parseUnits('25000'))

    console.log('swap 2 (tWMATIC -> bb-t-WMATIC) join pool')
    await vault.swap(
      {
        poolId: await linerPool.getPoolId(),
        kind: 0, // GIVEN_IN
        assetIn: tWmaticPool.address,
        assetOut: wmaticLinearPool.address,
        userData: '0x',
        amount: depositAmount
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

    const poolTokens = await vault.getPoolTokens(await linerPool.getPoolId())
    const t0 = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata', poolTokens.tokens[0])
    const t1 = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata', poolTokens.tokens[1])
    const t2 = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata', poolTokens.tokens[2])
    console.log(`t0: ${await t0.symbol()}`)
    console.log(`t1: ${await t1.symbol()}`)
    console.log(`t2: ${await t2.symbol()}`)

    const poolId = await linerPool.getPoolId()
    console.log(`pool tokens: ${poolTokens} `)
    console.log(`pool info t0: ${await vault.getPoolTokenInfo(poolId, t0.address)} `)
    console.log(`pool info t1: ${await vault.getPoolTokenInfo(poolId, t1.address)} `)
    console.log(`pool info t2: ${await vault.getPoolTokenInfo(poolId, t2.address)} `)
  }
}
export default func
func.tags = ['bbTMaticComposablePool']
func.dependencies = ['bbTWMATIC4626LinearPool', 'bbTstMATIC4626LinearPool']
