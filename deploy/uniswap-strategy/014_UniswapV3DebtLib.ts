import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'UniswapV3DebtLib', true, {
    UniswapV3Lib: (await deployments.get('UniswapV3Lib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
  });
};
export default func;
func.tags = ['UniswapV3DebtLib'];
func.dependencies = ['UniswapV3Lib', 'ConverterStrategyBaseLib'];
