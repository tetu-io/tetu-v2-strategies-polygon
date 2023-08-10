import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { AlgebraConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'AlgebraConverterStrategy', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    StrategyLib2: (await deployments.get('StrategyLib2')).address,
    AlgebraConverterStrategyLogicLib: (await deployments.get('AlgebraConverterStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['AlgebraConverterStrategy'];
func.dependencies = [
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'StrategyLib2',
  'AlgebraConverterStrategyLogicLib',
  'PairBasedStrategyLib',
  'PairBasedStrategyLogicLib',
];
