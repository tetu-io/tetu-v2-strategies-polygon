import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { txParams } from '../../deploy_constants/deploy-helpers';
import { ethers } from 'hardhat';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer, X_USDC_VAULT_ADDRESS, LIQUIDATOR_ADDRESS, X_TETU_ADDRESS } = await getNamedAccounts();


  await deploy('tUsdcStrategy', {
    contract: 'TetuV1SingleTokenStrictStrategy',
    from: deployer,
    args: [X_USDC_VAULT_ADDRESS, LIQUIDATOR_ADDRESS, X_TETU_ADDRESS],
    log: true,
    skipIfAlreadyDeployed: true,
    ...(await txParams(hre, ethers.provider)),
  });

};
export default func;
func.tags = ['tUsdcStrategy'];
func.skip = async hre => (await hre.getChainId()) !== '137'
