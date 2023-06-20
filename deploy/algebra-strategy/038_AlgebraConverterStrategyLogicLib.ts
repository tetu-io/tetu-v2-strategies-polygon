import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'AlgebraConverterStrategyLogicLib', true, {
    AlgebraLib: (await deployments.get('AlgebraLib')).address,
    AlgebraDebtLib: (await deployments.get('AlgebraDebtLib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    // ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
  });
};
export default func;
func.tags = ['AlgebraConverterStrategyLogicLib'];
func.dependencies = ['AlgebraLib', 'ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'AlgebraDebtLib'];
