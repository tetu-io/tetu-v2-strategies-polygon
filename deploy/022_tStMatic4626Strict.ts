import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { Consts } from '../deploy_constants/constatants'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const {deployer, STMATIC_ADDRESS} = await getNamedAccounts();

  const strategy = await deployments.get('tStMaticStrategy');

  await deploy('tStMatic4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [STMATIC_ADDRESS, 'tstMATIC', 'tstMATIC', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true,
  });

};
export default func;
func.tags = ['tStMatic4626Strict']
func.dependencies = ['tStMaticStrategy']
