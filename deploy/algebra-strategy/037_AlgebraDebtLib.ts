import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'AlgebraDebtLib', true, {
    AlgebraLib: (await deployments.get('AlgebraLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    BorrowLib: (await deployments.get('BorrowLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['AlgebraDebtLib'];
func.dependencies = ['AlgebraLib', 'ConverterStrategyBaseLib2', 'BorrowLib', 'PairBasedStrategyLogicLib',];
func.skip = async () => true
