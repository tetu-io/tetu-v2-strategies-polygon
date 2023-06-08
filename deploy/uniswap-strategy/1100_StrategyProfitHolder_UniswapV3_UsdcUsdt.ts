import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';
import {ethers} from "hardhat";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  const strategyAddress = (await deployments.get('Strategy_UniswapV3ConverterStrategy_UsdcUsdt')).address
  const strategy = await ethers.getContractAt('UniswapV3ConverterStrategy', strategyAddress)
  const state = await strategy.getState()
  await hardhatDeploy(
    hre,
    'StrategyProfitHolder',
    true,
    undefined,
    'StrategyProfitHolder_UniswapV3_UsdcUsdt',
    [strategyAddress, [state.tokenA, state.tokenB]],
    true
  )
};
export default func;
func.tags = ['StrategyProfitHolder_UniswapV3_UsdcUsdt'];
func.dependencies = ['Strategy_UniswapV3ConverterStrategy_UsdcUsdt'];
