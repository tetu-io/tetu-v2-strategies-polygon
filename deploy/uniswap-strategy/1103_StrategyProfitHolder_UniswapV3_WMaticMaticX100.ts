import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';
import {ethers} from "hardhat";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  const strategyAddress = (await deployments.get('Strategy_UniswapV3ConverterStrategy_WMaticMaticX100')).address
  const strategy = await ethers.getContractAt('UniswapV3ConverterStrategy', strategyAddress)
  const state = await strategy.getState()
  await hardhatDeploy(
    hre,
    'StrategyProfitHolder',
    true,
    undefined,
    'StrategyProfitHolder_UniswapV3_WMaticMaticX100',
    [strategyAddress, [state.tokenA, state.tokenB]]
  )
};
export default func;
func.tags = ['StrategyProfitHolder_UniswapV3_WMaticMaticX100'];
func.dependencies = ['Strategy_UniswapV3ConverterStrategy_WMaticMaticX100'];
