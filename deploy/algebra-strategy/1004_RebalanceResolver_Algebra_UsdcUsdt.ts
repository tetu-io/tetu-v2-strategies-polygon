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
    'RebalanceResolver_Algebra_UsdcUsdt',
    [(await deployments.get('Strategy_AlgebraConverterStrategy_UsdcUsdt')).address],
    true
  )
};
export default func;
func.tags = ['RebalanceResolver_Algebra_UsdcUsdt'];
func.dependencies = ['Strategy_AlgebraConverterStrategy_UsdcUsdt'];
func.skip = async hre => (await hre.getChainId()) !== '137'
