import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(
    hre,
    'RebalanceResolver',
    true,
    undefined,
    'RebalanceResolver_Pancake_DaiUsdbc',
    [(await deployments.get('Strategy_PancakeConverterStrategy_DaiUsdbc')).address],
    true
  )
};
export default func;
func.tags = ['RebalanceResolver_Pancake_DaiUsdbc'];
func.dependencies = ['Strategy_PancakeConverterStrategy_DaiUsdbc'];
func.skip = async hre => (await hre.getChainId()) !== '8453';
