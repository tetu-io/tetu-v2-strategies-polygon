import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'KyberConverterStrategyLogicLib', true, {
    KyberLib: (await deployments.get('KyberLib')).address,
    KyberDebtLib: (await deployments.get('KyberDebtLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
  });
};
export default func;
func.tags = ['KyberConverterStrategyLogicLib'];
func.dependencies = ['KyberLib', 'KyberDebtLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLogicLib', ];
