import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'PairBasedStrategyLib', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    IterationPlanLib: (await deployments.get('IterationPlanLib')).address,
  });
  await hardhatDeploy(hre, 'PairBasedStrategyLogicLib', true, {
    BorrowLib: (await deployments.get('BorrowLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
    StrategyLib2: (await deployments.get('StrategyLib2')).address,
  });
};
export default func;
func.tags = ['PairBasedStrategyLib', 'PairBasedStrategyLogicLib'];
func.dependencies = ['ConverterStrategyBaseLib', 'IterationPlanLib', 'ConverterStrategyBaseLib2', 'StrategyLib2',]
