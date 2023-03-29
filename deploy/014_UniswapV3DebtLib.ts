import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { txParams } from '../deploy_constants/deploy-helpers';
import { ethers } from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deployer} = await getNamedAccounts();
  await deployments.deploy('UniswapV3DebtLib', {
    contract: 'UniswapV3DebtLib',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
    libraries: {
      UniswapV3Lib: (await deployments.get('UniswapV3Lib')).address,
      ConverterStrategyBaseLib: (await deployments.get('ConverterStrategyBaseLib')).address,
    },
  });
}
export default func;
func.tags = ['UniswapV3DebtLib']
func.dependencies = ['UniswapV3Lib', 'ConverterStrategyBaseLib']