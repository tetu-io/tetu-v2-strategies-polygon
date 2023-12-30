import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { Consts } from '../../deploy_constants/constatants';
import { isContractExist } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;
  const { deployer, USDT_ADDRESS } = await getNamedAccounts();
  const strategy = await deployments.get('tUsdtStrategy');

  if (await isContractExist(hre, 'tUsdt4626Strict')) {
    return;
  }

  await deploy('tUsdt4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [USDT_ADDRESS, 'tUSDT', 'tUSDT', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const erc4626 = await deployments.get('tUsdt4626Strict');
  await execute(
    'tUsdtStrategy',
    {
      from: deployer,
      log: true,
    },
    'init',
    erc4626.address,
  );
};
export default func;
func.tags = ['tUsdt4626Strict'];
func.skip = async hre => (await hre.getChainId()) !== '137'
