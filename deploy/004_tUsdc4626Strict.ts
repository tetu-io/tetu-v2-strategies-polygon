import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { Consts } from '../deploy_constants/constatants';
import { isContractExist } from '../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;
  const { deployer, USDC_ADDRESS } = await getNamedAccounts();
  const strategy = await deployments.get('tUsdcStrategy');

  if (await isContractExist(hre, 'tUsdc4626Strict')) {
    return;
  }

  await deploy('tUsdc4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [USDC_ADDRESS, 'tUSDC', 'tUSDC', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const erc4626 = await deployments.get('tUsdc4626Strict');
  await execute(
    'tUsdcStrategy',
    {
      from: deployer,
      log: true,
    },
    'init',
    erc4626.address,
  );

};
export default func;
func.tags = ['tUsdc4626Strict'];
