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

  const rebalancers = [
    '0x47Ada091aB72627AF6a7EAd768aD2e39e085A342',
    '0x9756549A334Bd48423457D057e8EDbFAf2104b16',
    '0xf30d0756053734128849666E01a0a4C04A5603C6',
  ]

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
          args: [rebalancers]
        }
      }
    },
    log: true
  })

}
export default func
func.tags = ['BoostedPoolsRebalanceResolver']
func.dependencies = []
