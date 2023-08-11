import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { KyberConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'KyberConverterStrategy', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    StrategyLib2: (await deployments.get('StrategyLib2')).address,
    KyberConverterStrategyLogicLib: (await deployments.get('KyberConverterStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['KyberConverterStrategy'];
func.dependencies = [
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'StrategyLib2',
  'KyberConverterStrategyLogicLib',
  'PairBasedStrategyLib',
  'PairBasedStrategyLogicLib',
];
func.skip = async () => true
