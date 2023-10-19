import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'AlgebraConverterStrategyLogicLib', true, {
    AlgebraLib: (await deployments.get('AlgebraLib')).address,
    AlgebraDebtLib: (await deployments.get('AlgebraDebtLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
  });
};
export default func;
func.tags = ['AlgebraConverterStrategyLogicLib'];
func.dependencies = ['AlgebraLib', 'AlgebraDebtLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLogicLib'];
