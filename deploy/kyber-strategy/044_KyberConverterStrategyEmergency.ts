import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { KyberConverterStrategy } from '../../typechain';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'KyberConverterStrategyEmergency', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    StrategyLib2: (await deployments.get('StrategyLib2')).address,
    KyberConverterStrategyLogicLib: (await deployments.get('KyberConverterStrategyLogicLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['KyberConverterStrategyEmergency'];
func.dependencies = [
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'StrategyLib2',
  'KyberConverterStrategyLogicLib',
  'PairBasedStrategyLogicLib',
];
func.skip = async hre => (await hre.getChainId()) !== '137'
