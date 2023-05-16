import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { Consts } from '../../deploy_constants/constatants'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const {deployer, STMATIC_ADDRESS, ST_MATIC_RATE_PROVIDER_ADDRESS} = await getNamedAccounts();

  const tStMatic4626Strict = await deployments.get('tStMatic4626Strict')

  await deploy('stMaticRateProvider', {
    contract: 'ExternalRateProvider',
    from: deployer,
    args: [STMATIC_ADDRESS, tStMatic4626Strict.address, ST_MATIC_RATE_PROVIDER_ADDRESS],
    log: true,
    skipIfAlreadyDeployed: true,
  });

};
export default func;
func.tags = ['stMaticRateProvider']
func.dependencies = ['tStMatic4626Strict']
