import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { isContractExist } from '../deploy_constants/deploy-helpers'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()


  if (await isContractExist(hre, 'BoostedPoolsRebalanceResolver')) {
    return
  }

  const TETU_NOMINATOR = '500' // 50% from the target
  const rebalancerWithExtraMain = await deployments.get('RebalancerWithExtraMain')

  await deploy('BoostedPoolsRebalanceResolver', {
    contract: 'BoostedPoolsRebalanceResolver',
    from: deployer,
    args: [],
    proxy: {
      owner: deployer,
      proxyContract: 'OpenZeppelinTransparentProxy',
      execute: {
        init: {
          methodName: 'initialize',
          args: [rebalancerWithExtraMain.address, TETU_NOMINATOR]
        }
      }
    },
    log: true
  })

}
export default func
func.tags = ['BoostedPoolsRebalanceResolver']
func.dependencies = ['RebalancerWithExtraMain']