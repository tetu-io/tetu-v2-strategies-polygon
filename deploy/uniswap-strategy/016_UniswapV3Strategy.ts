import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { UniswapV3ConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'UniswapV3ConverterStrategy', true, {
    StrategyLib: (await deployments.get('StrategyLib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    UniswapV3ConverterStrategyLogicLib: (await deployments.get('UniswapV3ConverterStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['UniswapV3ConverterStrategy'];
func.dependencies = [
  'StrategyLib',
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'UniswapV3ConverterStrategyLogicLib',
];
