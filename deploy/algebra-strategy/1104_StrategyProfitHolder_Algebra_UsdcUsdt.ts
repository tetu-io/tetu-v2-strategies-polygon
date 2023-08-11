import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy} from '../../deploy_constants/deploy-helpers';
import {ethers} from "hardhat";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts  } = hre;
  const { WMATIC_ADDRESS, DQUICK_ADDRESS } = await getNamedAccounts();
  const strategyAddress = (await deployments.get('Strategy_AlgebraConverterStrategy_UsdcUsdt')).address
  const strategy = await ethers.getContractAt('AlgebraConverterStrategy', strategyAddress)
  const state = await strategy.getDefaultState()
  await hardhatDeploy(
    hre,
    'StrategyProfitHolder',
    true,
    undefined,
    'StrategyProfitHolder_Algebra_UsdcUsdt',
    [strategyAddress, [state[0][0], state[0][1], WMATIC_ADDRESS, DQUICK_ADDRESS]],
    true
  )
};
export default func;
func.tags = ['StrategyProfitHolder_Algebra_UsdcUsdt'];
func.dependencies = ['Strategy_AlgebraConverterStrategy_UsdcUsdt'];
func.skip = async () => true
