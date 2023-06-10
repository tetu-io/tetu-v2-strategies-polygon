import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { AlgebraConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'AlgebraConverterStrategy', true, {
    StrategyLib: (await deployments.get('StrategyLib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    AlgebraConverterStrategyLogicLib: (await deployments.get('AlgebraConverterStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['AlgebraConverterStrategy'];
func.dependencies = [
  'StrategyLib',
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'AlgebraConverterStrategyLogicLib',
];
