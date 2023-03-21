import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { isContractExist } from '../deploy_constants/deploy-helpers'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { execute } = deployments
  const { deployer } = await getNamedAccounts()
  if (await isContractExist(hre, 'tWMaticStrategy')) {
    return
  }
  const erc4626 = await deployments.get('tWMatic4626Strict')
  await execute('tWMaticStrategy', { from: deployer, log: true }, 'init', erc4626.address)

}
export default func
func.tags = ['tWMatic4626Strict']
module.exports.runAtTheEnd = true
