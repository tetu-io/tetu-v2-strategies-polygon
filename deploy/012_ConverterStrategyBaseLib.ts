import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { txParams } from '../deploy_constants/deploy-helpers';
import { ethers } from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deployer} = await getNamedAccounts();
  await deployments.deploy('ConverterStrategyBaseLib', {
    contract: 'ConverterStrategyBaseLib',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });
}
export default func;
func.tags = ['ConverterStrategyBaseLib']
