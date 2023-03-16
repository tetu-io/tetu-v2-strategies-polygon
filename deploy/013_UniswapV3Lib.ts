import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deployer} = await getNamedAccounts();
  await deployments.deploy('UniswapV3Lib', {
    contract: 'UniswapV3Lib',
    from: deployer,
    log: true,
  });
}
export default func;
func.tags = ['UniswapV3Lib']
