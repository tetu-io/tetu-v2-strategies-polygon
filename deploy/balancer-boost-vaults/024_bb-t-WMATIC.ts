import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction, DeploymentSubmission } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'
import ERC4626LinearPoolFactoryABI from '../../scripts/abis/ERC4626LinearPoolFactory.json'
import LinearPool from '../../scripts/abis/LinearPool.json'
import { Consts } from '../../deploy_constants/constatants'
import { isContractExist } from '../../deploy_constants/deploy-helpers'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { WMATIC_ADDRESS, ERC4626_LINEAR_POOL_FACTORY_ADDRESS } = await getNamedAccounts()

  if (await isContractExist(hre, 'bbTWMATIC4626LinearPool')) {
    return
  }

  const erc4626 = await deployments.get('tWMatic4626Strict')

  const wmaticPoolParams = [
    'Balancer Tetu Boosted Pool (WMATIC)',
    'bb-t-WMATIC',
    WMATIC_ADDRESS,
    erc4626.address,
    Consts.BAL_LINEAR_POOL_UPPER_TARGET,
    Consts.BAL_LINEAR_POOL_SWAP_FEE_PERCENTAGE,
    Consts.BAL_DELEGATED_OWNER_ADDRESS,
    Consts.TETU_PROTOCOL_ID
  ]
  const signer = (await ethers.getSigners())[0]
  const factory = new ethers.Contract(ERC4626_LINEAR_POOL_FACTORY_ADDRESS, ERC4626LinearPoolFactoryABI, signer)
  const tx = await factory.create(...wmaticPoolParams)
  const receipt = await tx.wait()

  // tslint:disable-next-line:no-any
  const poolAddress = receipt.events?.find((e: any) => e.event === 'Erc4626LinearPoolCreated')?.args?.pool
  console.log('bb-t-WMATIC PoolAddress:', poolAddress)

  const deploymentSubmission: DeploymentSubmission = {
    abi: LinearPool,
    address: poolAddress
  }
  await deployments.save('bbTWMATIC4626LinearPool', deploymentSubmission)
}
export default func
func.tags = ['bbTWMATIC4626LinearPool']
func.dependencies = ['tWMatic4626Strict']
func.skip = async () => true
