import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {UniswapV3ConverterStrategy} from "../typechain";
import { txParams } from '../deploy_constants/deploy-helpers';
import { ethers } from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deployer} = await getNamedAccounts();
  await deployments.deploy('UniswapV3ConverterStrategy', {
    contract: 'UniswapV3ConverterStrategy',
    from: deployer,
    libraries: {
      StrategyLib: (await deployments.get('StrategyLib')).address,
      ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
      UniswapV3ConverterStrategyLogicLib: (await deployments.get('UniswapV3ConverterStrategyLogicLib')).address,
    },
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });
}
export default func;
func.tags = ['UniswapV3ConverterStrategy']
func.dependencies = ['StrategyLib', 'ConverterStrategyBaseLib', 'UniswapV3ConverterStrategyLogicLib']
