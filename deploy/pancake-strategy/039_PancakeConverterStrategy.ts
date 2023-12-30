import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'PancakeConverterStrategy', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    StrategyLib2: (await deployments.get('StrategyLib2')).address,
    PancakeConverterStrategyLogicLib: (await deployments.get('PancakeConverterStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['PancakeConverterStrategy'];
func.dependencies = [
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'StrategyLib2',
  'PancakeConverterStrategyLogicLib',
  'PairBasedStrategyLib',
  'PairBasedStrategyLogicLib',
];
func.skip = async hre => (await hre.getChainId()) !== '1101' && (await hre.getChainId()) !== '8453';
