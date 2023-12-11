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
    'RebalanceResolver_Kyber_UsdcDai',
    [(await deployments.get('Strategy_KyberConverterStrategy_UsdcDai')).address],
    true
  )
};
export default func;
func.tags = ['RebalanceResolver_Kyber_UsdcDai'];
func.dependencies = ['Strategy_KyberConverterStrategy_UsdcDai'];
func.skip = async hre => true // (await hre.getChainId()) !== '137'
