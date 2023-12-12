import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { hardhatDeploy } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  await hardhatDeploy(hre, 'KyberLib', true);
};
export default func;
func.tags = ['KyberLib'];
func.skip = async hre => true // (await hre.getChainId()) !== '137'
