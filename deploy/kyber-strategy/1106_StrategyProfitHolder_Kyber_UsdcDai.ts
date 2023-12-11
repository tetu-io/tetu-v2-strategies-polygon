import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';
import {ethers} from "hardhat";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts  } = hre;
  const { KNC_ADDRESS} = await getNamedAccounts();
  const strategyAddress = (await deployments.get('Strategy_KyberConverterStrategy_UsdcDai')).address
  const strategy = await ethers.getContractAt('KyberConverterStrategy', strategyAddress)
  const state = await strategy.getDefaultState()
  await hardhatDeploy(
    hre,
    'StrategyProfitHolder',
    true,
    undefined,
    'StrategyProfitHolder_Kyber_UsdcDai',
    [strategyAddress, [state[0][0], state[0][1], KNC_ADDRESS]],
    true
  )
};
export default func;
func.tags = ['StrategyProfitHolder_Kyber_UsdcDai'];
func.dependencies = ['Strategy_KyberConverterStrategy_UsdcDai'];
func.skip = async hre => true // (await hre.getChainId()) !== '137'
