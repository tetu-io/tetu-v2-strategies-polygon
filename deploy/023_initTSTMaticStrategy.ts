import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { execute } = deployments
  const { deployer } = await getNamedAccounts()
  const erc4626 = await deployments.get('tStMatic4626Strict')
  await execute('tStMaticStrategy', { from: deployer, log: true }, 'init', erc4626.address)

}
export default func
func.tags = ['tStMatic4626Strict']
module.exports.runAtTheEnd = true
