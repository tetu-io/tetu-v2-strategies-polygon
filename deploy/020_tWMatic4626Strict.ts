import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Consts } from '../deploy_constants/constatants'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer, WMATIC_ADDRESS } = await getNamedAccounts()
  const strategy = await deployments.get('tWMaticStrategy')

  await deploy('tWMatic4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [WMATIC_ADDRESS, 'tWMATIC', 'tWMATIC', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true
  })

}
export default func
func.tags = ['tWMatic4626Strict']
func.dependencies = ['tWMaticStrategy']
