import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { KyberConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'KyberConverterStrategy', true, {
    StrategyLib: (await deployments.get('StrategyLib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    KyberConverterStrategyLogicLib: (await deployments.get('KyberConverterStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['KyberConverterStrategy'];
func.dependencies = [
  'StrategyLib',
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'KyberConverterStrategyLogicLib',
];
