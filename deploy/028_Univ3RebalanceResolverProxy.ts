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
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { RebalanceResolver__factory, UniswapV3ConverterStrategy } from '../typechain';
import { RunHelper } from '../scripts/utils/RunHelper';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  if (await isContractExist(hre, 'Univ3RebalanceResolverProxy')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const resolverLogic = await deployments.get('RebalanceResolver');
  const proxyDeployResult = await deployments.deploy('Univ3RebalanceResolverProxy', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Univ3RebalanceResolverProxy',
    {
      from: deployer,
      log: true,
      ...(await txParams(hre, ethers.provider)),
    },
    'initProxy',
    resolverLogic.address,
  );

  const signer = await ethers.getSigner(deployer);
  const contract = RebalanceResolver__factory.connect(proxyDeployResult.address, signer);
  const params = await txParams(hre, ethers.provider);
  await RunHelper.runAndWait(() => contract.init(
    core.controller, {
      ...params,
    },
  ));


};
export default func;
func.tags = ['Univ3RebalanceResolverProxy'];
func.dependencies = ['RebalanceResolver'];
