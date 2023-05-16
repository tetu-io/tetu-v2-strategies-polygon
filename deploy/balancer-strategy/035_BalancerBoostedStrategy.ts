import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { BalancerBoostedStrategy } from '../../typechain';
import { txParams } from '../../deploy_constants/deploy-helpers';
import { ethers } from 'hardhat';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  await deployments.deploy('BalancerBoostedStrategy', {
    contract: 'BalancerBoostedStrategy',
    from: deployer,
    libraries: {
      StrategyLib: (await deployments.get('StrategyLib')).address,
      ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
      ConverterStrategyBaseLib2: (await deployments.get('ConverterStrategyBaseLib2')).address,
      BalancerLogicLib: (await deployments.get('BalancerLogicLib')).address,
    },
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });
};
export default func;
func.tags = ['BalancerBoostedStrategy'];
func.dependencies = [
  'StrategyLib',
  'ConverterStrategyBaseLib',
  'ConverterStrategyBaseLib2',
  'BalancerLogicLib',
];
