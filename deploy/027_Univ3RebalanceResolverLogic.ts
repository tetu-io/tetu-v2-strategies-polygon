import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction, DeploymentSubmission } from 'hardhat-deploy/types';
import { Consts } from '../deploy_constants/constatants';
import { ethers } from 'hardhat';
import ComposableStablePoolFactoryABI from '../scripts/abis/ComposableStablePoolFactory.json';
import ComposableStablePoolABI from '../scripts/abis/ComposableStablePool.json';
import LinearPoolABI from '../scripts/abis/LinearPool.json';
import BalancerVaultABI from '../scripts/abis/BalancerVault.json';
import { expect } from 'chai';
import LinearPoolRebalancerABI from '../scripts/abis/LinearPoolRebalancer.json';
import { isContractExist, txParams } from '../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  await deployments.deploy('RebalanceResolver', {
    contract: 'RebalanceResolver',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });
};
export default func;
func.tags = ['RebalanceResolver'];
func.dependencies = [];
