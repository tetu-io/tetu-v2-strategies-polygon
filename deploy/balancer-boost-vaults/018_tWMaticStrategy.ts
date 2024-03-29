import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer, X_MATIC_VAULT_ADDRESS, LIQUIDATOR_ADDRESS, X_TETU_ADDRESS } = await getNamedAccounts()

  await deploy('tWMaticStrategy', {
    contract: 'TetuV1SingleTokenStrictStrategy',
    from: deployer,
    args: [X_MATIC_VAULT_ADDRESS, LIQUIDATOR_ADDRESS, X_TETU_ADDRESS],
    log: true,
    skipIfAlreadyDeployed: true
  })

}
export default func
func.tags = ['tWMaticStrategy']
func.skip = async () => true
