import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'UniswapV3ConverterStrategyLogicLib', true, {
    UniswapV3Lib: (await deployments.get('UniswapV3Lib')).address,
    UniswapV3DebtLib: (await deployments.get('UniswapV3DebtLib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    // ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
  });
};
export default func;
func.tags = ['UniswapV3ConverterStrategyLogicLib'];
func.dependencies = ['UniswapV3Lib', 'ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'UniswapV3DebtLib'];
