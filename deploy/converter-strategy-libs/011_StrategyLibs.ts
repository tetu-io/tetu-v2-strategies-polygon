import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { hardhatDeploy, } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hardhatDeploy(hre, 'IterationPlanLib', true);
  await hardhatDeploy(hre, 'StrategyLib', true);
  await hardhatDeploy(hre, 'StrategyLib2', true);
}
export default func;
func.tags = ['StrategyLib', 'StrategyLib2', 'IterationPlanLib']
