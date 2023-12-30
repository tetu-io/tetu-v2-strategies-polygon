import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(hre, 'PancakeConverterStrategyLogicLib', true, {
    PancakeLib: (await deployments.get('PancakeLib')).address,
    PancakeDebtLib: (await deployments.get('PancakeDebtLib')).address,
    ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
    PairBasedStrategyLogicLib: (await deployments.get('PairBasedStrategyLogicLib')).address,
    PairBasedStrategyLib: (await deployments.get('PairBasedStrategyLib')).address,
  });
};
export default func;
func.tags = ['PancakeConverterStrategyLogicLib'];
func.dependencies = ['PancakeLib', 'PancakeDebtLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLogicLib'];
func.skip = async hre => (await hre.getChainId()) !== '1101' && (await hre.getChainId()) !== '8453';
