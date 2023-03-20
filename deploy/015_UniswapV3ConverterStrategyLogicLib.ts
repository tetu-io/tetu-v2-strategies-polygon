import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deployer} = await getNamedAccounts();
  await deployments.deploy('UniswapV3ConverterStrategyLogicLib', {
    contract: 'UniswapV3ConverterStrategyLogicLib',
    from: deployer,
    libraries: {
      UniswapV3Lib: (await deployments.get('UniswapV3Lib')).address,
      UniswapV3DebtLib: (await deployments.get('UniswapV3DebtLib')).address,
      ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    },
    log: true,
  });
}
export default func;
func.tags = ['UniswapV3ConverterStrategyLogicLib']
func.dependencies = ['UniswapV3Lib', 'ConverterStrategyBaseLib', 'UniswapV3DebtLib']
