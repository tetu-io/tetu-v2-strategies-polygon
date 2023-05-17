import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  await hardhatDeploy(hre, 'ConverterStrategyBaseLib', true);
  await hardhatDeploy(hre, 'ConverterStrategyBaseLib2', true);
};
export default func;
func.tags = ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2'];
