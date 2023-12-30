import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'KyberDebtLib', true, {
    KyberLib: (await deployments.get('KyberLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    BorrowLib: (await deployments.get('BorrowLib')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
  });
};
export default func;
func.tags = ['KyberDebtLib'];
func.dependencies = ['KyberLib', 'ConverterStrategyBaseLib2', 'BorrowLib', 'PairBasedStrategyLogicLib'];
func.skip = async hre => true // (await hre.getChainId()) !== '137'
