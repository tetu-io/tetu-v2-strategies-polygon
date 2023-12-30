import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';
import {ethers} from "hardhat";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  const strategyAddress = (await deployments.get('Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai')).address
  const strategy = await ethers.getContractAt('UniswapV3ConverterStrategy', strategyAddress)
  const state = await strategy.getDefaultState()
  await hardhatDeploy(
    hre,
    'StrategyProfitHolder',
    true,
    undefined,
    'StrategyProfitHolder_UniswapV3_Base_UsdbcDai',
      [strategyAddress, [state[0][0], state[0][1]]],
    true
  )
};
export default func;
func.tags = ['StrategyProfitHolder_UniswapV3_Base_UsdbcDai'];
func.dependencies = ['Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai'];
func.skip = async hre => (await hre.getChainId()) !== '8453'
