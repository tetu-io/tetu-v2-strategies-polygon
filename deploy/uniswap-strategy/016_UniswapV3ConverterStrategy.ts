import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { UniswapV3ConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'UniswapV3ConverterStrategy', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    StrategyLib2: (await deployments.get('StrategyLib2')).address,
    UniswapV3ConverterStrategyLogicLib: (await deployments.get('UniswapV3ConverterStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['UniswapV3ConverterStrategy'];
func.dependencies = [
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'StrategyLib2',
  'UniswapV3ConverterStrategyLogicLib',
  'PairBasedStrategyLib',
  'PairBasedStrategyLogicLib',
];
func.skip = async hre => (await hre.getChainId()) === '1101'