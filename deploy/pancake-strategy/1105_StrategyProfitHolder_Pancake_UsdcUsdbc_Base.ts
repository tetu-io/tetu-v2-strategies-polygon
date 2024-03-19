import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';
import {ethers} from "hardhat";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts  } = hre;
  const { PANCAKE_SWAP_TOKEN_BASE } = await getNamedAccounts();
  const strategyAddress = (await deployments.get('Strategy_PancakeConverterStrategy_UsdcUsdbc')).address
  const strategy = await ethers.getContractAt('PancakeConverterStrategy', strategyAddress)
  const state = await strategy.getDefaultState()
  await hardhatDeploy(
    hre,
    'StrategyProfitHolder',
    true,
    undefined,
    'StrategyProfitHolder_Pancake_UsdcUsdbc',
    [strategyAddress, [state[0][0], state[0][1], PANCAKE_SWAP_TOKEN_BASE]],
    true
  )
};
export default func;
func.tags = ['StrategyProfitHolder_Pancake_UsdcUsdbc'];
func.dependencies = ['Strategy_PancakeConverterStrategy_UsdcUsdbc'];
func.skip = async hre => true // (await hre.getChainId()) !== '8453';
