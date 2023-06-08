import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction, DeploymentSubmission } from 'hardhat-deploy/types'
import { Consts } from '../../deploy_constants/constatants'
import { ethers } from 'hardhat'
import ERC4626LinearPoolFactoryABI from '../../scripts/abis/ERC4626LinearPoolFactory.json'
import LinearPool from '../../scripts/abis/LinearPool.json'
import { isContractExist } from '../../deploy_constants/deploy-helpers'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { STMATIC_ADDRESS, ERC4626_LINEAR_POOL_FACTORY_ADDRESS } = await getNamedAccounts()

  if (await isContractExist(hre, 'bbTstMATIC4626LinearPool')) {
    return
  }
  const erc4626 = await deployments.get('tStMatic4626Strict')

  const poolParams = [
    'Balancer Tetu Boosted Pool (stMATIC)',
    'bb-t-stMATIC',
    STMATIC_ADDRESS,
    erc4626.address,
    Consts.BAL_LINEAR_POOL_UPPER_TARGET,
    Consts.BAL_LINEAR_POOL_SWAP_FEE_PERCENTAGE,
    Consts.BAL_DELEGATED_OWNER_ADDRESS,
    Consts.TETU_PROTOCOL_ID
  ]
  const signer = (await ethers.getSigners())[0]
  const factory = new ethers.Contract(ERC4626_LINEAR_POOL_FACTORY_ADDRESS, ERC4626LinearPoolFactoryABI, signer)
  const tx = await factory.create(...poolParams)
  const receipt = await tx.wait()

  // tslint:disable-next-line:no-any
  const poolAddress = receipt.events?.find((e: any) => e.event === 'Erc4626LinearPoolCreated')?.args?.pool
  console.log('bb-t-stMATIC PoolAddress:', poolAddress)

  const deploymentSubmission: DeploymentSubmission = {
    abi: LinearPool,
    address: poolAddress
  }
  await deployments.save('bbTstMATIC4626LinearPool', deploymentSubmission)
}
export default func
func.tags = ['bbTstMATIC4626LinearPool']
func.dependencies = ['tStMatic4626Strict']
func.skip = async () => true
