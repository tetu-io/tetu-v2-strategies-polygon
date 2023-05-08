import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import {BalancerBoostedStrategy, UniswapV3ConverterStrategy} from '../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { isContractExist, txParams } from '../deploy_constants/deploy-helpers';
import { RunHelper } from '../scripts/utils/RunHelper';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, CONVERTER_ADDRESS, BALANCER_POOL_T_USD, SPLITTER_USDC_ADDRESS } = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_BalancerBoostedStrategy_tUsd')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('BalancerBoostedStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_BalancerBoostedStrategy_tUsd', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_BalancerBoostedStrategy_tUsd',
    {
      from: deployer,
      log: true,
      ...(await txParams(hre, ethers.provider)),
    },
    'initProxy',
    strategyImplDeployment.address,
  );

  const strategyContract = await ethers.getContractAt(
    'BalancerBoostedStrategy',
    proxyDeployResult.address,
  ) as BalancerBoostedStrategy;
  const params = await txParams(hre, ethers.provider);
  await RunHelper.runAndWait(() => strategyContract.init(
    core.controller,
    SPLITTER_USDC_ADDRESS,
    CONVERTER_ADDRESS,
    BALANCER_POOL_T_USD,
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_BalancerBoostedStrategy_tUsd'];
func.dependencies = ['BalancerBoostedStrategy'];
