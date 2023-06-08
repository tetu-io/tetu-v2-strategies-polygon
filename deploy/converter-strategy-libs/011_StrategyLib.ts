import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { hardhatDeploy, txParams } from '../../deploy_constants/deploy-helpers';
import { ethers } from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hardhatDeploy(hre, 'StrategyLib', true);
}
export default func;
func.tags = ['StrategyLib']
