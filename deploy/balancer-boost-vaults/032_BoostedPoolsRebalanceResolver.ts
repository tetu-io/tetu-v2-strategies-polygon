import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { isContractExist } from '../../deploy_constants/deploy-helpers'

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()


  if (await isContractExist(hre, 'BoostedPoolsRebalanceResolver')) {
    return
  }

  const rebalancers = [
    '0x47Ada091aB72627AF6a7EAd768aD2e39e085A342', // DAI
    '0x9756549A334Bd48423457D057e8EDbFAf2104b16', // USDC
    '0xf30d0756053734128849666E01a0a4C04A5603C6', // USDT
    '0x65c574A3e3ceae1CB8c9d46d92aE4b32F3f33D3c', // stMATIC
    '0xC9c3bA34aBd888C7Bb68EA1d2f5650965b543Fbc', // MATIC
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
func.skip = async () => true
