import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { isContractExist } from '../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  if (await isContractExist(hre, 'RebalancerWithExtraMain')) {
    return;
  }

  await deploy('RebalancerWithExtraMain', {
    contract: 'RebalancerWithExtraMain',
    from: deployer,
    args: [],
    log: true,
    skipIfAlreadyDeployed: true,
  });

};
export default func;
func.tags = ['RebalancerWithExtraMain'];