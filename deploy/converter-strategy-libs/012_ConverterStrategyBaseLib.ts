import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'ConverterStrategyBaseLib', true, {
    IterationPlanLib: (await deployments.get('IterationPlanLib')).address,
  });
  await hardhatDeploy(hre, 'ConverterStrategyBaseLib2', true, {
    StrategyLib: (await deployments.get('StrategyLib')).address,
  });
  await hardhatDeploy(hre, 'BorrowLib', true, {
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
  });
};
export default func;
func.tags = ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'BorrowLib'];
func.dependencies = ['StrategyLib', 'IterationPlanLib',]
