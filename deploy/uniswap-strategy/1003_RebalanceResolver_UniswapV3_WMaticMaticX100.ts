import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  await hardhatDeploy(
    hre,
    'RebalanceResolver',
    true,
    undefined,
    'RebalanceResolver_UniswapV3_WMaticMaticX100',
    [(await deployments.get('Strategy_UniswapV3ConverterStrategy_WMaticMaticX100')).address]
  )
};
export default func;
func.tags = ['RebalanceResolver_UniswapV3_WMaticMaticX100'];
func.dependencies = ['Strategy_UniswapV3ConverterStrategy_WMaticMaticX100'];
