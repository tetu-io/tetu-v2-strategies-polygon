import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'KyberDebtLib', true, {
    KyberLib: (await deployments.get('KyberLib')).address,
    ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
  });
};
export default func;
func.tags = ['KyberDebtLib'];
func.dependencies = ['KyberLib', 'ConverterStrategyBaseLib', 'ConverterStrategyBaseLi2'];
