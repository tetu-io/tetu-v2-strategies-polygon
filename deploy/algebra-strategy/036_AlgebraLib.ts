import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  await hardhatDeploy(hre, 'AlgebraLib', true);
};
export default func;
func.tags = ['AlgebraLib'];
func.skip = async hre => (await hre.getChainId()) !== '137'
